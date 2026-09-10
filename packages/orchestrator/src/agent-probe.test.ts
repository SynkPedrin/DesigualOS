import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProbeTarget } from './agent-probe.js';

/**
 * agent-probe.ts cria `const logger = createLogger(...)` no escopo do
 * módulo. Sem mockar '@desigual-os/logging', o pino real tentaria subir a
 * transport pino-pretty (dependência isolada em packages/logging, não
 * necessariamente resolvível a partir daqui) numa worker thread - risco de
 * travar o processo de teste. Mock evita isso e mantém o teste rápido.
 */
vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeTarget(): ProbeTarget {
  return {
    agent: 'bento',
    nodeId: 'NODE_TEST',
    label: 'Teste',
    host: 'test-host',
    services: [
      { name: 'critical-svc', url: 'http://critical.test/health' },
      { name: 'aux-svc', url: 'http://aux.test/health', critical: false },
    ],
  };
}

describe('probeAgent', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('online quando crítico e auxiliar respondem 200', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { probeAgent } = await import('./agent-probe.js');

    const result = await probeAgent(makeTarget());

    expect(result.status).toBe('online');
    expect(result.services.every((s) => s.ok)).toBe(true);
  });

  it('degraded quando só o serviço auxiliar falha (crítico ok) - nunca offline nesse caso', async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes('aux')
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve({ ok: true, status: 200 }),
    );
    const { probeAgent } = await import('./agent-probe.js');

    const result = await probeAgent(makeTarget());

    expect(result.status).toBe('degraded');
    const critical = result.services.find((s) => s.name === 'critical-svc');
    const aux = result.services.find((s) => s.name === 'aux-svc');
    expect(critical?.ok).toBe(true);
    expect(aux?.ok).toBe(false);
  });

  it('offline quando o serviço crítico falha, mesmo com o auxiliar ok', async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes('critical')
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve({ ok: true, status: 200 }),
    );
    const { probeAgent } = await import('./agent-probe.js');

    const result = await probeAgent(makeTarget());

    expect(result.status).toBe('offline');
  });

  it('offline quando os dois serviços falham (timeout/rede)', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));
    const { probeAgent } = await import('./agent-probe.js');

    const result = await probeAgent(makeTarget());

    expect(result.status).toBe('offline');
    expect(result.services.every((s) => s.ok === false)).toBe(true);
    expect(result.services.every((s) => s.error === 'máquina não respondeu')).toBe(true);
  });

  it('degraded quando o auxiliar responde HTTP fora do esperado (não é exceção, é resposta ok:false)', async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes('aux')
        ? Promise.resolve({ ok: true, status: 500 })
        : Promise.resolve({ ok: true, status: 200 }),
    );
    const { probeAgent } = await import('./agent-probe.js');

    const result = await probeAgent(makeTarget());

    expect(result.status).toBe('degraded');
  });
});
