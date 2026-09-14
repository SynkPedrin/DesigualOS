import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTask, getTeamMembers } from './clickup-client';

/**
 * Cobertura do timeout de rede adicionado na auditoria de production
 * readiness (2026-09): todo fetch pro ClickUp sai com AbortSignal de 20s e
 * um estouro de timeout vira mensagem legível, porque os call sites (rotas
 * da API) só propagam error.message.
 */

const CONFIG = { apiKey: 'pk_fake', teamId: 'T1' };

afterEach(() => vi.unstubAllGlobals());

describe('timeout de rede nos fetches do ClickUp', () => {
  it('getTeamMembers sai com AbortSignal de timeout', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ team: { members: [] } }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getTeamMembers(CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('createTask também sai com signal (método POST, não só GETs)', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'abc', url: 'https://app.clickup.com/t/abc' }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createTask(CONFIG, { listId: 'L1', name: 'Tarefa' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout vira mensagem legível em pt-BR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
      }),
    );
    await expect(getTeamMembers(CONFIG)).rejects.toThrow(/não respondeu em 20s/);
  });

  it('erros que não são timeout seguem propagando intactos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(getTeamMembers(CONFIG)).rejects.toThrow('fetch failed');
  });
});
