import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClickUpTaskProvider, createClickUpTaskProvider } from './clickup-task-provider-adapter';
import {
  ConnectorConfigError,
  __setConnectorConfigLoaderForTest,
  resolveClickUpCredentials,
  resolveTaskProvider,
} from './task-provider-resolver';

/**
 * O ADAPTER E O RESOLVER, provados juntos:
 *
 *   - o adapter delega nas funções reais do clickup-client (o fetch stub captura
 *     URL e Authorization — é ele que prova QUE credencial saiu na chamada);
 *   - o resolver decide a credencial: config da empresa quando existe, env
 *     global quando não existe, erro claro quando a config está quebrada —
 *     e NUNCA cai no fallback quando a empresa gravou conector (misturar
 *     tenants é pior que falhar).
 */

const CONFIG = { apiKey: 'pk_agencia', teamId: 'team-agencia' };

/** Tarefa crua no formato real de `GET /team/{id}/task` (ver clickup-operation.test.ts). */
function rawTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'DC_Digitais Setembro/26_Dia do Cliente',
    description: null,
    text_content: '',
    status: { status: 'aberto', color: '#87909e', type: 'open' },
    date_created: '1788980138595',
    date_updated: '1788980138595',
    due_date: '1789181999000',
    start_date: null,
    priority: null,
    url: 'https://app.clickup.com/t/t1',
    assignees: [{ id: 1, username: 'Alicia', email: 'alicia@x.com' }],
    tags: [{ name: 'social' }],
    list: { id: '901411758614', name: 'D. Carvalho' },
    folder: { id: 'f1', name: 'CLIENTES ATIVOS' },
    space: { id: '90143959149' },
    ...overrides,
  };
}

/** Stub de fetch que registra url + Authorization de cada chamada. */
function stubFetch(handler: (url: string) => { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; authorization: string | null; method: string }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      method: init?.method ?? 'GET',
    });
    const page = handler(url);
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => page.body ?? {},
      text: async () => JSON.stringify(page.body ?? {}),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.stubEnv('CLICKUP_API_KEY', 'pk_agencia');
  vi.stubEnv('CLICKUP_TEAM_ID', 'team-agencia');
  // O .env do repo liga a cerca de escrita (CLICKUP_WRITE_SCOPE_LIST_ID); os
  // testes do adapter precisam dela desligada por padrão — quem testa a cerca
  // a liga explicitamente no próprio caso.
  vi.stubEnv('CLICKUP_WRITE_SCOPE_LIST_ID', '');
  vi.stubEnv('CLICKUP_TEST_LIST_ID', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __setConnectorConfigLoaderForTest(null);
});

describe('ClickUpTaskProvider (adapter)', () => {
  it('listTasks normaliza a tarefa do ClickUp pro shape genérico', async () => {
    stubFetch(() => ({ body: { tasks: [rawTask()], last_page: true } }));
    const provider = createClickUpTaskProvider(CONFIG);

    const tasks = await provider.listTasks({ listIds: ['901411758614'], includeClosed: true, subtasks: true });

    expect(provider.provider).toBe('clickup');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({
      id: 't1',
      title: 'DC_Digitais Setembro/26_Dia do Cliente',
      description: null,
      status: 'aberto',
      statusType: 'open',
      assignees: ['Alicia'],
      dueDate: 1789181999000,
      updatedAt: 1788980138595,
      url: 'https://app.clickup.com/t/t1',
    });
  });

  it('listTasks repassa o escopo (listas/fechadas/subtasks) pro endpoint de time', async () => {
    const { calls } = stubFetch(() => ({ body: { tasks: [], last_page: true } }));
    const provider = createClickUpTaskProvider(CONFIG);

    await provider.listTasks({ listIds: ['L1', 'L2'], includeClosed: true, subtasks: false });

    expect(calls[0]!.url).toContain('/team/team-agencia/task');
    expect(calls[0]!.url).toContain('list_ids%5B%5D=L1');
    expect(calls[0]!.url).toContain('include_closed=true');
    expect(calls[0]!.url).toContain('subtasks=false');
    expect(calls[0]!.authorization).toBe('pk_agencia');
  });

  it('getTask devolve null em 404, e erro em qualquer outra falha', async () => {
    const provider = createClickUpTaskProvider(CONFIG);

    stubFetch(() => ({ status: 404, body: { err: 'not found' } }));
    await expect(provider.getTask('inexistente')).resolves.toBeNull();

    stubFetch(() => ({ status: 500, body: { err: 'boom' } }));
    await expect(provider.getTask('t1')).rejects.toThrow(/500/);
  });

  it('createTask cria e RE-LÊ a task, devolvendo o estado real com a url confirmada', async () => {
    const { calls } = stubFetch((url) =>
      url.endsWith('/task')
        ? { body: { id: 'nova', url: 'https://app.clickup.com/t/nova' } }
        : {
            body: {
              id: 'nova',
              name: 'Peça nova',
              status: { status: 'aberto' },
              assignees: [{ id: 1, username: 'Alicia' }],
              list: { id: 'L1' },
            },
          },
    );
    const provider = createClickUpTaskProvider(CONFIG);

    const criada = await provider.createTask({ listId: 'L1', title: 'Peça nova', priority: 2 }, {});

    expect(calls[0]!.method).toBe('POST');
    expect(criada.id).toBe('nova');
    expect(criada.title).toBe('Peça nova');
    expect(criada.assignees).toEqual(['Alicia']);
    expect(criada.url).toBe('https://app.clickup.com/t/nova');
  });

  it('a válvula authorizedForProduction entra na config só quando pedida', async () => {
    // Com a cerca ligada e sem a válvula, a escrita é bloqueada ANTES do fetch.
    vi.stubEnv('CLICKUP_WRITE_SCOPE_LIST_ID', 'lista-de-qa');
    const provider = createClickUpTaskProvider(CONFIG);

    await expect(provider.createTask({ listId: 'lista-de-producao', title: 'x' }, {})).rejects.toThrow(/BLOQUEADA/);

    const { calls } = stubFetch((url) =>
      url.endsWith('/task') ? { body: { id: 'ok', url: 'u' } } : { body: { id: 'ok', name: 'x', list: { id: 'lista-de-producao' } } },
    );
    await provider.createTask({ listId: 'lista-de-producao', title: 'x' }, { authorizedForProduction: true });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('updateTask edita e re-lê; addComment escreve comentário', async () => {
    const { calls } = stubFetch((url) =>
      url.includes('/comment')
        ? { body: { id: 'c1', date: '1788980138595' } }
        : { body: { id: 't1', name: 'Nome novo', list: { id: 'L1' }, assignees: [] } },
    );
    const provider = createClickUpTaskProvider(CONFIG);

    const atualizada = await provider.updateTask('t1', { title: 'Nome novo' }, {});
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    expect(atualizada.title).toBe('Nome novo');

    await provider.addComment('t1', 'comentário', {});
    expect(calls.some((c) => c.url.includes('/comment') && c.method === 'POST')).toBe(true);
  });
});

describe('resolveTaskProvider', () => {
  it('empresa sem conector cai no fallback de env — o comportamento de sempre da Desigual', async () => {
    __setConnectorConfigLoaderForTest(async () => []);

    const provider = await resolveTaskProvider('11111111-1111-4111-8111-111111111111');

    expect(provider.provider).toBe('clickup');
    const { calls } = stubFetch(() => ({ body: { tasks: [], last_page: true } }));
    await provider.listTasks({ listIds: ['L1'] });
    expect(calls[0]!.authorization).toBe('pk_agencia');
  });

  it('empresa COM conector lê com a credencial DELA, não com a global', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'pk_da_subconta', teamId: 'team-subconta' }, status: 'ativa' },
    ]);

    const provider = await resolveTaskProvider('22222222-2222-4222-8222-222222222222');

    const { calls } = stubFetch(() => ({ body: { tasks: [], last_page: true } }));
    await provider.listTasks({ listIds: ['L1'] });
    expect(calls[0]!.url).toContain('/team/team-subconta/task');
    expect(calls[0]!.authorization).toBe('pk_da_subconta');
  });

  it('sem empresa (org null) usa direto a env global', async () => {
    const provider = await resolveTaskProvider(null);
    expect(provider.provider).toBe('clickup');
  });

  it('conector DESATIVADO é erro claro — nunca cai no fallback com a chave da agência', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'k', teamId: 't' }, status: 'desativada' },
    ]);

    const erro = await resolveTaskProvider('org-1').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConnectorConfigError);
    expect((erro as Error).message).toContain('desativada');
  });

  it('configuração incompleta (sem teamId) é erro claro, não crash de turno', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'k' }, status: 'ativa' },
    ]);

    const erro = await resolveTaskProvider('org-1').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConnectorConfigError);
    expect((erro as Error).message).toContain('incompleta');
  });

  it('plataforma ainda sem adapter (jira) falha nomeando o caminho', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'jira', credentials: { apiKey: 'k' }, status: 'ativa' },
    ]);

    await expect(resolveTaskProvider('org-1')).rejects.toThrow(/jira.*não é suportada/i);
  });

  it('sem conector E sem env: erro claro dizendo o que falta', async () => {
    vi.stubEnv('CLICKUP_API_KEY', '');
    vi.stubEnv('CLICKUP_TEAM_ID', '');
    __setConnectorConfigLoaderForTest(async () => []);

    await expect(resolveTaskProvider('org-1')).rejects.toThrow(/CLICKUP_API_KEY\/CLICKUP_TEAM_ID/);
  });
});

/**
 * resolveClickUpCredentials — a mesma fonte (`loadConnectorRows`), mas
 * devolvendo credencial CRUA em vez de um `TaskProvider` montado. Existe pro
 * código que ainda não fala a interface `TaskProvider` (GET /clickup/members,
 * por ora — ver apps/api/src/integrations/access.ts) e que, por isso mesmo,
 * NÃO deve ganhar uma segunda leitura de `organization_connectors`.
 */
describe('resolveClickUpCredentials', () => {
  it('sem organizationId: null — quem chama decide o fallback (nunca consulta banco)', async () => {
    expect(await resolveClickUpCredentials(null)).toBeNull();
    expect(await resolveClickUpCredentials(undefined)).toBeNull();
  });

  it('empresa sem conector próprio: null — distinto de "conector quebrado"', async () => {
    __setConnectorConfigLoaderForTest(async () => []);
    expect(await resolveClickUpCredentials('org-1')).toBeNull();
  });

  it('empresa COM conector ativo: devolve a credencial DELA', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'pk_da_subconta', teamId: 'team-subconta' }, status: 'ativa' },
    ]);
    await expect(resolveClickUpCredentials('org-1')).resolves.toEqual({ apiKey: 'pk_da_subconta', teamId: 'team-subconta' });
  });

  it('conector DESATIVADO: lança ConnectorConfigError — nunca devolve null (que pareceria "sem conector")', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'k', teamId: 't' }, status: 'desativada' },
    ]);
    const erro = await resolveClickUpCredentials('org-1').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConnectorConfigError);
    expect((erro as Error).message).toContain('desativada');
  });

  it('configuração incompleta: lança ConnectorConfigError, nunca devolve credencial parcial', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'clickup', credentials: { apiKey: 'k' }, status: 'ativa' },
    ]);
    const erro = await resolveClickUpCredentials('org-1').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConnectorConfigError);
    expect((erro as Error).message).toContain('incompleta');
  });

  it('empresa com OUTRO provider configurado (não clickup): null — não é erro, só não tem clickup', async () => {
    __setConnectorConfigLoaderForTest(async () => [
      { provider: 'jira', credentials: { apiKey: 'k' }, status: 'ativa' },
    ]);
    expect(await resolveClickUpCredentials('org-1')).toBeNull();
  });
});
