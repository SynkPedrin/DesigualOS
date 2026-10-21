import { describe, expect, it } from 'vitest';
import { buildInsights } from './media-hub';
import { deriveMetrics } from './media-metrics';

const km = (o: Partial<Parameters<typeof deriveMetrics>[0]>) => deriveMetrics({ spend: null, impressions: null, reach: null, clicks: null, results: null, conversionValue: null, ...o });
const base = { currency: 'BRL', current: km({ spend: 100, results: 10 }), previous: km({ spend: 100, results: 10 }), changes: { costPerResult: 0, spend: 0 } as Record<string, number | null> };
const ad = (name: string, impressions: number, clicks: number, spend = 10, results = 1) => ({ name, impressions, clicks, spend, results, costPerResult: results ? spend / results : null });

describe('buildInsights — só diz o que consegue medir', () => {
  it('sem base de comparação não escreve insight de variação', () => {
    const out = buildInsights({ kpis: { ...base, previous: null, changes: null }, ads: [], capUsage: [] });
    expect(out).toEqual([]);
  });
  it('queda de custo por resultado é boa notícia e traz os dois números', () => {
    const out = buildInsights({ kpis: { currency: 'BRL', current: km({ spend: 80, results: 10 }), previous: km({ spend: 100, results: 10 }), changes: { costPerResult: -20, spend: -20 } }, ads: [], capUsage: [] });
    const cpr = out.find((i) => i.id === 'cpr')!;
    expect(cpr.tone).toBe('good');
    expect(cpr.title).toContain('caiu 20,0%');
    expect(cpr.detail).toContain('R$');
  });
  it('alta forte de custo por resultado vira alerta, alta leve só informa', () => {
    const mk = (ch: number) => buildInsights({ kpis: { currency: 'BRL', current: km({ spend: 130, results: 10 }), previous: km({ spend: 100, results: 10 }), changes: { costPerResult: ch, spend: 0 } }, ads: [], capUsage: [] }).find((i) => i.id === 'cpr')!;
    expect(mk(30).tone).toBe('warn');
    expect(mk(5).tone).toBe('info');
  });
  it('CTR acima da média exige amostra: anúncio com poucas impressões é ruído', () => {
    const poucos = [ad('A', 200, 20), ad('B', 300, 1), ad('C', 100, 1), ad('D', 100, 1)];
    expect(buildInsights({ kpis: base, ads: poucos, capUsage: [] }).some((i) => i.id === 'ctr-acima')).toBe(false);
    const ok = [ad('A', 10000, 400), ad('B', 10000, 100), ad('C', 10000, 100), ad('D', 10000, 100)];
    const r = buildInsights({ kpis: base, ads: ok, capUsage: [] }).find((i) => i.id === 'ctr-acima')!;
    expect(r.title).toContain('1 criativo');
  });
  it('limite de gastos só alerta a partir de 80%', () => {
    const r = buildInsights({ kpis: base, ads: [], capUsage: [{ accountName: 'Conta X', percent: 79 }, { accountName: 'Conta Y', percent: 92 }] });
    expect(r.filter((i) => i.id.startsWith('limite')).map((i) => i.title)).toEqual(['Conta Y usou 92% do limite de gastos']);
  });
  it('melhor criativo exige 2+ resultados (um resultado só não é eficiência)', () => {
    expect(buildInsights({ kpis: base, ads: [ad('Solo', 5000, 50, 10, 1)], capUsage: [] }).some((i) => i.id === 'melhor')).toBe(false);
    expect(buildInsights({ kpis: base, ads: [ad('Dupla', 5000, 50, 10, 2)], capUsage: [] }).some((i) => i.id === 'melhor')).toBe(true);
  });
});
