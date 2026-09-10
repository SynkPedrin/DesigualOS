import { useQuery } from '@tanstack/react-query';
import type { AgentName } from '@desigual-os/types';
import { apiFetch } from '@/lib/api/client';
import { mapAgentStats, type AgentStats, type AgentStatsWire } from '@/lib/api/contracts';

export type { AgentStats } from '@/lib/api/contracts';

const EMPTY_STATS: AgentStats = {
  activeConversations: 0,
  performancePercent: null,
  averageResponseSeconds: null,
};

/** GET /agents/stats: o backend calcula de verdade (sempre os 4 agentes).
 * Antes derivava das últimas 50 execuções globais, o que zerava agentes sem
 * atividade recente. */
export function useAgentStats(): Record<AgentName, AgentStats> {
  const { data } = useQuery({
    queryKey: ['agents', 'stats'],
    queryFn: async () => mapAgentStats(await apiFetch<{ agents: AgentStatsWire[] }>('/agents/stats')),
    refetchInterval: 15_000,
  });
  return (data ?? {}) as Record<AgentName, AgentStats>;
}

export function agentStatsOrDefault(
  stats: Record<AgentName, AgentStats>,
  agent: AgentName,
): AgentStats {
  return stats[agent] ?? EMPTY_STATS;
}
