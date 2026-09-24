import { describe, expect, it } from 'vitest';
import { ottoMotionEnabled } from './flag.js';

describe('feature flag (§2)', () => {
  it('só liga com a string exata "true"', () => {
    expect(ottoMotionEnabled({ OTTO_MOTION_ENABLED: 'true' })).toBe(true);
  });

  it.each(['false', '1', 'TRUE', 'yes', 'on', ''])('não liga com "%s"', (valor) => {
    expect(ottoMotionEnabled({ OTTO_MOTION_ENABLED: valor })).toBe(false);
  });

  it('ausente = desligado, que é o default seguro', () => {
    expect(ottoMotionEnabled({})).toBe(false);
  });

  it('é lida a cada chamada, não congelada no import — senão a regressão do §46 não teria como ser provada', () => {
    const env: NodeJS.ProcessEnv = { OTTO_MOTION_ENABLED: 'true' };
    expect(ottoMotionEnabled(env)).toBe(true);
    env.OTTO_MOTION_ENABLED = 'false';
    expect(ottoMotionEnabled(env)).toBe(false);
  });
});
