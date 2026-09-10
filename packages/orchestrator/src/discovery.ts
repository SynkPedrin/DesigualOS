import { and, eq, inArray } from 'drizzle-orm';
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
  const [node] = await db
    .select({ nodeId: schema.nodes.nodeId, privateHost: schema.nodes.privateHost })
    .from(schema.nodes)
    .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id))
    .where(and(eq(schema.agents.name, agent), inArray(schema.nodes.status, ['online', 'degraded'])))
    .limit(1);

  return node ?? null;
}
