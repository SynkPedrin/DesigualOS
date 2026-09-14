/**
 * retired-nodes.ts — separa registro de node velho de máquina realmente caída.
 *
 * PROBLEMA (medido em 11/09/2026): a tabela `nodes` tinha 6 linhas pra 4 máquinas reais.
 * As máquinas trocaram de NODE_ID em algum momento (NODE_OTTO virou NODE_OTTO_01, idem Suzy,
 * Studio e Jarbas) e o registro é idempotente POR node_id — o id antigo nunca é sobrescrito,
 * fica na tabela pra sempre com heartbeat de dias atrás. Consequência: `all_systems_online`
 * era impossível de atingir e `overall_health_percent` vivia em ~66%, mesmo com tudo de pé.
 *
 * Um indicador travado em vermelho é tão inútil quanto um travado em verde: nos dois casos
 * quem opera para de olhar.
 *
 * A REGRA É ESTREITA DE PROPÓSITO. Só aposenta quando as DUAS coisas valem:
 *   1. o registro está sem heartbeat há mais de `aposentadoAposMs` (não é queda recente); E
 *   2. o MESMO AGENTE já tem outro node online agora.
 *
 * A condição 2 é o que impede a regra de virar um jeito de esconder máquina caída: se o agente
 * não tem nenhum node vivo, a linha offline CONTINUA contando como offline, que é exatamente o
 * que a operação precisa ver.
 */

export interface LinhaDeNode {
  nodeId: string;
  agent: string;
  status: string;
  lastHeartbeatAt: Date | null;
}

export const APOSENTADO_APOS_MS = 6 * 60 * 60 * 1000;

export interface SeparacaoDeNodes<T extends LinhaDeNode> {
  ativos: T[];
  aposentados: T[];
}

export function separarRegistrosAposentados<T extends LinhaDeNode>(
  linhas: T[],
  agora: number = Date.now(),
  aposentadoAposMs: number = APOSENTADO_APOS_MS,
): SeparacaoDeNodes<T> {
  const agentesComNodeVivo = new Set(linhas.filter((l) => l.status === 'online').map((l) => l.agent));

  const aposentado = (linha: T): boolean => {
    if (linha.status === 'online') return false;
    if (!agentesComNodeVivo.has(linha.agent)) return false;
    const ultimo = linha.lastHeartbeatAt?.getTime() ?? 0;
    return agora - ultimo > aposentadoAposMs;
  };

  return {
    ativos: linhas.filter((l) => !aposentado(l)),
    aposentados: linhas.filter(aposentado),
  };
}
