import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupTasksByClient, queryOperationTasks, type OperationTask } from './clickup-operation';

const CONFIG = { apiKey: 'pk_fake', teamId: '9014937439' };

/** Tarefa crua no formato REAL do ClickUp (campos e tipos conferidos contra a
 * resposta ao vivo de `GET /team/{id}/task` em 10/09/2026: datas são STRING de ms). */
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

function mockFetchSequence(pages: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  let index = 0;
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    const status = page?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => page?.headers?.[name.toLowerCase()] ?? null },
      json: async () => page?.body ?? { tasks: [], last_page: true },
      text: async () => JSON.stringify(page?.body ?? {}),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('queryOperationTasks', () => {
  it('usa o endpoint de TIME (operação inteira), não o de lista única', async () => {
    const { calls } = mockFetchSequence([{ body: { tasks: [rawTask()], last_page: true } }]);
    await queryOperationTasks(CONFIG);
    expect(calls[0]).toContain('/team/9014937439/task');
    expect(calls[0]).not.toContain('/list/');
  });

  it('normaliza a tarefa crua do ClickUp: data de string pra número, assignee pra nome', async () => {
    mockFetchSequence([{ body: { tasks: [rawTask()], last_page: true } }]);
    const { tasks } = await queryOperationTasks(CONFIG);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 't1',
      status: 'aberto',
      statusType: 'open',
      dueDate: 1789181999000,
      assignees: ['Alicia'],
      tags: ['social'],
      listName: 'D. Carvalho',
      folderName: 'CLIENTES ATIVOS',
    });
  });

  it('manda a janela de vencimento e as listas autorizadas como filtro do ClickUp', async () => {
    const { calls } = mockFetchSequence([{ body: { tasks: [], last_page: true } }]);
    await queryOperationTasks(CONFIG, {
      dueAfter: 1789095600000,
      dueBefore: 1789181999000,
      listIds: ['901412055584', '901411758614'],
    });
    const url = decodeURIComponent(calls[0]!);
    expect(url).toContain('due_date_gt=1789095600000');
    expect(url).toContain('due_date_lt=1789181999000');
    // Autorização: as duas listas viajam como filtro, não são aplicadas depois.
    expect(url).toContain('list_ids[]=901412055584');
    expect(url).toContain('list_ids[]=901411758614');
  });

  it('pagina até o fim e concatena (uma página cheia não é o total)', async () => {
    const cheia = Array.from({ length: 100 }, (_, i) => rawTask({ id: `t${i}` }));
    const { calls } = mockFetchSequence([
      { body: { tasks: cheia, last_page: false } },
      { body: { tasks: [rawTask({ id: 'ultima' })], last_page: true } },
    ]);
    const result = await queryOperationTasks(CONFIG);
    expect(result.tasks).toHaveLength(101);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(calls[0]).toContain('page=0');
    expect(calls[1]).toContain('page=1');
  });

  it('página incompleta encerra a busca mesmo sem o campo last_page', async () => {
    const { calls } = mockFetchSequence([{ body: { tasks: [rawTask()] } }]);
    const result = await queryOperationTasks(CONFIG);
    expect(result.tasks).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('marca truncated quando bate no teto de páginas, em vez de mentir o total', async () => {
    const cheia = Array.from({ length: 100 }, (_, i) => rawTask({ id: `t${i}` }));
    mockFetchSequence([{ body: { tasks: cheia, last_page: false } }]);
    const result = await queryOperationTasks(CONFIG);
    expect(result.truncated).toBe(true);
    expect(result.pagesFetched).toBe(20);
    expect(result.tasks).toHaveLength(2000);
  });

  it('espera e repete no 429 respeitando Retry-After (rate limit é real, 100 req/min)', async () => {
    vi.useFakeTimers();
    const { fetchMock } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '2' } },
      { body: { tasks: [rawTask()], last_page: true } },
    ]);
    const promise = queryOperationTasks(CONFIG);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.tasks).toHaveLength(1);
  });

  it('desiste com erro nomeado se o 429 persistir (nunca devolve lista vazia como se fosse verdade)', async () => {
    vi.useFakeTimers();
    mockFetchSequence([{ status: 429 }]);
    const promise = queryOperationTasks(CONFIG);
    const assertion = expect(promise).rejects.toThrow(/429/);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('propaga erro HTTP com o corpo (chamador decide, nunca finge sucesso)', async () => {
    mockFetchSequence([{ status: 401, body: { err: 'Token inválido' } }]);
    await expect(queryOperationTasks(CONFIG)).rejects.toThrow(/HTTP 401/);
  });
});

describe('groupTasksByClient', () => {
  const base: OperationTask = {
    id: 'x',
    name: 'task',
    description: null,
    status: 'aberto',
    statusType: 'open',
    priority: null,
    url: null,
    dueDate: null,
    startDate: null,
    createdAt: null,
    updatedAt: null,
    assignees: [],
    tags: [],
    listId: null,
    listName: null,
    folderName: null,
    spaceId: null,
  };

  it('agrupa por cliente e ordena por volume', () => {
    const clientes = new Map([
      ['L1', { id: 'c1', name: '3Net' }],
      ['L2', { id: 'c2', name: 'D. Carvalho' }],
    ]);
    const { byClient, unmatched } = groupTasksByClient(
      [
        { ...base, id: 'a', listId: 'L2' },
        { ...base, id: 'b', listId: 'L1' },
        { ...base, id: 'c', listId: 'L2' },
      ],
      clientes,
    );
    expect(byClient.map((c) => c.clientName)).toEqual(['D. Carvalho', '3Net']);
    expect(byClient[0]!.tasks).toHaveLength(2);
    expect(unmatched).toHaveLength(0);
  });

  it('tarefa de lista não mapeada vai pra unmatched, nunca é descartada calada', () => {
    const { byClient, unmatched } = groupTasksByClient(
      [{ ...base, id: 'orfa', listId: 'LISTA-SEM-CLIENTE' }],
      new Map([['L1', { id: 'c1', name: '3Net' }]]),
    );
    expect(byClient).toHaveLength(0);
    expect(unmatched.map((t) => t.id)).toEqual(['orfa']);
  });
});
