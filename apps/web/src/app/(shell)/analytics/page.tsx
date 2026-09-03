'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { DonutChart, type DonutDatum } from '@/components/ui/donut-chart';
import { useExecutions } from '@/hooks/use-executions';
import { EXECUTION_STATUS_META } from '@/lib/status-meta';
import { AGENT_META } from '@/lib/agent-meta';

const STATUS_COLOR_VAR: Record<string, string> = {
  completed: '--color-sucesso',
  running: '--color-aviso',
  queued: '--color-info',
  failed: '--color-erro',
  timeout: '--color-erro',
  cancelled: '--color-nevoa',
  pending: '--color-nevoa',
};

export default function AnalyticsPage() {
  const { data: executions, isPending } = useExecutions();

  const byStatus: DonutDatum[] = useMemo(() => {
    if (!executions) return [];
    const totals = new Map<string, number>();
    for (const execution of executions) {
      totals.set(execution.status, (totals.get(execution.status) ?? 0) + 1);
    }
    return Array.from(totals.entries()).map(([status, value]) => ({
      key: status,
      label: EXECUTION_STATUS_META[status as keyof typeof EXECUTION_STATUS_META].label,
      value,
      colorVar: STATUS_COLOR_VAR[status] ?? '--color-nevoa',
    }));
  }, [executions]);

  const avgDurationByAgent = useMemo(() => {
    if (!executions) return [];
    const byAgent = new Map<string, number[]>();
    for (const execution of executions) {
      if (execution.status !== 'completed' || !execution.completedAt) continue;
      const seconds = (new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000;
      const list = byAgent.get(execution.agent) ?? [];
      list.push(seconds);
      byAgent.set(execution.agent, list);
    }
    return Array.from(byAgent.entries()).map(([agent, durations]) => ({
      agent: agent as keyof typeof AGENT_META,
      avgSeconds: durations.reduce((sum, d) => sum + d, 0) / durations.length,
    }));
  }, [executions]);

  const maxAvg = Math.max(1, ...avgDurationByAgent.map((row) => row.avgSeconds));

  return (
    <div>
      <PageHeader
        eyebrow="Uso do sistema"
        title="Analytics"
        description="Distribuição de status e tempo médio de resposta por agente, calculado a partir das execuções reais."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Execuções por status
          </h2>
          {isPending ? (
            <Skeleton className="h-52 w-full" />
          ) : byStatus.length === 0 ? (
            <p className="text-sm text-nevoa">Sem execuções registradas ainda.</p>
          ) : (
            <DonutChart data={byStatus} centerLabel="Total" centerValue={executions?.length ?? 0} />
          )}
        </Surface>

        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Tempo médio de resposta por agente
          </h2>
          {isPending ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <div className="space-y-3">
              {avgDurationByAgent.map(({ agent, avgSeconds }) => {
                const meta = AGENT_META[agent];
                return (
                  <div key={agent}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className={meta.textClass}>{meta.label}</span>
                      <span className="font-mono text-xs text-nevoa">{avgSeconds.toFixed(1)}s</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-carbono">
                      <div
                        className={meta.bgClass + ' h-full rounded-full'}
                        style={{ width: `${(avgSeconds / maxAvg) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
