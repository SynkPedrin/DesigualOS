import { describe, expect, it } from 'vitest';
import { mediaJobsEnabled } from './media-jobs';

describe('mediaJobsEnabled', () => {
  it('liga por padrão (servidor de produção não precisa de variável)', () => {
    expect(mediaJobsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
  it('só o valor exato "false" desliga (máquina de desenvolvimento)', () => {
    expect(mediaJobsEnabled({ MEDIA_JOBS_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(mediaJobsEnabled({ MEDIA_JOBS_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
