import { z } from 'zod';
import { AGENT_NAMES } from '@desigual-os/types';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Roteamento por LLM LOCAL.
 *
 * A camada paga (classifier.ts, Anthropic) nunca teve chave configurada em
 * produção — `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` estão vazias. Como o rule
 * engine só decide a partir de 0,70 e `topicKeywords` tem teto de 0,65, TUDO
 * que dependia da classifier caía no fallback, que era o Bento. Medido no
 * front publicado em 24/09/2026: "como tá a 3Net esse mês?" foi para o Bento,
 * que respondeu com número de agosto tirado do vault e, num follow-up, citou
 * OUTRO cliente. Pergunta de mídia paga respondida pelo agente de operação, com
 * vazamento de contexto entre clientes.
 *
 * Este roteador não resolve o pedido: só escolhe o agente. É trabalho de
 * classificação curta, que um modelo 3B local faz em ~0,1s — medido 17/17 nas
 * frases ambíguas da operação, contra 11/15 sem os exemplos abaixo.
 *
 * Vai pelo GATEWAY (COPY_OLLAMA_URL), nunca direto na placa: este código roda
 * no processo da API, e falar direto com a GPU põe um segundo concorrente sem
 * que o controle de admissão do worker saiba — mesma razão documentada em
 * marketing-copy.ts.
 */
const localResultSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  confidence: z.number().min(0).max(1).optional(),
});

export interface LocalRoutingResult {
  agent: (typeof AGENT_NAMES)[number];
  confidence: number;
}

/** Teto curto: isto roda no caminho SÍNCRONO do POST /chat. */
const LOCAL_CLASSIFIER_TIMEOUT_MS = 8_000;

/**
 * Os exemplos não são enfeite: sem eles o modelo mandava "como tá a 3Net?"
 * para o Bento (11/15). Com eles, 17/17. A regra que desambigua é uma só —
 * "como tá o <cliente>" pergunta desempenho de mídia; só é operação quando a
 * frase fala de tarefa, prazo, entrega ou pessoa da equipe.
 */
const SYSTEM_PROMPT = `Você é um ROTEADOR. Leia o pedido e diga qual agente atende. NÃO responda o pedido.

bento  - operação interna da agência: tarefas, demandas, prazos, responsáveis, quem está com o quê, processos, SOPs
jarbas - MÍDIA PAGA e performance: como um cliente está indo, resultado, gasto, investimento, verba, CPA, CPL, CTR, ROAS, alcance, campanha de anúncios
otto   - CRIAÇÃO de peça: legenda, título, headline, hook, copy, roteiro, carrossel, conceito, tagline
suzy   - social selling: WhatsApp, lead, agendamento de reunião
studio - GERAR imagem ou vídeo na GPU

REGRA IMPORTANTE: "como tá o <cliente>", "como está o <cliente>", "e o <cliente>?" pergunta o
DESEMPENHO de mídia do cliente -> jarbas. Só é bento quando a frase fala de TAREFA, DEMANDA,
PRAZO, ENTREGA ou PESSOA da equipe.

Exemplos:
"como tá a 3Net?" -> jarbas
"como tá a Elite esse mês?" -> jarbas
"quanto gastou?" -> jarbas
"qual campanha tá melhor?" -> jarbas
"quais demandas da 3Net?" -> bento
"quais as tarefas da Alícia?" -> bento
"o que tá pegando fogo na agência?" -> bento
"faz uma legenda pra 3Net" -> otto
"me dá 3 títulos" -> otto

Responda SÓ com JSON, um único agente, sem barras:
{"agent":"bento","confidence":0.9}`;

export async function classifyLocally(
  message: string,
  logger: FastifyBaseLogger,
  fetchFn: typeof fetch = fetch,
): Promise<LocalRoutingResult | null> {
  const baseUrl = process.env.COPY_OLLAMA_URL ?? 'http://127.0.0.1:11500';
  const model = process.env.ROUTER_OLLAMA_MODEL ?? process.env.COPY_OLLAMA_MODEL ?? 'ministral-3:3b';

  try {
    const response = await fetchFn(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desigual-Caller': 'router-classifier' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        // Roteamento precisa ser REPETÍVEL: a mesma frase não pode cair em
        // agentes diferentes entre dois turnos.
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
      }),
      signal: AbortSignal.timeout(LOCAL_CLASSIFIER_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, model }, '[router] classifier local indisponível (HTTP)');
      return null;
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content;
    if (!content) return null;

    const parsed = localResultSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      // Modelo pequeno às vezes devolve "otto|jarbas" (ecoando a união do
      // enum). Vale null: melhor pedir esclarecimento do que chutar.
      logger.warn({ model }, '[router] classifier local devolveu agente fora do enum');
      return null;
    }
    return { agent: parsed.data.agent, confidence: parsed.data.confidence ?? 0.8 };
  } catch (error) {
    logger.warn({ err: String(error), model }, '[router] classifier local falhou');
    return null;
  }
}
