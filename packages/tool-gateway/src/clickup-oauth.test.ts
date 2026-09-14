import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTasksInList, getTasksInListPaged } from './clickup-oauth';

/**
 * Regressão do bug de produção achado em 10/09/2026: `getTasksInList` não mandava `page`
 * nem lia `last_page`, então devolvia só as 100 primeiras tarefas de qualquer lista, e o
 * `GET /clients/:id/overview` publicava esse número como se fosse o total do cliente.
 * Medido ao vivo: D. Carvalho tem 163 tarefas e o painel exibia 100.
 */

function rawTask(id: string) {
  return {
    id,
    name: `Tarefa ${id}`,
    url: null,
    description: null,
    text_content: '',
    status: { status: 'aberto', color: '#87909e', type: 'open' },
    priority: null,
    due_date: '1789181999000',
    start_date: null,
    date_created: '1788980138595',
    date_updated: '1788980138595',
    time_estimate: null,
    tags: [],
    assignees: [],
    creator: null,
    list: { id: 'L1', name: 'D. Carvalho' },
  };
}

function mockPages(pages: Array<{ tasks: unknown[]; last_page?: boolean }>) {
  const urls: string[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) => {
      urls.push(String(url));
      const page = pages[Math.min(i, pages.length - 1)];
      i += 1;
      return {
        ok: true,
        status: 200,
        json: async () => page,
        text: async () => JSON.stringify(page),
      };
    }),
  );
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('getTasksInListPaged', () => {
  it('busca TODAS as páginas: 163 tarefas em 2 páginas, não 100', async () => {
    const cheia = Array.from({ length: 100 }, (_, n) => rawTask(`p0-${n}`));
    const resto = Array.from({ length: 63 }, (_, n) => rawTask(`p1-${n}`));
    const urls = mockPages([
      { tasks: cheia, last_page: false },
      { tasks: resto, last_page: true },
    ]);

    const r = await getTasksInListPaged('pk_fake', 'L1', true);
    expect(r.tasks).toHaveLength(163);
    expect(r.pagesFetched).toBe(2);
    expect(r.truncated).toBe(false);
    expect(urls[0]).toContain('page=0');
    expect(urls[1]).toContain('page=1');
  });

  it('página incompleta encerra sem pedir a próxima', async () => {
    const urls = mockPages([{ tasks: [rawTask('a'), rawTask('b')] }]);
    const r = await getTasksInListPaged('pk_fake', 'L1');
    expect(r.tasks).toHaveLength(2);
    expect(urls).toHaveLength(1);
  });

  it('marca truncated ao bater no teto, em vez de apresentar total falso', async () => {
    const cheia = Array.from({ length: 100 }, (_, n) => rawTask(`x-${n}`));
    mockPages([{ tasks: cheia, last_page: false }]);
    const r = await getTasksInListPaged('pk_fake', 'L1');
    expect(r.truncated).toBe(true);
    expect(r.pagesFetched).toBe(20);
    expect(r.tasks).toHaveLength(2000);
  });

  it('include_closed=false não manda o parâmetro; true manda', async () => {
    const semFechadas = mockPages([{ tasks: [], last_page: true }]);
    await getTasksInListPaged('pk_fake', 'L1', false);
    expect(semFechadas[0]).not.toContain('include_closed');

    vi.unstubAllGlobals();
    const comFechadas = mockPages([{ tasks: [], last_page: true }]);
    await getTasksInListPaged('pk_fake', 'L1', true);
    expect(comFechadas[0]).toContain('include_closed=true');
  });

  it('getTasksInList (assinatura antiga dos 4 chamadores) segue funcionando e já vem paginada', async () => {
    const cheia = Array.from({ length: 100 }, (_, n) => rawTask(`p0-${n}`));
    mockPages([
      { tasks: cheia, last_page: false },
      { tasks: [rawTask('ultima')], last_page: true },
    ]);
    const tasks = await getTasksInList('pk_fake', 'L1');
    expect(tasks).toHaveLength(101);
    expect(tasks[0]).toMatchObject({ status: 'aberto', statusType: 'open' });
  });

  it('erro HTTP continua propagando (não devolve lista parcial como se fosse completa)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Token inválido' })),
    );
    await expect(getTasksInListPaged('pk_fake', 'L1')).rejects.toThrow(/401/);
  });

  it('todo fetch sai com AbortSignal de timeout (auditoria 2026-09: fetch sem timeout pendurava pra sempre)', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ tasks: [], last_page: true }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getTasksInListPaged('pk_fake', 'L1');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.signal as AbortSignal).aborted).toBe(false);
  });

  it('timeout de rede vira mensagem legível (os call sites só propagam error.message)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
      }),
    );
    await expect(getTasksInListPaged('pk_fake', 'L1')).rejects.toThrow(/não respondeu em 20s/);
  });
});
