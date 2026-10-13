import { callResponses, isOpenAICredentialConfigured, pickModel } from '@desigual-os/openai-provider';
import { z } from 'zod';
import { AGENT_NAMES, EXECUTION_COMPLEXITIES } from '@desigual-os/types';
import type { FastifyBaseLogger } from 'fastify';

const classifierResultSchema = z.object({
  intent: z.string(),
  primary_agent: z.enum(AGENT_NAMES),
  required_tools: z.array(z.string()),
  estimated_complexity: z.enum(EXECUTION_COMPLEXITIES),
  workflow: z.array(z.enum(AGENT_NAMES)).nullable(),
});

export type ClassifierResult = z.infer<typeof classifierResultSchema>;

// Teto da chamada ao LLM no caminho síncrono do /chat (ver classifyWithLLM).
const CLASSIFIER_TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT = `Você classifica pedidos de usuários de uma agência de marketing pro sistema Desigual OS.
Agentes disponíveis: bento (conhecimento institucional, processos, SOPs), jarbas (performance e tráfego pago),
suzy (social selling, WhatsApp/Instagram), studio (geração de imagem/vídeo em GPU),
otto (direção criativa: campanhas, carrosséis, conceitos, copy, direção de arte, prompts de imagem/vídeo).
Responda SÓ com um JSON no formato:
{"intent": string, "primary_agent": "bento"|"jarbas"|"suzy"|"studio"|"otto", "required_tools": string[],
 "estimated_complexity": "low"|"medium"|"high", "workflow": string[] | null}
workflow só é preenchido (lista ordenada de agentes) se a tarefa precisar de mais de um agente em sequência.`;

/**
 * Camada paga do Router (seção 6.2), só chamada quando o rule engine e o
 * classificador local não tiveram confiança suficiente.
 *
 * Passou a usar GPT em 13/10/2026, por decisão do Pedro: "não vai utilizar
 * anthropic api key, e sim o gpt, sempre visando o mínimo de gasto e maior
 * qualidade". Antes chamava a Anthropic, e `ANTHROPIC_API_KEY` nunca esteve
 * configurada neste ambiente — então esta camada devolvia `null` em toda
 * chamada e todo pedido fora das regras virava pedido de esclarecimento.
 */
/**
 * SE A CAMADA PAGA TEM COMO FUNCIONAR, perguntável de fora.
 *
 * Sem credencial da OpenAI o classificador devolve `null` em toda chamada, e
 * todo turno que não casa com uma das regras determinísticas termina em
 * `needs_routing_clarification`. Visto da tela, o assistente responde sempre
 * "não entendi, me diz se é operação, mídia ou criação" — e a pessoa reescreve
 * a pergunta sem nenhuma chance de acertar, porque o problema não é a pergunta.
 *
 * Esta função existe pra quem responde ao usuário poder DIZER isso, em vez de
 * culpar a pergunta por ambiguidade que não existe. Ela não muda roteamento
 * nenhum: só torna perguntável, de fora, o que até aqui virava um `logger.warn`
 * que ninguém lê.
 */
export function classificadorDisponivel(): boolean {
  return isOpenAICredentialConfigured();
}

export async function classifyWithLLM(message: string, logger: FastifyBaseLogger): Promise<ClassifierResult | null> {
  if (!isOpenAICredentialConfigured()) {
    logger.warn('OPENAI_API_KEY não configurada; classificador indisponível');
    return null;
  }

  /**
   * ROTEAMENTO É O PISO DA ESCADA DE CUSTO, e por isso não lê o orçamento.
   *
   * `simple_routing` já mapeia pra `luna` em `BASE_TIER_BY_TASK`, e a política
   * de orçamento só REBAIXA — nunca escala por conta própria. Como luna é o
   * degrau mais baixo, nenhum estado de orçamento muda esta escolha: de
   * `normal` a `exhausted`, `pickModel` devolve luna.
   *
   * Então chamar com `'normal'` não é ignorar o orçamento, é reconhecer que
   * aqui ele não tem o que decidir. E evita uma consulta ao ledger no caminho
   * SÍNCRONO do POST /chat, que custaria uma ida ao banco por turno pra
   * confirmar uma resposta que já se sabe.
   *
   * Classificar é tarefa pequena: lê uma frase e devolve um JSON de cinco
   * campos. Luna custa US$ 0,20 por milhão de entrada contra 2,00 do terra —
   * dez vezes menos pelo mesmo trabalho.
   */
  const decisao = pickModel('simple_routing', 'normal');

  let texto: string;
  try {
    /**
     * Teto explícito, herdado da implementação anterior: esta chamada roda no
     * caminho SÍNCRONO do POST /chat, então um provedor lento segura a
     * resposta da pessoa. O `Promise.race` é necessário porque o timeout do
     * cliente cobre a requisição HTTP, não a espera total de quem chamou.
     */
    const resultado = await Promise.race([
      callResponses(
        {
          model: decisao.model,
          // Prefixo estável primeiro: é o que permite o cache de prompt cobrar
          // US$ 0,02 em vez de 0,20 por milhão nas repetições.
          instructions: SYSTEM_PROMPT,
          input: message,
          maxOutputTokens: 512,
        },
        logger,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CLASSIFIER_TIMEOUT_MS)),
    ]);

    if (resultado === null) {
      logger.warn({ timeoutMs: CLASSIFIER_TIMEOUT_MS }, 'Classificador estourou o prazo; caindo pras regras');
      return null;
    }
    texto = resultado.outputText;
  } catch (error) {
    /**
     * Falha do provedor NÃO derruba o turno: devolve null e o roteador segue
     * pro mesmo caminho de quando não há credencial. Deixar propagar
     * transformaria indisponibilidade de terceiro em erro 500 no chat.
     *
     * MAS REGISTRA COMO ERRO, não como aviso, e a distinção importa: credencial
     * INVÁLIDA passa por `isOpenAICredentialConfigured()` (a chave existe, só
     * não vale), então a pessoa receberia a mensagem de "não consegui
     * identificar", que culpa a pergunta dela por uma ambiguidade que não
     * existe. Sem um erro no log, esse estado é indistinguível de roteamento
     * normal. Falha de terceiro pode não derrubar o turno; não pode passar
     * despercebida.
     */
    logger.error({ error, model: decisao.model }, 'Classificador falhou; caindo pras regras');
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(texto);
    return classifierResultSchema.parse(parsed);
  } catch (error) {
    logger.error({ error, raw: texto }, 'Classificador devolveu resposta que não dá pra interpretar');
    return null;
  }
}
