import { describe, expect, it } from 'vitest';
import {
  classifyMetricAvailability,
  computeChangePercent,
  isSampleTooSmall,
  percentagePointsDelta,
  verifyClaimedChangePercent,
  verifyClaimedPercentagePoints,
  verifyClaimedRatio,
} from './metric-verifier';

/**
 * Suite offline/sintética — nenhuma chamada de rede, nenhum dado real de
 * cliente. Os cenários espelham os fixtures pedidos na auditoria sênior de
 * Jarbas (24/09/2026, §37): CPL subiu, CTR caiu, gasto zero, amostra
 * pequena, denominador inválido.
 */

describe('computeChangePercent / verifyClaimedChangePercent', () => {
  it('CPL de 40 pra 52 é +30% (regra do §4: exemplo oficial da auditoria)', () => {
    expect(computeChangePercent(52, 40)).toBeCloseTo(30, 5);
    expect(verifyClaimedChangePercent(30, 52, 40).ok).toBe(true);
  });

  it('alegação errada (23% quando o real é 30%) é rejeitada com o valor esperado', () => {
    const r = verifyClaimedChangePercent(23, 52, 40);
    expect(r.ok).toBe(false);
    expect(r.expected).toBeCloseTo(30, 5);
  });

  it('valor anterior zero nunca produz percentual — denominador inválido tratado, não inventado', () => {
    expect(computeChangePercent(50, 0)).toBeNull();
    const r = verifyClaimedChangePercent(999, 50, 0);
    expect(r.ok).toBe(false);
    expect(r.expected).toBeNull();
    expect(r.reason).toMatch(/denominador inválido/);
  });

  it('queda também funciona (variação negativa)', () => {
    expect(computeChangePercent(30, 40)).toBeCloseTo(-25, 5);
  });
});

describe('percentagePointsDelta / verifyClaimedPercentagePoints — nunca confundir pp com % relativo', () => {
  it('CTR de 10% pra 12% é +2 pontos percentuais, NÃO +20%', () => {
    expect(percentagePointsDelta(12, 10)).toBeCloseTo(2, 5);
    expect(verifyClaimedPercentagePoints(2, 12, 10).ok).toBe(true);
  });

  it('a mesma dupla (10% -> 12%) em variação RELATIVA é +20%, não +2 — não são intercambiáveis', () => {
    expect(computeChangePercent(12, 10)).toBeCloseTo(20, 5);
  });

  it('alegar "+20pp" quando o real é "+2pp" é rejeitado (a confusão que a regra existe pra pegar)', () => {
    const r = verifyClaimedPercentagePoints(20, 12, 10);
    expect(r.ok).toBe(false);
    expect(r.expected).toBeCloseTo(2, 5);
  });
});

describe('verifyClaimedRatio — CTR/taxa de conversão contra numerador e denominador reais', () => {
  it('clicks=100, impressions=1000 -> CTR real 10%, alegação de 10% confirma', () => {
    expect(verifyClaimedRatio(10, 100, 1000).ok).toBe(true);
  });

  it('alegação de 15% quando o real é 10% é rejeitada', () => {
    const r = verifyClaimedRatio(15, 100, 1000);
    expect(r.ok).toBe(false);
    expect(r.expected).toBeCloseTo(10, 5);
  });

  it('impressions=0 (fixture "zero spend"/sem veiculação) nunca produz uma taxa', () => {
    const r = verifyClaimedRatio(5, 0, 0);
    expect(r.ok).toBe(false);
    expect(r.expected).toBeNull();
  });

  it('denominador negativo (dado corrompido) também falha fechado, nunca calcula', () => {
    const r = verifyClaimedRatio(5, 10, -1);
    expect(r.ok).toBe(false);
    expect(r.expected).toBeNull();
  });
});

describe('classifyMetricAvailability — 0, NULL, MISSING, NOT_TRACKED, DELAYED nunca se confundem', () => {
  it('valor real 0 (fixture "zero leads") é available, não missing', () => {
    expect(classifyMetricAvailability({ raw: 0, fieldPresent: true, tracked: true })).toBe('available');
  });

  it('fonte devolveu null explícito é null, não vira 0', () => {
    expect(classifyMetricAvailability({ raw: null, fieldPresent: true, tracked: true })).toBe('null');
  });

  it('campo nem veio na resposta é missing, diferente de null', () => {
    expect(classifyMetricAvailability({ raw: undefined, fieldPresent: false, tracked: true })).toBe('missing');
  });

  it('métrica que a conta não rastreia é not_tracked, nunca 0', () => {
    expect(classifyMetricAvailability({ raw: null, fieldPresent: false, tracked: false })).toBe('not_tracked');
  });

  it('atribuição atrasada (fixture "delayed attribution") é delayed, não um valor final', () => {
    expect(classifyMetricAvailability({ raw: 3, fieldPresent: true, tracked: true, delayed: true })).toBe('delayed');
  });
});

describe('isSampleTooSmall — fixtures de amostra insuficiente', () => {
  it('3 leads / R$20 de gasto (exemplo oficial do §13) é amostra pequena', () => {
    expect(isSampleTooSmall({ conversions: 3, spend: 20 })).toBe(true);
  });

  it('campanha nova com volume saudável não é sinalizada', () => {
    expect(isSampleTooSmall({ conversions: 40, spend: 500, impressions: 20_000 })).toBe(false);
  });

  it('impressões muito baixas sozinhas já bastam pra sinalizar', () => {
    expect(isSampleTooSmall({ impressions: 200 })).toBe(true);
  });
});
