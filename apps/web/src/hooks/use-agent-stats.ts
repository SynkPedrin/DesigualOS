import { useMemo } from 'react';
import type { AgentName } from '@desigual-os/types';
import { useExecutions } from './use-executions';

export interface AgentStats {
  activeConversations: number;
  performancePercent: number;
  averageResponseSeconds: number | null;
}

const EMPTY_STATS: AgentStats = {
  activeConversations: 0,
  performancePercent: 100,
  averageResponseSeconds: null,
};

/** Derived from the same mocked/real executions dataset, not fabricated separately. */
export function useAgentStats(): Record<AgentName, AgentStats> {
  const { data: executions } = useExecutions();

  return useMemo(() => {
    const byAgent: Partial<Record<AgentName, AgentStats>> = {};
    if (!executions) return byAgent as Record<AgentName, AgentStats>;

    const agents = new Set(executions.map((e) => e.agent));
    for (const agent of agents) {
      const forAgent = executions.filter((e) => e.agent === agent);
      const active = forAgent.filter((e) => e.status === 'queued' || e.status === 'running').length;
      const settled = forAgent.filter((e) => e.status === 'completed' || e.status === 'failed');
      const completed = settled.filter((e) => e.status === 'completed');
      const performance = settled.length > 0 ? Math.round((completed.length / settled.length) * 100) : 100;
      const durations = completed
        .filter((e) => e.completedAt)
        .map((e) => (new Date(e.completedAt as string).getTime() - new Date(e.startedAt).getTime()) / 1000);
      const avgResponse =
        durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : null;

      byAgent[agent] = {
        activeConversations: active,
        performancePercent: performance,
        averageResponseSeconds: avgResponse,
      };
    }

    return byAgent as Record<AgentName, AgentStats>;
  }, [executions]);
}

export function agentStatsOrDefault(
  stats: Record<AgentName, AgentStats>,
  agent: AgentName,
): AgentStats {
  return stats[agent] ?? EMPTY_STATS;
}
