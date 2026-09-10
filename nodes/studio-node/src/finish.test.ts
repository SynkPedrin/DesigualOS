import { describe, it, expect } from 'vitest';
import { selectFinishStrategy } from './finish';

describe('Finish Router (item 38: imagem suficiente -> FAST, pequena -> RESTORE, QA ruim -> MASTER)', () => {
  it('picks FAST when source already meets target resolution', () => {
    const decision = selectFinishStrategy({ sourceWidth: 1360, sourceHeight: 1360, targetWidth: 1080, targetHeight: 1350 });
    expect(decision).toBe('fast');
  });

  it('picks FAST when source exactly matches target', () => {
    expect(selectFinishStrategy({ sourceWidth: 1080, sourceHeight: 1350, targetWidth: 1080, targetHeight: 1350 })).toBe('fast');
  });

  it('picks RESTORE when source is smaller than target on either axis', () => {
    expect(selectFinishStrategy({ sourceWidth: 800, sourceHeight: 1000, targetWidth: 1080, targetHeight: 1350 })).toBe('restore');
    expect(selectFinishStrategy({ sourceWidth: 1200, sourceHeight: 900, targetWidth: 1080, targetHeight: 1350 })).toBe('restore');
  });

  it('picks MASTER when Visual QA flags insufficient detail, even if resolution is already enough (item 13: never upscale-to-discard)', () => {
    const decision = selectFinishStrategy({
      sourceWidth: 2000,
      sourceHeight: 2000,
      targetWidth: 1080,
      targetHeight: 1350,
      detailInsufficient: true,
    });
    expect(decision).toBe('master');
  });

  it('never returns MASTER without an explicit detailInsufficient flag (item 27/41: no silent generative upscale)', () => {
    const decision = selectFinishStrategy({ sourceWidth: 500, sourceHeight: 500, targetWidth: 4000, targetHeight: 4000 });
    expect(decision).toBe('restore');
  });
});
