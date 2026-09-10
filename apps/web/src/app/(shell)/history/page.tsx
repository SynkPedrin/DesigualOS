'use client';

import { useMemo, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { ExecutionsTable } from '@/components/history/executions-table';
import { useExecutions } from '@/hooks/use-executions';
import { useClients } from '@/hooks/use-clients';
import { AGENT_META } from '@/lib/agent-meta';
import { cn } from '@/lib/utils';

type AgentFilter = AgentName | 'all';

export default function HistoryPage() {
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const { data: executions, isPending, isError, refetch } = useExecutions(clientFilter);
  const { data: clients } = useClients();
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  function togglePin(id: string) {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (!executions) return [];
    const scoped = agentFilter === 'all' ? executions : executions.filter((e) => e.agent === agentFilter);
    return [...scoped].sort((a, b) => {
      const aPinned = pinnedIds.has(a.executionId);
      const bPinned = pinnedIds.has(b.executionId);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      // queued tem startedAt null - cai como "mais antigo" na ordenação.
      return new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime();
    });
  }, [executions, agentFilter, pinnedIds]);

  return (
    <div>
      <PageHeader
        eyebrow="Execuções"
        title="Histórico"
        description="Todas as conversas e tarefas processadas pelos agentes, com o resultado final de cada uma."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={clientFilter ?? ''}
          onChange={(event) => setClientFilter(event.target.value || null)}
          className="rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
        >
          <option value="">Todos os clientes</option>
          {clients?.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAgentFilter('all')}
          className={cn(
            'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
            agentFilter === 'all'
              ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
              : 'border-grafite-elevado bg-grafite text-nevoa hover:text-branco-cru',
          )}
        >
          Todos os agentes
        </button>
        {AGENT_NAMES.map((agent) => (
          <button
            key={agent}
            type="button"
            onClick={() => setAgentFilter(agent)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              agentFilter === agent
                ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                : 'border-grafite-elevado bg-grafite text-nevoa hover:text-branco-cru',
            )}
          >
            <AgentAvatar agent={agent} size="sm" />
            {AGENT_META[agent].label}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : isError ? (
        <div className="space-y-4">
          <EmptyState
            icon={HistoryIcon}
            title="Não conseguimos carregar o histórico."
            description="Verifique sua conexão e tente novamente."
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Nenhuma execução encontrada"
          description="Ainda não há conversas registradas para esse filtro."
        />
      ) : (
        <ExecutionsTable executions={filtered} pinnedIds={pinnedIds} onTogglePin={togglePin} />
      )}
    </div>
  );
}
