import { describe, expect, it } from 'vitest';
import { assertModelActuallyUsed, assertMotionModel, MOTION_MODEL_ID, versionAtLeast } from './model.js';
import { MotionModelUnavailableError } from './errors.js';

describe('gate do modelo (§5)', () => {
  it('aceita exatamente o Opus 5.5', () => {
    expect(() => assertMotionModel(MOTION_MODEL_ID)).not.toThrow();
  });

  it('recusa o alias "opus" — ele resolve pro Opus 5, não pro 5.5', () => {
    expect(() => assertMotionModel('opus')).toThrow(MotionModelUnavailableError);
  });

  it('recusa Sonnet mesmo que alguém peça explicitamente', () => {
    expect(() => assertMotionModel('claude-sonnet-5')).toThrow(MotionModelUnavailableError);
  });

  it('reprova a execução quando o Opus 5.5 não aparece no modelUsage real', () => {
    expect(() => assertModelActuallyUsed({ 'claude-sonnet-5': {} })).toThrow(MotionModelUnavailableError);
  });

  it('aprova quando o Opus 5.5 rodou, mesmo com modelo auxiliar junto', () => {
    expect(() =>
      assertModelActuallyUsed({ 'claude-haiku-4-5-20251001': {}, [MOTION_MODEL_ID]: {} }),
    ).not.toThrow();
  });

  it('reprova modelUsage vazio (sessão que não chamou modelo nenhum)', () => {
    expect(() => assertModelActuallyUsed(undefined)).toThrow(MotionModelUnavailableError);
  });
});

describe('versionAtLeast', () => {
  it('2.1.281 satisfaz o mínimo de 2.1.280', () => {
    expect(versionAtLeast('2.1.281', '2.1.280')).toBe(true);
  });

  it('2.1.263 não satisfaz — foi a versão que a API recusou de verdade', () => {
    expect(versionAtLeast('2.1.263', '2.1.280')).toBe(false);
  });

  it('lida com sufixo de build sem quebrar', () => {
    expect(versionAtLeast('2.1.281 (Claude Code)', '2.1.280')).toBe(true);
  });

  it('versão igual conta como satisfeita', () => {
    expect(versionAtLeast('2.1.280', '2.1.280')).toBe(true);
  });
});
