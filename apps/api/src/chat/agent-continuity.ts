import type { RouterDecision } from '@desigual-os/router';
import type { AgentName } from '@desigual-os/types';

/**
 * agent-continuity.ts — ausência de sinal não é troca de agente.
 *
 * O roteador decide por MENSAGEM, sem estado da conversa. Numa pergunta isolada
 * isso está certo; numa conversa, não: "Me dá 3 títulos." sozinha não tem
 * vocativo nem regra forte, então volta `primary_agent=bento, confidence=0` —
 * e o fallback de quem não sabe é o Bento, por ser o agente de conhecimento
 * geral.
 *
 * Medido no navegador em 17/09/2026, num fluxo aberto com "Otto, lembra daquela
 * campanha...": SÓ o primeiro turno foi pro Otto. Os nove seguintes — títulos,
 * legenda, "tá com cara de IA" — foram respondidos pelo Bento, com lista do
 * ClickUp e id de lista. O que parecia o Otto recusando pedido criativo era o
 * Bento respondendo no lugar dele.
 *
 * O erro não está no fallback: está em ler `confidence=0` como "o Bento ganhou"
 * quando ele significa "nenhum sinal novo neste turno". Dentro de uma conversa
 * que já está com o Otto, nenhum sinal novo quer dizer CONTINUA.
 *
 * ESCOPO DELIBERADAMENTE ESTREITO: só o Otto, e só dentro da mesma conversa.
 * Sticky routing geral é outra decisão, com outros riscos — o Bento é o destino
 * certo pra pergunta solta, e generalizar isto faria uma pergunta operacional
 * perdida ficar presa no agente errado. O fluxo criativo é o que quebra sem
 * continuidade, porque é ele que se faz de turnos curtos que só significam algo
 * em sequência.
 */

/** Só o Otto herda. Ver a nota de escopo acima antes de acrescentar alguém. */
const AGENTES_COM_CONTINUIDADE = new Set<AgentName>(['otto']);

/**
 * Aplica continuidade ao turno, se for o caso.
 *
 * Devolve a MESMA decisão quando não há o que herdar — inclusive no caminho de
 * troca explícita, que é o ponto: "Bento, me atualiza a operação" no meio de
 * uma conversa com o Otto vem com vocativo, confiança 1, e vence.
 */
export function comContinuidadeDeAgente(
  decisao: RouterDecision,
  agenteAnterior: AgentName | null,
): RouterDecision {
  // Sinal explícito (vocativo, @menção, agente escolhido na interface) sempre
  // vence: é o usuário dizendo com quem quer falar.
  if (decisao.confidence > 0 || decisao.source === 'manual') return decisao;
  if (!agenteAnterior || !AGENTES_COM_CONTINUIDADE.has(agenteAnterior)) return decisao;
  if (decisao.primary_agent === agenteAnterior) return decisao;

  return {
    ...decisao,
    primary_agent: agenteAnterior,
    intent: 'continuidade_da_conversa',
    // Continua valendo 0: não houve sinal neste turno, e quem lê a decisão
    // depois precisa saber disso. O que mudou foi o destino, não a certeza.
    confidence: 0,
  };
}
