import { describe, expect, it } from 'vitest';
import { buildCorrectionDirective, decideQuality, selectBestCandidate, THRESHOLDS_BY_PROFILE, type DecisionContext } from './decision-engine';
import type { CriticResult } from './visual-critic';

/** Base "peça boa": passa em tudo. Cada teste degrada só o que quer testar. */
function critic(overrides: Partial<CriticResult> = {}): CriticResult {
  return {
    overall_score: 9, prompt_alignment: 9, composition: 9, lighting: 9, realism: 9,
    anatomy: 9, hands: 9, face: 9, text_integrity: 9, artifact_score: 9, commercial_quality: 9,
    problems: [], requires_regeneration: false, requires_local_edit: false, confidence: 0.9,
    provider: 'ollama', model: 'test', latencyMs: 1,
    ...overrides,
  };
}

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    critic: critic(), profile: 'standard', attempt: 1, maxAttempts: 3,
    identityCritical: false, productCritical: false,
    ...overrides,
  };
}

describe('decideQuality', () => {
  it('aprova quando todas as dimensões passam o threshold do perfil', () => {
    expect(decideQuality(ctx()).action).toBe('approve');
  });

  it('manda refazer quando a falha é estrutural (composição/aderência)', () => {
    const decision = decideQuality(ctx({ critic: critic({ composition: 3, prompt_alignment: 4, overall_score: 5 }) }));
    expect(decision.action).toBe('regenerate');
    expect(decision.failedDimensions).toContain('composition');
  });

  it('manda corrigir localmente quando só mão/rosto reprovam', () => {
    const decision = decideQuality(ctx({ critic: critic({ hands: 4, anatomy: 4 }) }));
    expect(decision.action).toBe('local_edit');
    expect(decision.targetRegions).toContain('hands');
  });

  /**
   * Caso medido de verdade (portrait.png, 16/09/2026): overall 7 passa no
   * perfil standard, mas hands=4 com um problema `high` de dedos fundidos.
   * Aprovar isso seria entregar a peça com o defeito que o cliente enxerga
   * primeiro.
   */
  it('reprova defeito localizado GRAVE mesmo com overall acima do threshold', () => {
    const decision = decideQuality(
      ctx({
        critic: critic({
          overall_score: 7.5, hands: 4, artifact_score: 6,
          problems: [{ region: 'hands', severity: 'high', description: 'fingers fused together on the hand resting on the car hood' }],
        }),
      }),
    );
    expect(decision.action).not.toBe('approve');
    expect(decision.targetRegions).toContain('hands');
  });

  /**
   * O ponto central do Decision Engine: medido que dois modelos deram os
   * MESMOS scores e recomendações OPOSTAS. O gate ignora o campo do modelo.
   */
  it('ignora o veredito do próprio modelo e decide pelos números', () => {
    const scores = { overall_score: 9, hands: 9, artifact_score: 9 } as const;
    const modelSaysRegenerate = decideQuality(ctx({ critic: critic({ ...scores, requires_regeneration: true, requires_local_edit: false }) }));
    const modelSaysEdit = decideQuality(ctx({ critic: critic({ ...scores, requires_regeneration: false, requires_local_edit: true }) }));
    expect(modelSaysRegenerate.action).toBe('approve');
    expect(modelSaysEdit.action).toBe('approve');
  });

  /** Medido: nenhum modelo local acerta text_integrity. Não pode reprovar peça sozinho. */
  it('não reprova a peça só por text_integrity baixo', () => {
    expect(decideQuality(ctx({ critic: critic({ text_integrity: 1 }) })).action).toBe('approve');
  });

  it('respeita MAX_ATTEMPTS e cai pro melhor candidato em vez de pedir correção eterna', () => {
    const decision = decideQuality(ctx({ critic: critic({ composition: 2, overall_score: 3 }), attempt: 3, maxAttempts: 3 }));
    expect(decision.action).toBe('accept_best');
  });

  it('draft é mais permissivo que master na MESMA imagem', () => {
    const borderline = critic({ overall_score: 7.5, artifact_score: 5.5, prompt_alignment: 7.5, composition: 6.5, anatomy: 7, hands: 7, face: 7 });
    expect(decideQuality(ctx({ critic: borderline, profile: 'draft' })).action).toBe('approve');
    expect(decideQuality(ctx({ critic: borderline, profile: 'master' })).action).not.toBe('approve');
  });

  it('só cobra fidelidade de identidade quando o job declara identidade crítica', () => {
    const weakFace = critic({ face: 7.2 });
    expect(decideQuality(ctx({ critic: weakFace, profile: 'master', identityCritical: false })).action).toBe('approve');
    expect(decideQuality(ctx({ critic: weakFace, profile: 'master', identityCritical: true })).action).not.toBe('approve');
  });

  it('expõe os thresholds usados, pro laudo do job', () => {
    expect(decideQuality(ctx({ profile: 'master' })).thresholds).toEqual(THRESHOLDS_BY_PROFILE.master);
  });
});

describe('selectBestCandidate', () => {
  it('escolhe o maior overall, não a última tentativa', () => {
    const best = selectBestCandidate([
      { attempt: 1, critic: critic({ overall_score: 8.1 }), payload: 'a' },
      { attempt: 2, critic: critic({ overall_score: 8.8 }), payload: 'b' },
      { attempt: 3, critic: critic({ overall_score: 8.4 }), payload: 'c' },
    ]);
    expect(best.payload).toBe('b');
  });

  it('desempata overall igual por menos artefato', () => {
    const best = selectBestCandidate([
      { attempt: 1, critic: critic({ overall_score: 8, artifact_score: 5 }), payload: 'ruidosa' },
      { attempt: 2, critic: critic({ overall_score: 8, artifact_score: 9 }), payload: 'limpa' },
    ]);
    expect(best.payload).toBe('limpa');
  });

  it('falha alto quando não há candidato (nunca devolve undefined silencioso)', () => {
    expect(() => selectBestCandidate([])).toThrow(/nenhuma tentativa/);
  });
});

describe('buildCorrectionDirective', () => {
  it('pede mão correta quando a região alvo é hands', () => {
    const c = critic({ hands: 3, problems: [{ region: 'hands', severity: 'high', description: 'fused fingers' }] });
    const directive = buildCorrectionDirective(decideQuality(ctx({ critic: c })), c);
    expect(directive).toMatch(/hands/i);
    expect(directive).toMatch(/fused fingers/);
  });

  it('fica curto - prompt de correção longo dilui o briefing original', () => {
    const c = critic({
      hands: 2, face: 2, composition: 2, prompt_alignment: 2,
      problems: Array.from({ length: 8 }, (_, i) => ({ region: 'hands' as const, severity: 'high' as const, description: `defeito muito longo número ${i} `.repeat(20) })),
    });
    expect(buildCorrectionDirective(decideQuality(ctx({ critic: c })), c).length).toBeLessThan(700);
  });
});
