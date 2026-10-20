import { describe, expect, it } from 'vitest';
import { mediaActionsEnabled } from './media-actions';

describe('execução de ações em campanha', () => {
  it('vem DESLIGADA por padrão', () => {
    expect(mediaActionsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(mediaActionsEnabled({ MEDIA_ACTIONS_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(mediaActionsEnabled({ MEDIA_ACTIONS_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('só o valor exato "true" liga', () => {
    expect(mediaActionsEnabled({ MEDIA_ACTIONS_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
