import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AgentName } from '@desigual-os/types';

export interface DiscoveredNode {
  nodeId: string;
  privateHost: string;
}

/**
 * Movido de apps/api/src/nodes (Fase 03) pra cá porque tanto o enqueue
 * (apps/api, circuit breaker) quanto o worker (apps/worker, dispatch de
 * verdade) precisam da mesma lógica. Node 'online' ou 'degraded' é
 * elegível; ver comentário original na Fase 03 sobre por que isso já
 * cumpre o papel de circuit breaker sem contador de falhas separado.
 *
 * 'degraded' entra aqui desde 07/09/2026: a sonda (agent-probe.ts) só marca
 * 'degraded' quando o(s) serviço(s) crítico(s) do agente estão saudáveis e
 * só um auxiliar caiu - ou seja, já é seguro despachar. Excluir 'degraded'
 * era o bug: o Bento (bento-qa crítico + swarm-api/memory-api auxiliares)
 * ficava com o chat inteiro bloqueado sempre que um auxiliar saía do ar
 * sozinho, mesmo com o serviço que o chat de fato usa no ar.
 */
export async function findHealthyNodeForAgent(agent: AgentName): Promise<DiscoveredNode | null> {
  // Achado real (2026-09-10): agent-probe.ts usava nodeIds sem o sufixo "_01"
  // que o heartbeat real de cada máquina usa (NODE_OTTO vs NODE_OTTO_01,
  // idem pros outros 4 agentes) - isso criava DUAS linhas por agente físico
  // em `nodes`. Já corrigido o nodeId da sonda pra bater com o real (mesmo
  // arquivo, getProbeTargets), mas linhas antigas já existentes no banco não
  // são apagadas sozinhas (nada varre "nodes velhos", só o autoFix de
  // FAKE/TEST) - ficam congeladas pra sempre com `status` desatualizado.
  // Sem isto, essa consulta continuava não-determinística mesmo depois do
  // nodeId corrigido. `lastHeartbeatAt` é o único campo que TODO caminho de
  // escrita (heartbeat real em nodes/routes.ts, sonda em agent-sync.ts)
  // atualiza sempre - ordenar por ele garante que a linha ativamente mantida
  // vence, mesmo que uma linha órfã antiga continue existindo no banco.
  const [node] = await db
    .select({ nodeId: schema.nodes.nodeId, privateHost: schema.nodes.privateHost })
    .from(schema.nodes)
    .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id))
    .where(and(eq(schema.agents.name, agent), inArray(schema.nodes.status, ['online', 'degraded'])))
    .orderBy(desc(schema.nodes.lastHeartbeatAt))
    .limit(1);

  return node ?? null;
}
