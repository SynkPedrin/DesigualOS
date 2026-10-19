import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setConnectorConfigLoaderForTest } from '@desigual-os/tool-gateway';
import { buscarTasksDaLista } from './campaign-context';

/**
 * A AUTOCURA DE CAMPANHA LÊ PELA INTERFACE DE CONECTORES (01/10/2026).
 *
 * O que está travado aqui é a decisão de CREDENCIAL, não o formato da resposta:
 *
 *   - empresa SEM conector → a env global de sempre (comportamento idêntico ao
 *     anterior, quando a função montava ClickUpConfig na mão);
 *   - empresa COM conector → a chave DELA (white label: subconta lê a
 *     plataforma da subconta);
 *   - config quebrada/ausente → lista vazia, nunca crash de turno — a autocura
 *     é reforço, não pré-requisito.
 *
 * O fetch stub captura o header Authorization: é ele que prova QUE chave saiu.
 */

const ORG_SEM_CONECTOR = '11111111-1111-4111-8111-111111111111';
const ORG_COM_CONECTOR = '22222222-2222-4222-8222-222222222222';

function rawTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Cosentino_Europa V_Card Estático',
    status: { status: 'pronto', type: 'closed' },
    date_updated: '1788980138595',
    due_date: null,
    url: 'https://app.clickup.com/t/t1',
    ...overrides,
  };
}

function stubFetchCapturando(body: unknown) {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.stubEnv('CLICKUP_API_KEY', 'pk_da_agencia');
  vi.stubEnv('CLICKUP_TEAM_ID', 'team-agencia');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __setConnectorConfigLoaderForTest(null);
});

describe('buscarTasksDaLista — credencial por empresa', () => {
  it('sem conector na org, cai no fallback de env (comportamento idêntico ao atual)', async () => {
    __setConnectorConfigLoaderForTest(async () => []);
    const { calls } = stubFetchCapturando({ tasks: [rawTask()], last_page: true });

    const tasks = await buscarTasksDaLista('lista-1', ORG_SEM_CONECTOR);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe('pk_da_agencia');
    expect(calls[0]!.url).toContain('/team/team-agencia/task');
    // O mapeamento continua o mesmo: o tipo do status decide "encerrada".
    expect(tasks).toEqual([
      {
        id: 't1',
        name: 'Cosentino_Europa V_Card Estático',
        description: '',
        status: 'pronto',
        closed: true,
        updatedAt: new Date(1788980138595),
      },
    ]);
  });

  it('sem organizationId (caminho antigo do scheduler legado), também usa a env', async () => {
    __setConnectorConfigLoaderForTest(async () => []);
    const { calls } = stubFetchCapturando({ tasks: [], last_page: true });

    await buscarTasksDaLista('lista-1');

    expect(calls[0]!.authorization).toBe('pk_da_agencia');
  });

  it('com conector na org, a leitura sai com a credencial DELA', async () => {
    __setConnectorConfigLoaderForTest(async (orgId) =>
      orgId === ORG_COM_CONECTOR
        ? [{ provider: 'clickup', credentials: { apiKey: 'pk_da_subconta', teamId: 'team-subconta' }, status: 'ativa' }]
        : [],
    );
    const { calls } = stubFetchCapturando({ tasks: [rawTask()], last_page: true });

    const tasks = await buscarTasksDaLista('lista-1', ORG_COM_CONECTOR);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe('pk_da_subconta');
    expect(calls[0]!.url).toContain('/team/team-subconta/task');
    expect(tasks).toHaveLength(1);
  });

  it('conector desativado NÃO vaza pro fallback da agência: resposta vazia, nenhuma chamada', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'k', teamId: 't' }, status: 'desativada' },
    ]);
    const { calls } = stubFetchCapturando({ tasks: [rawTask()], last_page: true });

    const tasks = await buscarTasksDaLista('lista-1', ORG_COM_CONECTOR);

    expect(tasks).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('sem env e sem conector: lista vazia, turno nunca quebra', async () => {
    vi.stubEnv('CLICKUP_API_KEY', '');
    vi.stubEnv('CLICKUP_TEAM_ID', '');
    __setConnectorConfigLoaderForTest(async () => []);

    await expect(buscarTasksDaLista('lista-1', ORG_SEM_CONECTOR)).resolves.toEqual([]);
  });

  it('falha de rede da plataforma vira lista vazia, não crash de turno', async () => {
    __setConnectorConfigLoaderForTest(async () => []);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );

    await expect(buscarTasksDaLista('lista-1', ORG_SEM_CONECTOR)).resolves.toEqual([]);
  });
});
