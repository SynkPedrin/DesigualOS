import { describe, it, expect } from 'vitest';
import { computeGenerationFingerprint } from './idempotency';

const base = {
  clientId: 'client-1',
  workflowId: 't2i_flux2_editorial_v1',
  workflowVersion: '1.0.0',
  modelVersion: 'flux2_dev_fp8mixed.safetensors',
  seed: 123,
  qualityProfile: 'standard',
  generationParameters: { prompt: 'a cat', resolution: { width: 1024, height: 1024 } },
};

describe('generation fingerprint (item 38: idempotência)', () => {
  it('same inputs produce the same fingerprint regardless of key order', () => {
    const a = computeGenerationFingerprint(base);
    const b = computeGenerationFingerprint({ ...base, generationParameters: { resolution: base.generationParameters.resolution, prompt: 'a cat' } });
    expect(a).toBe(b);
  });

  it('a different seed (creative reroll) produces a different fingerprint', () => {
    const a = computeGenerationFingerprint(base);
    const b = computeGenerationFingerprint({ ...base, seed: 456 });
    expect(a).not.toBe(b);
  });

  it('a different prompt produces a different fingerprint', () => {
    const a = computeGenerationFingerprint(base);
    const b = computeGenerationFingerprint({ ...base, generationParameters: { ...base.generationParameters, prompt: 'a dog' } });
    expect(a).not.toBe(b);
  });

  it('reference asset order does not matter (sorted internally)', () => {
    const a = computeGenerationFingerprint({ ...base, referenceAssetIds: ['a', 'b'] });
    const b = computeGenerationFingerprint({ ...base, referenceAssetIds: ['b', 'a'] });
    expect(a).toBe(b);
  });

  it('produces a stable sha256 hex digest', () => {
    const fp = computeGenerationFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
