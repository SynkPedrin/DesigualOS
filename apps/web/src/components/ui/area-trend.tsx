'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

export interface AreaTrendDatum {
  label: string;
  value: number;
}

function AreaTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ payload: AreaTrendDatum }>;
  formatValue: (value: number) => string;
}) {
  const datum = active ? payload?.[0]?.payload : undefined;
  if (!datum) return null;
  return (
    <div className="rounded-md border border-grafite-elevado bg-grafite-elevado px-3 py-2 text-xs shadow-elevated">
      <p className="font-mono text-nevoa">{datum.label}</p>
      <p className="font-medium text-branco-cru">{formatValue(datum.value)}</p>
    </div>
  );
}

export function AreaTrend({
  data,
  colorVar = '--color-roxo-eletrico',
  formatValue = (v) => String(v),
  height = 200,
}: {
  data: AreaTrendDatum[];
  colorVar?: string;
  formatValue?: (value: number) => string;
  height?: number;
}) {
  const first = data[0];
  const last = data[data.length - 1];
  const summary =
    first && last
      ? `Tendência de ${first.label} a ${last.label}: ${data.map((d) => formatValue(d.value)).join(', ')}`
      : 'Sem dados de tendência';

  return (
    <div style={{ height }} role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="area-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(${colorVar})`} stopOpacity={0.35} />
              <stop offset="100%" stopColor={`var(${colorVar})`} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            stroke="var(--color-nevoa)"
            fontSize={10}
            fontFamily="var(--font-mono)"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<AreaTooltip formatValue={formatValue} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={`var(${colorVar})`}
            strokeWidth={2}
            fill="url(#area-trend-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
