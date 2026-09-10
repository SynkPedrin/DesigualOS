import { describe, it, expect } from 'vitest';
import { resolutionForMegapixels, T2I_PROFILES, I2I_PROFILES, TRANSFORMATION_STRENGTH_DENOISE, masterFinishDenoise } from './quality-profiles';

describe('quality profiles (item 38: draft != standard != master)', () => {
  /**
   * Só o master tem refino: medido na GPU real, o segundo estágio custa ~400s
   * extras (500s com refino vs 87s sem, mesmo modelo quente) porque aloca um
   * segundo shape de tensor com a VRAM perto do teto - caro demais pra ser o
   * default. Ver quality-profiles.ts.
   */
  it('only master has a refine stage (draft and standard are single-pass)', () => {
    expect(T2I_PROFILES.draft.refine).toBeNull();
    expect(T2I_PROFILES.standard.refine).toBeNull();
    expect(T2I_PROFILES.master.refine).not.toBeNull();
  });

  it('base steps strictly increase draft < standard < master', () => {
    expect(T2I_PROFILES.draft.baseSteps).toBeLessThan(T2I_PROFILES.standard.baseSteps);
    expect(T2I_PROFILES.standard.baseSteps).toBeLessThan(T2I_PROFILES.master.baseSteps);
    expect(I2I_PROFILES.draft.steps).toBeLessThan(I2I_PROFILES.standard.steps);
    expect(I2I_PROFILES.standard.steps).toBeLessThan(I2I_PROFILES.master.steps);
  });

  it('master refine uses a partial denoise (preserves the composition it is refining)', () => {
    expect(T2I_PROFILES.master.refine!.denoise).toBeGreaterThan(0);
    expect(T2I_PROFILES.master.refine!.denoise).toBeLessThan(1);
  });

  it('master refine targets a higher resolution than its own base pass', () => {
    expect(T2I_PROFILES.master.refine!.megapixels).toBeGreaterThan(T2I_PROFILES.master.baseMegapixels);
  });

  it('all three profiles are distinct objects with distinct params', () => {
    const serialized = new Set(Object.values(T2I_PROFILES).map((p) => JSON.stringify(p)));
    expect(serialized.size).toBe(3);
  });
});

describe('resolutionForMegapixels', () => {
  it('preserves aspect ratio for 4:5', () => {
    const { width, height } = resolutionForMegapixels(4, 5, 1.0);
    expect(Math.abs(width / height - 4 / 5)).toBeLessThan(0.02);
  });

  it('snaps to multiples of 16 (Flux latent grid)', () => {
    const { width, height } = resolutionForMegapixels(16, 9, 1.48);
    expect(width % 16).toBe(0);
    expect(height % 16).toBe(0);
  });

  it('hits approximately the target megapixel budget', () => {
    const { width, height } = resolutionForMegapixels(1, 1, 1.0);
    const mp = (width * height) / 1_000_000;
    expect(mp).toBeGreaterThan(0.9);
    expect(mp).toBeLessThan(1.1);
  });

  it('produces a larger resolution for a larger megapixel target, same aspect ratio', () => {
    const base = resolutionForMegapixels(4, 5, 1.0);
    const refine = resolutionForMegapixels(4, 5, 1.48);
    expect(refine.width).toBeGreaterThan(base.width);
    expect(refine.height).toBeGreaterThan(base.height);
  });
});

describe('denoise router (item 38: low/medium/high)', () => {
  it('low < medium < high', () => {
    expect(TRANSFORMATION_STRENGTH_DENOISE.low).toBeLessThan(TRANSFORMATION_STRENGTH_DENOISE.medium);
    expect(TRANSFORMATION_STRENGTH_DENOISE.medium).toBeLessThan(TRANSFORMATION_STRENGTH_DENOISE.high);
  });

  it('low stays within the 0.28-0.38 range from the evolution plan', () => {
    expect(TRANSFORMATION_STRENGTH_DENOISE.low).toBeGreaterThanOrEqual(0.28);
    expect(TRANSFORMATION_STRENGTH_DENOISE.low).toBeLessThanOrEqual(0.38);
  });

  it('high is 0.65 or above', () => {
    expect(TRANSFORMATION_STRENGTH_DENOISE.high).toBeGreaterThanOrEqual(0.65);
  });
});

describe('masterFinishDenoise', () => {
  it('identity/product critical caps lower than editorial default', () => {
    const critical = masterFinishDenoise({ identityCritical: true });
    const editorial = masterFinishDenoise({});
    expect(critical).toBeLessThan(editorial);
    expect(critical).toBeGreaterThanOrEqual(0.12);
    expect(critical).toBeLessThanOrEqual(0.18);
  });

  it('productCritical alone also caps low', () => {
    expect(masterFinishDenoise({ productCritical: true })).toBeLessThanOrEqual(0.18);
  });
});
