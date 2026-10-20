import { describe, expect, it } from 'vitest';
import { deriveMetrics, pctChange, previousRange, resolvePeriod, daysIn } from './media-metrics';

describe('deriveMetrics', () => {
  it('calcula CTR, CPC, CPM, custo por resultado e ROAS', () => {
    const m = deriveMetrics({ spend: 100, impressions: 10000, reach: 8000, clicks: 200, results: 10, conversionValue: 500 });
    expect(m).toMatchObject({ ctr: 2, cpc: 0.5, cpm: 10, costPerResult: 10, roas: 5 });
  });
  it('divisão por zero é null, não 0', () => {
    const m = deriveMetrics({ spend: 50, impressions: 0, reach: 0, clicks: 0, results: 0, conversionValue: null });
    expect(m.ctr).toBeNull();
    expect(m.cpc).toBeNull();
    expect(m.costPerResult).toBeNull();
    expect(m.roas).toBeNull();
  });
  it('dado ausente continua ausente', () => {
    expect(deriveMetrics({ spend: null, impressions: null, reach: null, clicks: null, results: null, conversionValue: null }).cpm).toBeNull();
  });
});

describe('pctChange', () => {
  it('variação normal e queda', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(50, 100)).toBe(-50);
  });
  it('sem base de comparação não inventa infinito', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(10, null)).toBeNull();
  });
});

describe('períodos', () => {
  const now = new Date('2026-10-20T02:00:00Z'); // 23h de 19/10 em Brasília
  it('"hoje" respeita o fuso da agência, não UTC', () => {
    expect(resolvePeriod('today', now)).toEqual({ since: '2026-10-19', until: '2026-10-19' });
  });
  it('últimos 7 dias incluem hoje e têm 7 dias', () => {
    const r = resolvePeriod('last_7d', now);
    expect(r).toEqual({ since: '2026-10-13', until: '2026-10-19' });
    expect(daysIn(r)).toBe(7);
  });
  it('mês anterior cobre o mês inteiro', () => {
    expect(resolvePeriod('last_month', now)).toEqual({ since: '2026-09-01', until: '2026-09-30' });
  });
  it('período anterior tem a mesma duração e termina na véspera', () => {
    const cur = resolvePeriod('last_14d', now);
    const prev = previousRange(cur);
    expect(daysIn(prev)).toBe(14);
    expect(prev.until).toBe('2026-10-05');
  });
});
