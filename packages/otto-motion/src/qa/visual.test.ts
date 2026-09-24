import { describe, expect, it } from 'vitest';
import { buildQualityScore, parseVisualQa, shouldBlockDelivery } from './visual.js';

describe('parseVisualQa', () => {
  it('lê aprovação limpa', () => {
    const report = parseVisualQa('VEREDITO: QUALITY_PASS\n\nSCORES:\nvisual: 88\nbrand: 92\nlegibility: 85\ncomposition: 90');
    expect(report.verdict).toBe('QUALITY_PASS');
    expect(report.scores).toEqual({ visual: 88, brand: 92, legibility: 85, composition: 90 });
  });

  it('lê reprovação com a lista de problemas', () => {
    const report = parseVisualQa(
      'VEREDITO: REQUIRES_FIX\n\nPROBLEMAS:\n- [frame 3.5s] o headline encosta na borda\n- [geral] o CTA some antes de dar pra ler\n\nSCORES:\nvisual: 60\nlegibility: 45',
    );
    expect(report.verdict).toBe('REQUIRES_FIX');
    expect(report.problems).toHaveLength(2);
    expect(report.scores.legibility).toBe(45);
  });

  it('veredito ilegível reprova — aprovar às cegas publicaria peça sem revisão', () => {
    expect(parseVisualQa('achei que ficou legal').verdict).toBe('REQUIRES_FIX');
  });

  it('citar os dois vereditos também reprova', () => {
    expect(parseVisualQa('VEREDITO: QUALITY_PASS ou VEREDITO: REQUIRES_FIX').verdict).toBe('REQUIRES_FIX');
  });

  it('ignora score fora da faixa', () => {
    expect(parseVisualQa('VEREDITO: QUALITY_PASS\nvisual: 300').scores.visual).toBe(0);
  });
});

describe('shouldBlockDelivery (§44)', () => {
  it('barra abaixo do piso técnico, mesmo com visual impecável', () => {
    const visual = parseVisualQa('VEREDITO: QUALITY_PASS\nvisual: 99\nbrand: 99\nlegibility: 99\ncomposition: 99');
    expect(shouldBlockDelivery({ technicalScore: 94, visual }).blocked).toBe(true);
  });

  it('libera com técnico cheio e visual aprovado', () => {
    const visual = parseVisualQa('VEREDITO: QUALITY_PASS\nvisual: 80\nbrand: 80\nlegibility: 80\ncomposition: 80');
    expect(shouldBlockDelivery({ technicalScore: 100, visual }).blocked).toBe(false);
  });

  it('barra quando a revisão apontou problema, mesmo com técnico cheio', () => {
    const visual = parseVisualQa('VEREDITO: REQUIRES_FIX\nPROBLEMAS:\n- texto cortado no frame 2');
    expect(shouldBlockDelivery({ technicalScore: 100, visual }).blocked).toBe(true);
  });

  it('barra por legibilidade baixa mesmo com veredito de aprovação', () => {
    const visual = parseVisualQa('VEREDITO: QUALITY_PASS\nlegibility: 40');
    expect(shouldBlockDelivery({ technicalScore: 100, visual }).blocked).toBe(true);
  });

  it('sem revisão visual, o técnico sozinho decide', () => {
    expect(shouldBlockDelivery({ technicalScore: 100, visual: null }).blocked).toBe(false);
  });
});

describe('buildQualityScore', () => {
  it('zera os visuais quando não houve revisão, em vez de inventar número', () => {
    expect(buildQualityScore(100, null)).toEqual({
      technical: 100,
      visual: 0,
      brand: 0,
      legibility: 0,
      composition: 0,
    });
  });
});
