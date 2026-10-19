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

const SYSTEM_PROMPT = `Você classifica pedidos de usuários de uma agência de marketing (a Desigual) pro sistema Desigual OS.
Sua ÚNICA tarefa é escolher qual agente atende. NÃO responda o pedido.

AGENTES:
bento — OPERAÇÃO e conhecimento da agência: tarefas, demandas, prazos, responsáveis, carga da
equipe, processos, SOPs, histórico, riscos da operação, estado da agência ou de um cliente,
o que aconteceu num período, e FATO CADASTRAL de cliente (decisor, contato, orçamento do
contrato, escopo). Também orquestra pedidos que precisam de vários agentes (campanha completa).
jarbas — MÍDIA PAGA e performance: como um cliente está indo nos anúncios, gasto, investimento,
verba de mídia, CPA, CPL, CTR, ROAS, alcance, impressões, cliques, resultado de campanha,
criativo que mais performa, fadiga de criativo, comparação de performance entre clientes,
decisão de aumentar ou cortar verba.
otto — DIREÇÃO CRIATIVA (pensar a peça, não gerar o arquivo): legenda, título, headline, hook,
copy, roteiro, conceito criativo, tagline, direção de arte, escrever prompt de imagem/vídeo.
suzy — SOCIAL SELLING (falar COM pessoas): mandar mensagem no WhatsApp/Instagram, responder ou
qualificar lead, follow-up, agendar reunião.
studio — EXECUÇÃO de mídia na GPU (gerar o arquivo): imagem, vídeo, arte, reels renderizado, upscale.

REGRAS DE DESAMBIGUAÇÃO — cada uma existe por um erro real de roteamento:
1. "como tá o <cliente>", "como está o <cliente>", "e o <cliente>?" perguntam DESEMPENHO de
   mídia -> jarbas. Só é bento se a frase falar de tarefa, demanda, prazo, entrega, pessoa da
   equipe, ou pedir fato cadastral.
2. "campanha" sozinha NÃO é criação. Performance, resultado ou comparação de campanha -> jarbas.
   Criar campanha NOVA completa (conceito + peças + mídia) -> bento com workflow.
3. Risco, estado, "o que aconteceu", resumo do período, prioridades -> bento, mesmo sem jargão
   de operação. Isso NÃO é métrica de mídia.
4. Orçamento do cliente (contrato, fee) -> bento. Verba, gasto ou investimento de MÍDIA -> jarbas.
5. Escrever o TEXTO da peça (legenda, título, roteiro, prompt) -> otto. GERAR o arquivo
   (imagem, vídeo, arte pronta) -> studio. "Montar a arte" é gerar: studio.
6. Contar leads ou medir aquisição -> jarbas. Falar COM o lead -> suzy.

EXEMPLOS:
"como tá a 3Net?" -> jarbas
"como está a Elite esse mês?" -> jarbas
"quais demandas da 3Net?" -> bento
"quem é o decisor da 3Net?" -> bento
"o que tá pegando fogo na agência?" -> bento
"faz uma legenda pra 3Net" -> otto
"me dá 3 títulos" -> otto
"monta a arte do post de natal" -> studio
"manda um zap pro lead" -> suzy
"vale a pena aumentar a verba da Colormaq?" -> jarbas
"quero lançar uma campanha do zero: conceito, peças e mídia" -> bento, workflow ["bento","jarbas","studio","bento"]

Responda SÓ com um JSON no formato:
{"intent": string, "primary_agent": "bento"|"jarbas"|"suzy"|"studio"|"otto", "required_tools": string[],
 "estimated_complexity": "low"|"medium"|"high", "workflow": string[] | null}
intent é uma frase curta em português descrevendo o pedido. required_tools é subconjunto de
["clickup","meta_ads","google_ads","whatsapp","gpu","studio"]. workflow só é preenchido (lista
ordenada de agentes) se a tarefa precisar de mais de um agente em sequência; senão é null.`;

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
