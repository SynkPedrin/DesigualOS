'use client';

import { useMemo } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { resolveColorVar } from '@/lib/chart-colors';
import { EChart, type EChartsOption } from './echart';

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  colorVar: string;
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
  const { resolvedTheme } = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0);

  // resolvedTheme como dep: refaz as cores (lidas de getComputedStyle) quando
  // o tema muda, senão o donut ficaria com a paleta antiga até o próximo re-render.
  const option: EChartsOption = useMemo(() => {
    const strokeColor = resolveColorVar('--color-carbono');
    const tooltipBg = resolveColorVar('--color-grafite-elevado');
    const textColor = resolveColorVar('--color-branco-cru');
    const mutedColor = resolveColorVar('--color-nevoa');

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBg,
        borderColor: tooltipBg,
        borderWidth: 1,
        extraCssText: 'box-shadow: 0 8px 40px rgba(107, 33, 168, 0.25); border-radius: 6px;',
        textStyle: { color: textColor, fontSize: 12, fontFamily: 'var(--font-body)' },
        formatter: (params) => {
          const item = Array.isArray(params) ? params[0] : params;
          const value = formatValue(Number(item?.value ?? 0));
          return `<strong>${item?.name ?? ''}</strong><br/><span style="color:${mutedColor}">${value}</span>`;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['68%', '100%'],
          center: ['50%', '50%'],
          padAngle: 2,
          itemStyle: { borderColor: strokeColor, borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scaleSize: 4 },
          data: data.map((entry) => ({
            id: entry.key,
            name: entry.label,
            value: entry.value,
            itemStyle: { color: resolveColorVar(entry.colorVar) },
          })),
        },
      ],
    };
  }, [data, formatValue, resolvedTheme]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative h-52 w-52 shrink-0" role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <EChart option={option} height="100%" className="size-full" />
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
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${entry.colorVar})` }} />
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
