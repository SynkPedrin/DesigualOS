'use client';

import { useMemo } from 'react';
import { Surface } from '@/components/ui/surface';
import { BrandBanner } from '@/components/ui/brand-banner';
import { titleCardVideoFor } from '@/lib/title-card-videos';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { DonutChart, type DonutDatum } from '@/components/ui/donut-chart';
import { AreaTrend } from '@/components/ui/area-trend';
import { useExecutions } from '@/hooks/use-executions';
import { useCostsOverview, useCostsByUser } from '@/hooks/use-costs';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMe } from '@/hooks/use-me';
import { AGENT_META } from '@/lib/agent-meta';
import { formatTokens, formatUsd } from '@/lib/format';

export default function DashboardPage() {
  const { isMaster } = useIsMaster();
  const { data: me } = useMe();
  const { data: executions, isPending: executionsPending } = useExecutions();
  const { data: overview, isPending: overviewPending } = useCostsOverview('7d', isMaster);
  const { data: health, isPending: healthPending } = useInfrastructureHealth(isMaster);
  const { data: byUser, isPending: byUserPending } = useCostsByUser('7d', isMaster);

  const tokensByAgent: DonutDatum[] = useMemo(() => {
    if (!executions) return [];
    const totals = new Map<string, number>();
    for (const execution of executions) {
      const current = totals.get(execution.agent) ?? 0;
      totals.set(execution.agent, current + execution.tokensInput + execution.tokensOutput);
    }
    return Array.from(totals.entries())
      .filter(([, value]) => value > 0)
      .map(([agent, value]) => ({
        key: agent,
        label: AGENT_META[agent as keyof typeof AGENT_META].label,
        value,
        colorVar: AGENT_META[agent as keyof typeof AGENT_META].colorVar,
      }));
  }, [executions]);

  const costTrend = useMemo(() => {
    if (!executions) return [];
    const byDay = new Map<string, number>();
    for (const execution of executions) {
      const day = execution.startedAt.slice(5, 10); // MM-DD
      byDay.set(day, (byDay.get(day) ?? 0) + (execution.status === 'completed' ? 1 : 0));
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label, value }));
  }, [executions]);

  return (
    <div>
      <BrandBanner className="mb-6 p-8" videoSrc={titleCardVideoFor('/')}>
        <p className="font-mono text-xs uppercase tracking-wider text-sinal">Bem-vindo de volta</p>
        <h2 className="mt-1 max-w-md font-display text-3xl font-black uppercase tracking-tight text-branco-cru">
          {me?.name ?? 'Time'}, o que vamos fazer hoje?
        </h2>
      </BrandBanner>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Execuções" value={executions?.length ?? 0} isLoading={executionsPending} />
        <StatCard
          label="Tokens utilizados"
          value={tokensByAgent.reduce((sum, d) => sum + d.value, 0)}
          formatValue={(v) => formatTokens(Math.round(v))}
          isLoading={executionsPending}
        />
        {isMaster && (
          <StatCard
            label="Custo total (7d)"
            value={overview?.totalCostUsd ?? 0}
            accent
            formatValue={(v) => formatUsd(v)}
            isLoading={overviewPending}
          />
        )}
        {isMaster && (
          <StatCard
            label="Agentes conectados"
            value={health?.agentsConnected.online ?? 0}
            formatValue={(v) => `${Math.round(v)}/${health?.agentsConnected.total ?? 4}`}
            isLoading={healthPending}
          />
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Uso de tokens por agente
          </h2>
          {executionsPending ? (
            <Skeleton className="h-52 w-full" />
          ) : tokensByAgent.length === 0 ? (
            <p className="text-sm text-nevoa">Sem execuções registradas ainda.</p>
          ) : (
            <DonutChart
              data={tokensByAgent}
              centerLabel="Total"
              centerValue={formatTokens(tokensByAgent.reduce((sum, d) => sum + d.value, 0))}
              formatValue={(v) => formatTokens(v)}
            />
          )}
        </Surface>

        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Execuções concluídas por dia
          </h2>
          {executionsPending ? (
            <Skeleton className="h-52 w-full" />
          ) : costTrend.length === 0 ? (
            <p className="text-sm text-nevoa">Sem histórico suficiente ainda.</p>
          ) : (
            <AreaTrend data={costTrend} colorVar="--color-sinal" formatValue={(v) => `${v} execuções`} />
          )}
        </Surface>
      </div>

      {isMaster && (
        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Custo por usuário (7d)
          </h2>
          {byUserPending ? (
            <Skeleton className="h-16 w-full" />
          ) : !byUser || byUser.length === 0 ? (
            <p className="text-sm text-nevoa">Sem custos registrados ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byUser?.map((row) => (
                  <tr key={row.userId ?? 'sem-usuario'} className="border-b border-grafite-elevado/60 last:border-b-0">
                    <td className="flex items-center gap-2 py-2 text-branco-cru">
                      <span className="flex size-7 items-center justify-center rounded-full bg-roxo-eletrico font-mono text-[11px] font-semibold">
                        {(row.userName ?? '?').charAt(0)}
                      </span>
                      {row.userName ?? 'Sem usuário'}
                    </td>
                    <td className="py-2 text-right font-mono text-nevoa">{formatUsd(row.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      )}
    </div>
  );
}
