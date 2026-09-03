'use client';

import { Pin } from 'lucide-react';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { MetricValue } from '@/components/ui/metric-value';
import { EXECUTION_STATUS_META } from '@/lib/status-meta';
import { AGENT_META } from '@/lib/agent-meta';
import { intentLabel } from '@/lib/intent-meta';
import { formatDuration, formatRelativeTime, formatTokens } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ExecutionListItem } from '@/lib/api/contracts';

export function ExecutionsTable({
  executions,
  pinnedIds,
  onTogglePin,
}: {
  executions: ExecutionListItem[];
  pinnedIds: Set<string>;
  onTogglePin: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-grafite-elevado">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-grafite-elevado bg-grafite text-left font-mono text-[10px] uppercase tracking-wider text-nevoa">
            <th className="w-9 px-3 py-3" />
            <th className="px-3 py-3">Agente</th>
            <th className="px-3 py-3">Intenção</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Prioridade</th>
            <th className="px-3 py-3 text-right">Tokens</th>
            <th className="px-3 py-3 text-right">Duração</th>
            <th className="px-3 py-3 text-right">Iniciado</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => {
            const statusMeta = EXECUTION_STATUS_META[execution.status];
            const agentMeta = AGENT_META[execution.agent];
            const pinned = pinnedIds.has(execution.executionId);
            return (
              <tr
                key={execution.executionId}
                className="border-b border-grafite-elevado/60 transition-colors last:border-b-0 hover:bg-grafite/60"
              >
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onTogglePin(execution.executionId)}
                    aria-label={pinned ? 'Desafixar' : 'Fixar'}
                    className={cn(
                      'flex size-6 items-center justify-center rounded transition-colors',
                      pinned ? 'text-sinal' : 'text-nevoa/40 hover:text-nevoa',
                    )}
                  >
                    <Pin size={13} fill={pinned ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <AgentAvatar agent={execution.agent} size="sm" />
                    <span className={cn('font-medium', agentMeta.textClass)}>{agentMeta.label}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-branco-cru">{intentLabel(execution.intent)}</td>
                <td className="px-3 py-3">
                  <StatusBadge
                    label={statusMeta.label}
                    dotClass={statusMeta.dotClass}
                    textClass={statusMeta.textClass}
                    pulse={execution.status === 'running'}
                  />
                </td>
                <td className="px-3 py-3 font-mono text-xs text-nevoa">{execution.priority}</td>
                <td className="px-3 py-3 text-right">
                  <MetricValue className="text-xs text-nevoa">
                    {formatTokens(execution.tokensInput)} in / {formatTokens(execution.tokensOutput)} out
                  </MetricValue>
                </td>
                <td className="px-3 py-3 text-right">
                  <MetricValue className="text-xs text-branco-cru">
                    {formatDuration(execution.startedAt, execution.completedAt)}
                  </MetricValue>
                </td>
                <td className="px-3 py-3 text-right text-xs text-nevoa">
                  {formatRelativeTime(execution.startedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
