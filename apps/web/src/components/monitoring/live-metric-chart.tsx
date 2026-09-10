'use client';

import { useEffect, useRef } from 'react';
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { resolveColorVar, withAlpha } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';

/** ~10min de histórico a cada 15s de poll (o intervalo real de useInfrastructureHealth) -
 * suficiente pra ver a tendência sem guardar mais do que cabe na tela. */
const MAX_POINTS = 40;

/**
 * Substitui o MetricBar (barra estática, só o instante atual) nos dois
 * lugares que monitoram algo "ao vivo" - GPU do Studio e CPU/RAM/Disco/GPU
 * dos Mac Minis (pedido do usuário, 2026-09-05): TradingView Lightweight
 * Charts é a peça certa pra série temporal que cresce sozinha, com
 * `series.update()` empurrando só o ponto novo a cada poll em vez de
 * redesenhar tudo. O histórico mora num ref por instância - some ao
 * desmontar (navegar pra outra tela), o que é aceitável pra um sparkline de
 * tendência recente, não um registro permanente.
 */
export function LiveMetricChart({
  label,
  value,
  unit = '%',
  warnAt = 80,
  max = 100,
}: {
  label: string;
  /** null = nó sem leitura ainda (ex: offline, sem health check recente) -
   * mostra "sem dados" em vez de tentar plotar, o que o Lightweight Charts
   * rejeita com uma assertion (só aceita number). */
  value: number | null;
  unit?: string;
  warnAt?: number;
  max?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const historyRef = useRef<{ time: UTCTimestamp; value: number }[]>([]);
  const { resolvedTheme } = useTheme();
  const isHot = value !== null && value >= warnAt;

  // Monta o gráfico uma vez por vida do componente. `max` é sempre uma
  // constante do chamador (100 pra métricas percentuais) - não precisa ser
  // reativo.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 40,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: 'transparent', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: max } }),
    });

    series.setData(historyRef.current);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [max]);

  // Cor reage ao tema e ao cruzar o limiar de alerta, sem recriar o gráfico
  // (só reaplica estilo na série já existente).
  useEffect(() => {
    if (!seriesRef.current) return;
    const lineColor = resolveColorVar(isHot ? '--color-aviso' : '--color-roxo-eletrico');
    seriesRef.current.applyOptions({
      lineColor,
      topColor: withAlpha(lineColor, '4d'),
      bottomColor: withAlpha(lineColor, '00'),
    });
  }, [isHot, resolvedTheme]);

  // Ponto novo do poll (a cada 15s): acrescenta ao histórico e empurra só
  // ele pro gráfico via update() - nunca um setData() do zero, que é o que
  // faria o gráfico "recomeçar" a cada refetch. Sem leitura (null) não
  // planta ponto nenhum: o traço só some da tela.
  useEffect(() => {
    if (value === null) return;
    const time = Math.floor(Date.now() / 1000) as UTCTimestamp;
    const history = historyRef.current;
    const last = history[history.length - 1];
    if (last && time <= last.time) return;
    const point = { time, value };
    history.push(point);
    if (history.length > MAX_POINTS) history.shift();
    seriesRef.current?.update(point);
  }, [value]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-nevoa">
        <span>{label}</span>
        <span className={cn('tabular-nums', isHot ? 'text-aviso' : 'text-nevoa')}>
          {value === null ? '-' : `${value}${unit}`}
        </span>
      </div>
      <div className="relative h-10 w-full">
        <div ref={containerRef} className="size-full" />
        {/* Sem leitura ainda (nó offline, ou health check nunca rodou): texto
         * explícito em vez de deixar o canvas vazio parecendo quebrado. */}
        {value === null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] text-nevoa/50">
            sem dados
          </div>
        )}
      </div>
    </div>
  );
}
