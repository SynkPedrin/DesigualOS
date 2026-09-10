'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { PieChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ComposeOption } from 'echarts/core';
import type { PieSeriesOption } from 'echarts/charts';
import type { TooltipComponentOption } from 'echarts/components';

// Import modular (não `import echarts from 'echarts'`) por tamanho de bundle:
// só registra os módulos que o Desigual OS de fato usa hoje (pie + tooltip).
// Novo tipo de gráfico ECharts em outro lugar do app? Registra aqui também.
echarts.use([PieChart, TooltipComponent, SVGRenderer]);

export type EChartsOption = ComposeOption<PieSeriesOption | TooltipComponentOption>;

/**
 * Wrapper mínimo React em volta da API imperativa do ECharts (init/setOption/
 * dispose) - sem depender do pacote echarts-for-react, que é fino demais pra
 * justificar mais uma dependência. Renderer SVG (não canvas): o tooltip e a
 * legenda continuam DOM/CSS normal por fora, só a peça do gráfico em si é o
 * ECharts.
 */
export function EChart({
  option,
  height = 208,
  className,
}: {
  option: EChartsOption;
  height?: number | string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: 'svg' });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} className={className} style={{ height }} />;
}
