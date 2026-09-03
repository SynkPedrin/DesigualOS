'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  colorVar: string;
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DonutDatum }> }) {
  const datum = active ? payload?.[0]?.payload : undefined;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-grafite-elevado bg-grafite-elevado px-3 py-2 text-xs shadow-elevated">
      <p className="font-medium text-branco-cru">{datum.label}</p>
      <p className="font-mono text-nevoa">{datum.value.toLocaleString('pt-BR')}</p>
    </div>
  );
}

export function DonutChart({
  data,
  centerLabel,
  centerValue,
  formatValue = (v) => v.toLocaleString('pt-BR'),
}: {
  data: DonutDatum[];
  centerLabel: string;
  centerValue: string | number;
  formatValue?: (value: number) => string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative h-52 w-52 shrink-0" role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="var(--color-carbono)"
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell key={entry.key} fill={`var(${entry.colorVar})`} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{centerLabel}</p>
          <p className="font-display text-2xl font-black text-branco-cru">{centerValue}</p>
        </div>
      </div>

      <div className="flex-1 space-y-2">
        {data.map((entry) => {
          const percent = total > 0 ? Math.round((entry.value / total) * 100) : 0;
          return (
            <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn('size-2.5 shrink-0 rounded-full')}
                  style={{ backgroundColor: `var(${entry.colorVar})` }}
                />
                <span className="truncate text-branco-cru">{entry.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-nevoa">
                <span>{formatValue(entry.value)}</span>
                <span className="w-9 text-right tabular-nums">{percent}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
