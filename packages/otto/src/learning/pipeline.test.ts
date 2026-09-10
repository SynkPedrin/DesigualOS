import { describe, expect, it } from 'vitest';
import {
  canPromote,
  createLearning,
  nextStage,
  promoteLearning,
  recordEvidence,
} from './pipeline.js';
import type { OttoEvidence } from './pipeline.js';

const positive = (origin: OttoEvidence['origin']): OttoEvidence => ({ origin, positive: true });

describe('learning pipeline', () => {
  it('nasce em observation com confiança neutra', () => {
    const learning = createLearning({ kind: 'otto.preference', content: 'Cliente prefere paleta terrosa' });
    expect(learning.stage).toBe('observation');
    expect(learning.confidence).toBe(0.5);
  });

  it('observation -> experimental pede 1 evidência', () => {
    const learning = createLearning({ kind: 'otto.observation', content: 'x' });
    expect(canPromote(learning, 'experimental').allowed).toBe(false);
    const withEvidence = recordEvidence(learning, positive('metric'));
    expect(canPromote(withEvidence, 'experimental').allowed).toBe(true);
  });

  it('validated exige evidência HUMANA: auto_eval sozinha não valida', () => {
    let learning = createLearning({ kind: 'otto.pattern', content: 'x' });
    // 3 evidências do próprio QC do Otto: confiança sobe, mas a origem falta.
    for (let i = 0; i < 3; i += 1) {
      learning = recordEvidence(learning, positive('auto_eval'));
    }
    learning = { ...learning, stage: 'experimental' };
    const check = canPromote(learning, 'validated');
    expect(check.allowed).toBe(false);
    expect(check.blockers.some((blocker) => blocker.includes('human_feedback'))).toBe(true);

    // Com evidência humana positiva no histórico, destrava.
    const withHuman = recordEvidence(learning, positive('human_feedback'));
    expect(canPromote(withHuman, 'validated').allowed).toBe(true);
  });

  it('core exige evidência do diretor, não importa o volume de feedback humano', () => {
    let learning = createLearning({ kind: 'otto.brand_rule', content: 'x' });
    for (let i = 0; i < 25; i += 1) {
      learning = recordEvidence(learning, positive('human_feedback'));
    }
    learning = { ...learning, stage: 'trusted' };
    const check = canPromote(learning, 'core');
    expect(check.allowed).toBe(false);
    expect(check.blockers.some((blocker) => blocker.includes('director'))).toBe(true);

    const withDirector = recordEvidence(learning, positive('director'));
    expect(canPromote(withDirector, 'core').allowed).toBe(true);
  });

  it('evidência negativa derruba a confiança e bloqueia promoção', () => {
    let learning = createLearning({ kind: 'otto.pattern', content: 'x' });
    learning = recordEvidence(learning, positive('human_feedback'));
    const before = learning.confidence;
    learning = recordEvidence(learning, { origin: 'human_feedback', positive: false });
    expect(learning.confidence).toBeLessThan(before);
  });

  it('não pula estágio (observation direto pra trusted é bloqueado)', () => {
    let learning = createLearning({ kind: 'otto.pattern', content: 'x' });
    for (let i = 0; i < 30; i += 1) {
      learning = recordEvidence(learning, positive('human_feedback'));
    }
    const check = canPromote(learning, 'trusted');
    expect(check.allowed).toBe(false);
    expect(check.blockers.some((blocker) => blocker.includes('skip'))).toBe(true);
  });

  it('promoteLearning sobe um degrau por vez até core', () => {
    let learning = createLearning({ kind: 'otto.brand_rule', content: 'x' });
    for (let i = 0; i < 20; i += 1) {
      learning = recordEvidence(learning, positive('human_feedback'));
    }
    learning = recordEvidence(learning, positive('director'));

    const stages: string[] = [learning.stage];
    for (;;) {
      const result = promoteLearning(learning);
      if (!result.promoted) {
        expect(stages.at(-1)).toBe('core');
        break;
      }
      learning = result.learning;
      stages.push(learning.stage);
      if (stages.length > 6) throw new Error('loop de promoção não terminou');
    }
    expect(stages).toEqual(['observation', 'experimental', 'validated', 'trusted', 'core']);
    expect(nextStage('core')).toBeNull();
  });
});
