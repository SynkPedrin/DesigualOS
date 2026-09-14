import { describe, expect, it } from 'vitest';
import {
  applyFeedbackToLearning,
  feedbackSubject,
  learningKindForVerdict,
  type OttoLearningPersistedState,
} from './feedback.js';

describe('feedback -> funil de confiança', () => {
  it('mapeia verdict pro kind certo', () => {
    expect(learningKindForVerdict('approved')).toBe('otto.approval_reason');
    expect(learningKindForVerdict('rejected')).toBe('otto.rejection_reason');
    expect(learningKindForVerdict('needs_iteration')).toBe('otto.rejection_reason');
  });

  it('subject ignora caixa, acento e pontuação do motivo', () => {
    const a = feedbackSubject('otto.rejection_reason', 'Cliente NÃO quer gradiente!');
    const b = feedbackSubject('otto.rejection_reason', 'cliente nao quer gradiente');
    expect(a).toBe(b);
  });

  it('primeiro feedback já promove pra experimental (1 evidência humana basta), com conteúdo >= 25 chars', () => {
    const t = applyFeedbackToLearning(null, { verdict: 'approved', reason: 'paleta terrosa', isDirector: false }, 'c1');
    // Regra do funil: experimental pede 1 evidência e confiança >= 0.3 — o
    // primeiro feedback humano já cumpre, então ninguém fica parado em
    // observation.
    expect(t.learning.stage).toBe('experimental');
    expect(t.promoted).toBe(true);
    expect(t.learning.evidences).toHaveLength(1);
    expect(t.content.length).toBeGreaterThanOrEqual(25);
    // feedback sem motivo também nasce persistível (memory-engine corta < 25 chars)
    const semMotivo = applyFeedbackToLearning(null, { verdict: 'rejected', isDirector: false }, 'c1');
    expect(semMotivo.content.length).toBeGreaterThanOrEqual(25);
    expect(semMotivo.subject).toBe('otto.rejection_reason:sem-motivo');
  });

  it('1 evidência humana já promove observation -> experimental', () => {
    const t = applyFeedbackToLearning(null, { verdict: 'rejected', reason: 'gradiente', isDirector: false }, 'c1');
    expect(t.promoted).toBe(true);
    expect(t.learning.stage).toBe('experimental');
  });

  it('feedback recorrente no mesmo subject acumula evidência no MESMO aprendizado', () => {
    const first = applyFeedbackToLearning(null, { verdict: 'approved', reason: 'flat design', isDirector: false }, 'c1');
    const state: OttoLearningPersistedState = {
      stage: first.learning.stage,
      confidence: first.learning.confidence,
      evidences: first.learning.evidences,
    };
    const second = applyFeedbackToLearning(
      { content: first.content, state },
      { verdict: 'approved', reason: 'Flat Design.', isDirector: false },
      'c1',
    );
    expect(second.subject).toBe(first.subject);
    expect(second.learning.evidences).toHaveLength(2);
    // conteúdo original preservado: a linha é a mesma, só o estado evolui
    expect(second.content).toBe(first.content);
  });

  it('master conta como director; colaborador como human_feedback', () => {
    const diretor = applyFeedbackToLearning(null, { verdict: 'approved', isDirector: true }, 'c1');
    expect(diretor.learning.evidences[0]?.origin).toBe('director');
    const equipe = applyFeedbackToLearning(null, { verdict: 'approved', isDirector: false }, 'c1');
    expect(equipe.learning.evidences[0]?.origin).toBe('human_feedback');
  });

  it('needs_iteration pesa menos que rejeição explícita', () => {
    const parcial = applyFeedbackToLearning(null, { verdict: 'needs_iteration', isDirector: false }, 'c1');
    const explicita = applyFeedbackToLearning(null, { verdict: 'rejected', isDirector: false }, 'c1');
    // mesma origem e mesmo sinal: a confiança menor é a do peso menor
    expect(parcial.learning.confidence).toBeLessThan(explicita.learning.confidence);
  });
});
