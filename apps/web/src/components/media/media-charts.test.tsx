import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ComboChart, DataBar, DeltaChip, Donut, HBars, Sparkline } from './media-charts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const brl = (v: number | null) => (v === null ? '—' : `R$ ${v.toFixed(2)}`);
const roots: Root[] = [];

function mount(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(ui));
  return { container, rerender: (next: React.ReactElement) => act(() => root.render(next)) };
}

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('gráficos de mídia', () => {
  it('Sparkline desenha a curva e, sem veiculação, diz isso em vez de uma linha zerada', () => {
    const { container, rerender } = mount(<Sparkline values={[1, 3, 2, 5]} />);
    expect(container.querySelector('polyline')).not.toBeNull();
    rerender(<Sparkline values={[0, 0, 0]} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.textContent).toContain('sem veiculação');
  });

  it('ComboChart expõe o valor de cada dia para leitor de tela e tem uma barra por dia', () => {
    const points = [
      { day: '2026-10-01', spend: 10, results: 2, costPerResult: 5 },
      { day: '2026-10-02', spend: 20, results: 0, costPerResult: null },
      { day: '2026-10-03', spend: 15, results: 3, costPerResult: 5 },
    ];
    const { container } = mount(<ComboChart points={points} formatMoney={brl} resultLabel="Leads" />);
    expect(container.querySelectorAll('rect[class*="fill-sinal"]').length).toBe(3);
    expect(container.querySelector('[aria-label="2026-10-02: investimento R$ 20.00, leads 0"]')).not.toBeNull();
  });

  it('ComboChart sem nada no período mostra estado vazio, não gráfico zerado', () => {
    const { container } = mount(<ComboChart points={[{ day: '2026-10-01', spend: 0, results: null, costPerResult: null }]} formatMoney={brl} resultLabel="Leads" />);
    expect(container.textContent).toContain('Sem investimento nem resultados');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('HBars mostra o valor de cada item e a maior barra ocupa a largura toda', () => {
    const { container } = mount(<HBars items={[{ key: 'a', label: 'A', value: 100, display: 'R$ 100' }, { key: 'b', label: 'B', value: 50, display: 'R$ 50' }]} />);
    expect(container.textContent).toContain('R$ 100');
    const fills = [...container.querySelectorAll<HTMLElement>('div[style*="width"]')].map((e) => e.style.width);
    expect(fills).toEqual(['100%', '50%']);
  });

  it('HBars vazio explica em vez de renderizar barras fantasma', () => {
    const { container } = mount(<HBars items={[]} empty="Nada aqui." />);
    expect(container.textContent).toBe('Nada aqui.');
  });

  it('Donut mostra a participação percentual de cada fatia', () => {
    const { container } = mount(<Donut centerLabel="Total" centerValue="R$ 200" items={[{ key: 'a', label: 'Camp A', value: 150, display: 'R$ 150' }, { key: 'b', label: 'Camp B', value: 50, display: 'R$ 50' }]} />);
    expect(container.textContent).toContain('75%');
    expect(container.textContent).toContain('25%');
  });

  it('DeltaChip: para custo, subir é ruim (vermelho) e cair é bom (verde); sem base não inventa', () => {
    const { container, rerender } = mount(<DeltaChip value={20} invert />);
    expect(container.firstElementChild!.className).toContain('text-erro');
    rerender(<DeltaChip value={-20} invert />);
    expect(container.firstElementChild!.className).toContain('text-sinal');
    rerender(<DeltaChip value={null} />);
    expect(container.textContent).toBe('sem base');
  });

  it('DataBar limita a barra entre 0 e 100%', () => {
    const { container } = mount(<DataBar value={500} max={100}>x</DataBar>);
    expect((container.querySelector('span[aria-hidden]') as HTMLElement).style.width).toBe('100%');
  });
});
