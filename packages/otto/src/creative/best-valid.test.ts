import { describe, expect, it } from 'vitest';
import { selectBestValidCandidate, type CandidateRecord } from './best-valid.js';

function candidate(overrides: Partial<CandidateRecord<string>> & { qualityScore: number; order: number }): CandidateRecord<string> {
  const unsupportedClaims = overrides.unsupportedClaims ?? [];
  return {
    stage: `stage-${overrides.order}`,
    value: `value-${overrides.order}`,
    schemaValid: true,
    semanticComplete: true,
    // Deriva de unsupportedClaims por padrão — um candidato com claim
    // sinalizada é factualmente inválido, salvo override explícito do teste.
    factuallyValid: unsupportedClaims.length === 0,
    criticalDimensionScores: { concept: 9, copy: 9, executability: 9 },
    unsupportedClaims,
    ...overrides,
  };
}

describe('selectBestValidCandidate (Otto Senior V1, best-valid fix)', () => {
  /**
   * REGRESSÃO REAL: achado ao vivo com qwen3.6:35b-a3b nesta mesma sessão —
   * draft=45, reescrita#1=43, reparo de execução=39, todos estruturalmente
   * válidos. O sistema entregava 39 (o mais recente); devia entregar 45
   * (o melhor).
   */
  it('45 → 43 → 39, todos válidos: escolhe 45 (o melhor, não o mais recente)', () => {
    const candidates = [
      candidate({ qualityScore: 45, order: 0 }),
      candidate({ qualityScore: 43, order: 1 }),
      candidate({ qualityScore: 39, order: 2 }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.qualityScore).toBe(45);
  });

  it('70 → 86 → 82, todos válidos: escolhe 86 (a reescrita melhorou, mas a segunda regrediu)', () => {
    const candidates = [
      candidate({ qualityScore: 70, order: 0 }),
      candidate({ qualityScore: 86, order: 1 }),
      candidate({ qualityScore: 82, order: 2 }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.qualityScore).toBe(86);
  });

  it('válido → inválido: mantém o válido, mesmo sendo mais antigo', () => {
    const candidates = [
      candidate({ qualityScore: 80, order: 0 }),
      candidate({ qualityScore: 95, order: 1, schemaValid: false }), // reescrita quebrou/regrediu
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.order).toBe(0);
    expect(winner?.qualityScore).toBe(80);
  });

  it('válido mas com unsupported claim: NÃO é elegível, mesmo com nota mais alta', () => {
    const candidates = [
      candidate({ qualityScore: 85, order: 0 }),
      candidate({ qualityScore: 95, order: 1, unsupportedClaims: ['garanta sua vaga'] }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.order).toBe(0);
    expect(winner?.qualityScore).toBe(85);
  });

  it('semanticamente incompleto com nota mais alta: NÃO é elegível', () => {
    const candidates = [
      candidate({ qualityScore: 82, order: 0 }),
      candidate({ qualityScore: 93, order: 1, semanticComplete: false }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.order).toBe(0);
    expect(winner?.qualityScore).toBe(82);
  });

  it('mesma nota geral, dimensões críticas mais fortes vence', () => {
    const candidates = [
      candidate({ qualityScore: 88, order: 0, criticalDimensionScores: { concept: 8, copy: 9, executability: 9 } }),
      candidate({ qualityScore: 88, order: 1, criticalDimensionScores: { concept: 9, copy: 9, executability: 9 } }),
    ];
    const winner = selectBestValidCandidate(candidates);
    // O segundo tem zero dimensões abaixo de 8 (nenhuma "deficiência crítica");
    // o primeiro tem concept=8 que não conta como deficiência (< 8 é o corte),
    // então ambos empatam em deficiências — desempate cai pro mínimo: o
    // segundo tem mínimo 9 > mínimo 8 do primeiro.
    expect(winner?.order).toBe(1);
  });

  it('mesma nota geral, uma versão com dimensão crítica abaixo de 8: a sem deficiência vence', () => {
    const candidates = [
      candidate({ qualityScore: 85, order: 0, criticalDimensionScores: { concept: 7, copy: 9, executability: 9, hook: 9 } }),
      candidate({ qualityScore: 85, order: 1, criticalDimensionScores: { concept: 8, copy: 9, executability: 9, hook: 9 } }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.order).toBe(1);
  });

  it('tudo igual (nota, deficiências, claims, mínimo): o mais recente vence, como ÚLTIMO desempate', () => {
    const candidates = [
      candidate({ qualityScore: 88, order: 0 }),
      candidate({ qualityScore: 88, order: 1 }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner?.order).toBe(1);
  });

  it('sem nenhum candidato elegível (todos com claim ou incompletos), cai pro melhor schema_valid — nunca null havendo algum candidato', () => {
    const candidates = [
      candidate({ qualityScore: 60, order: 0, unsupportedClaims: ['x'] }),
      candidate({ qualityScore: 75, order: 1, semanticComplete: false }),
    ];
    const winner = selectBestValidCandidate(candidates);
    expect(winner).not.toBeNull();
    expect(winner?.qualityScore).toBe(75); // melhor nota entre os schema_valid restantes
  });

  it('lista vazia devolve null (nenhum candidato existiu — chamador decide o fallback)', () => {
    expect(selectBestValidCandidate([])).toBeNull();
  });

  it('nenhum candidato sequer schema_valid devolve null', () => {
    const candidates = [candidate({ qualityScore: 90, order: 0, schemaValid: false })];
    expect(selectBestValidCandidate(candidates)).toBeNull();
  });
});
