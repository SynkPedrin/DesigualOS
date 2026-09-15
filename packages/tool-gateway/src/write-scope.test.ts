import { describe, expect, it } from 'vitest';
import { WriteScopeError, assertListInScope, assertTaskInScope, getWriteScopeListId } from './write-scope';

/**
 * A cerca precisa falhar FECHADA: qualquer dúvida sobre onde a escrita cai
 * é motivo pra bloquear. Estes testes guardam exatamente isso.
 */

const QA = '901421119936';
const CLIENTE = '901400000001';

describe('getWriteScopeListId', () => {
  it('sem env nenhuma, não há cerca (produção não muda)', () => {
    expect(getWriteScopeListId({})).toBeNull();
  });
  it('CLICKUP_TEST_LIST_ID liga a cerca (nome usado no .env do gate)', () => {
    expect(getWriteScopeListId({ CLICKUP_TEST_LIST_ID: QA })).toBe(QA);
  });
  it('CLICKUP_WRITE_SCOPE_LIST_ID tem precedência', () => {
    expect(getWriteScopeListId({ CLICKUP_WRITE_SCOPE_LIST_ID: QA, CLICKUP_TEST_LIST_ID: CLIENTE })).toBe(QA);
  });
  it('valor vazio não liga a cerca pela metade', () => {
    expect(getWriteScopeListId({ CLICKUP_TEST_LIST_ID: '   ' })).toBeNull();
  });
});

describe('assertListInScope', () => {
  it('deixa passar a lista de QA', () => {
    expect(() => assertListInScope(QA, { CLICKUP_TEST_LIST_ID: QA })).not.toThrow();
  });
  it('BLOQUEIA criação em lista de cliente', () => {
    expect(() => assertListInScope(CLIENTE, { CLICKUP_TEST_LIST_ID: QA })).toThrow(WriteScopeError);
  });
  it('sem cerca configurada, não interfere', () => {
    expect(() => assertListInScope(CLIENTE, {})).not.toThrow();
  });
});

describe('assertTaskInScope', () => {
  const config = { apiKey: 'k', teamId: 't' } as Parameters<typeof assertTaskInScope>[0];

  function fetchRespondendoLista(listId: string) {
    return async () => new Response(JSON.stringify({ id: 'task-1', list: { id: listId } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  it('deixa passar task que está na lista de QA', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fetchRespondendoLista(QA) as typeof fetch;
    try {
      await expect(assertTaskInScope(config, 'task-1', { CLICKUP_TEST_LIST_ID: QA })).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('BLOQUEIA task que está em lista de cliente', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fetchRespondendoLista(CLIENTE) as typeof fetch;
    try {
      await expect(assertTaskInScope(config, 'task-1', { CLICKUP_TEST_LIST_ID: QA })).rejects.toThrow(/fora do escopo de teste/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('BLOQUEIA quando não consegue descobrir a lista (falha fechada)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('nao autorizado', { status: 401 })) as typeof fetch;
    try {
      await expect(assertTaskInScope(config, 'task-1', { CLICKUP_TEST_LIST_ID: QA })).rejects.toThrow(WriteScopeError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('sem cerca não faz nem a leitura extra', async () => {
    const original = globalThis.fetch;
    let chamou = false;
    globalThis.fetch = (async () => { chamou = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
    try {
      await assertTaskInScope(config, 'task-1', {});
      expect(chamou).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
