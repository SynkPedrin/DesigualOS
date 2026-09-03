'use client';

import Link from 'next/link';
import { AGENT_NAMES } from '@desigual-os/types';
import { ArrowRight } from 'lucide-react';
import { AgentCard } from './agent-card';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useAgentStats, agentStatsOrDefault } from '@/hooks/use-agent-stats';
import { useExecutions } from '@/hooks/use-executions';
import { Skeleton } from '@/components/ui/skeleton';

export function AgentsPanel() {
  const { isMaster } = useIsMaster();
  // Mesmo motivo do /agents: `nodes:read` é master-only, sem o gate isso disparava
  // um 403 a cada 15s pro colaborador. Status do card fica undefined pra ele, que o
  // AgentCard já trata (badge de status some, resto do card funciona normal).
  const { data: health } = useInfrastructureHealth(isMaster);
  const { isPending } = useExecutions();
  const stats = useAgentStats();

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Agentes
        </h2>
        <Link
          href="/agents"
          className="flex items-center gap-1 font-mono text-xs text-nevoa transition-colors hover:text-branco-cru"
        >
          Ver todos
          <ArrowRight size={12} />
        </Link>
      </div>

      {isPending
        ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
        : AGENT_NAMES.map((agent) => (
            <AgentCard
              key={agent}
              agent={agent}
              status={health?.nodes.find((n) => n.agent === agent)?.status}
              stats={agentStatsOrDefault(stats, agent)}
              compact
            />
          ))}
    </aside>
  );
}
