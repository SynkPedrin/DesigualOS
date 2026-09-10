'use client';

import { useEffect, useRef } from 'react';
import { AreaSeries, ColorType, LineStyle, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { resolveColorVar, withAlpha } from '@/lib/chart-colors';

export interface AreaTrendDatum {
  /** "MM-DD" (ver app/(shell)/page.tsx) - sem ano porque a origem é uma janela
   * curta (7-30 dias); toTime() abaixo completa com o ano atual. */
  label: string;
  value: number;
}

/** Lightweight Charts exige tempo real, ordenado e único no eixo - "MM-DD"
 * batizado com o ano corrente resolve isso sem mudar o formato que os
 * chamadores já produzem. */
function toTime(label: string): Time {
  return `${new Date().getFullYear()}-${label}` as Time;
}

/**
 * Tendência ao longo do tempo (ex: execuções por dia) via TradingView
 * Lightweight Charts em vez de recharts: é a peça pensada pra série temporal
 * com crosshair e atualização eficiente, o formato certo pra "dados ao vivo"
 * quando o período virar streaming em vez de snapshot.
 */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;

    const textColor = resolveColorVar('--color-nevoa');
    const lineColor = resolveColorVar(colorVar);
    const crosshairColor = resolveColorVar('--color-grafite-elevado');

    let chart: IChartApi | null = null;
    let series: ISeriesApi<'Area'> | null = null;

    chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        // Logo de atribuição do TradingView desligado aqui: o link exigido pela
        // licença já vive uma vez só em /settings (ver comentário lá).
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        tickMarkFormatter: (time: string) => String(time).slice(5),
      },
      crosshair: {
        vertLine: { color: crosshairColor, labelVisible: false, style: LineStyle.Dashed },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    });

    series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: withAlpha(lineColor, '59'),
      bottomColor: withAlpha(lineColor, '00'),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 4,
    });

    series.setData(data.map((d) => ({ time: toTime(d.label), value: d.value })));
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !series) {
        tooltip.style.opacity = '0';
        return;
      }
      const point = param.seriesData.get(series);
      const value = point && 'value' in point ? point.value : undefined;
      if (value === undefined) {
        tooltip.style.opacity = '0';
        return;
      }
      tooltip.style.opacity = '1';
      tooltip.style.left = `${param.point.x}px`;
      tooltip.style.top = `${param.point.y}px`;
      tooltip.textContent = formatValue(value);
    });

    const resizeObserver = new ResizeObserver(() => {
      chart?.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart?.remove();
    };
  }, [data, colorVar, height, formatValue, resolvedTheme]);

  const first = data[0];
  const last = data[data.length - 1];
  const summary =
    first && last
      ? `Tendência de ${first.label} a ${last.label}: ${data.map((d) => formatValue(d.value)).join(', ')}`
      : 'Sem dados de tendência';

  return (
    <div style={{ height }} className="relative" role="img" aria-label={summary}>
      <div ref={containerRef} className="size-full" />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-grafite-elevado bg-grafite-elevado px-2.5 py-1.5 text-xs font-medium text-branco-cru opacity-0 shadow-elevated transition-opacity"
        style={{ top: 0, left: 0 }}
      />
    </div>
  );
}
