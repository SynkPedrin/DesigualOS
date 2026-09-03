'use client';

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { MetricValue } from '@/components/ui/metric-value';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DonutChart, type DonutDatum } from '@/components/ui/donut-chart';
import { useCostsByAgent, useCostsByClient, useCostsByUser, useCostsOverview } from '@/hooks/use-costs';
import { useIsMaster } from '@/hooks/use-is-master';
import { AGENT_META } from '@/lib/agent-meta';
import { formatTokens, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CostRange } from '@/lib/api/contracts';

const RANGE_OPTIONS: { value: CostRange; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

export default function CostsPage() {
  const [range, setRange] = useState<CostRange>('7d');
  const { isMaster, isPending: rolePending } = useIsMaster();
  const { data: overview, isPending: overviewPending } = useCostsOverview(range, isMaster);
  const { data: byAgent, isPending: byAgentPending } = useCostsByAgent(range, isMaster);
  const { data: byClient, isPending: byClientPending } = useCostsByClient(range, isMaster);
  const { data: byUser, isPending: byUserPending } = useCostsByUser(range, isMaster);

  const donutData: DonutDatum[] =
    byAgent?.map((row) => ({
      key: row.agent,
      label: AGENT_META[row.agent].label,
      value: row.totalCostUsd,
      colorVar: AGENT_META[row.agent].colorVar,
    })) ?? [];

  if (!rolePending && !isMaster) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Custos e tokens são visíveis só para o papel Administrador Master."
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Financeiro"
        title="Tokens & Custos"
        description="Custo real de uso de IA, calculado a partir dos tokens de cada execução."
        actions={
          <div className="flex gap-1 rounded-md border border-grafite-elevado bg-grafite p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  range === option.value ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Custo total', value: overview ? formatUsd(overview.totalCostUsd) : '—', accent: true },
          { label: 'Eventos de custo', value: overview?.costEvents },
          { label: 'Tokens de entrada', value: overview ? formatTokens(overview.totalInputTokens) : '—' },
          { label: 'Tokens de saída', value: overview ? formatTokens(overview.totalOutputTokens) : '—' },
        ].map((stat) => (
          <Surface key={stat.label} level="grafite" className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{stat.label}</p>
            {overviewPending ? (
              <Skeleton className="mt-1 h-7 w-20" />
            ) : (
              <MetricValue className={cn('text-2xl', stat.accent ? 'text-sinal' : 'text-branco-cru')}>
                {stat.value}
              </MetricValue>
            )}
          </Surface>
        ))}
      </div>

      {overview?.note && (
        <p className="mb-6 font-mono text-xs text-nevoa">{overview.note}</p>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Custo por agente
          </h2>
          {byAgentPending ? (
            <Skeleton className="h-52 w-full" />
          ) : donutData.length === 0 ? (
            <p className="text-sm text-nevoa">Sem custos registrados no período.</p>
          ) : (
            <DonutChart
              data={donutData}
              centerLabel="Total"
              centerValue={formatUsd(donutData.reduce((sum, d) => sum + d.value, 0))}
              formatValue={(v) => formatUsd(v)}
            />
          )}
        </Surface>

        <Surface level="grafite" className="p-5">
          <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Custo por cliente
          </h2>
          {byClientPending ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byClient?.map((row) => (
                  <tr key={row.clientId ?? 'sem-cliente'} className="border-b border-grafite-elevado/60 last:border-b-0">
                    <td className="py-2 text-branco-cru">{row.clientName ?? 'Sem cliente'}</td>
                    <td className="py-2 text-right font-mono text-nevoa">{formatUsd(row.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      </div>

      <Surface level="grafite" className="p-5">
        <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Custo por usuário
        </h2>
        {byUserPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {byUser?.map((row) => (
                <tr key={row.userId ?? 'sem-usuario'} className="border-b border-grafite-elevado/60 last:border-b-0">
                  <td className="py-2 text-branco-cru">{row.userName ?? 'Sem usuário'}</td>
                  <td className="py-2 text-right font-mono text-nevoa">{formatUsd(row.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </div>
  );
}
