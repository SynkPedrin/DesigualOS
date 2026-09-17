import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@desigual-os/logging';

const fakeLogger = (): Logger =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * RECUPERAÇÃO AUTOMÁTICA. O ClickUp suspende e não volta sozinho; o modo de
 * falha é sempre o mesmo (API reinicia, algumas entregas caem na janela), e o
 * custo é dado velho em silêncio.
 */
describe('religar webhook', () => {
  it('não reativa quando o endpoint não responde: seria só agendar a próxima suspensão', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      chamadas.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/clickup/webhook')) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }));
    const { religarWebhookParaTeste } = await import('./integration-health.js');
    const r = await religarWebhookParaTeste('w1', 'https://exemplo/clickup/webhook', fakeLogger());
    expect(r).toBe('endpoint_fora');
    expect(chamadas.some((c) => c.startsWith('PUT'))).toBe(false);
  });

  it('reativa quando o endpoint responde 401 — tem serviço vivo verificando assinatura', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      chamadas.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/clickup/webhook')) return { ok: false, status: 401 } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }));
    const { religarWebhookParaTeste } = await import('./integration-health.js');
    const r = await religarWebhookParaTeste('w1', 'https://exemplo/clickup/webhook', fakeLogger());
    expect(r).toBe('religado');
    expect(chamadas.some((c) => c.startsWith('PUT'))).toBe(true);
  });
});
