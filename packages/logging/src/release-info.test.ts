import { describe, expect, it } from 'vitest';
import { getReleaseInfo } from './release-info.js';

/**
 * P1-04 (release readiness audit, 22/09/2026): "API/worker executam tsx src,
 * sem SHA no health" — depois de um deploy não dava pra provar qual commit
 * cada serviço estava rodando de verdade.
 */
describe('getReleaseInfo', () => {
  it('devolve um SHA não vazio (RELEASE_SHA do ambiente ou git rev-parse HEAD do checkout)', () => {
    const info = getReleaseInfo();
    expect(info.release_sha).toBeTruthy();
    expect(info.release_sha).not.toBe('');
  });

  it('devolve um build_time em formato ISO', () => {
    const info = getReleaseInfo();
    expect(() => new Date(info.build_time).toISOString()).not.toThrow();
    expect(new Date(info.build_time).toISOString()).toBe(info.build_time);
  });

  it('devolve o mesmo SHA em chamadas repetidas — resolvido uma vez, não a cada request', () => {
    expect(getReleaseInfo().release_sha).toBe(getReleaseInfo().release_sha);
    expect(getReleaseInfo().build_time).toBe(getReleaseInfo().build_time);
  });

  it('environment reflete NODE_ENV', () => {
    expect(getReleaseInfo().environment).toBe(process.env.NODE_ENV ?? 'development');
  });
});
