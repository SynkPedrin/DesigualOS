import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AgentName } from '@desigual-os/types';

export interface DiscoveredNode {
  nodeId: string;
  privateHost: string;
}

/**
 * Movido de apps/api/src/nodes (Fase 03) pra cá porque tanto o enqueue
 * (apps/api, circuit breaker) quanto o worker (apps/worker, dispatch de
 * verdade) precisam da mesma lógica. Só node com status 'online' é
 * elegível; ver comentário original na Fase 03 sobre por que isso já
 * cumpre o papel de circuit breaker sem contador de falhas separado.
 */
export async function findHealthyNodeForAgent(agent: AgentName): Promise<DiscoveredNode | null> {
  const [node] = await db
    .select({ nodeId: schema.nodes.nodeId, privateHost: schema.nodes.privateHost })
    .from(schema.nodes)
    .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id))
    .where(and(eq(schema.agents.name, agent), eq(schema.nodes.status, 'online')))
    .limit(1);

  return node ?? null;
}
