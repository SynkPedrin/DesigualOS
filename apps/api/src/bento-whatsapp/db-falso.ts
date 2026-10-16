/**
 * `db` falso para testes de rota: cada consulta (select/insert/update/delete)
 * vira uma chamada a `responder(op, tabela)`, que o teste programa. A
 * construção encadeada do Drizzle (`.from().where().orderBy()...`) é aceita
 * sem ser interpretada — o que se testa é a decisão da rota, não o SQL.
 */
import { getTableName, isTable } from 'drizzle-orm';

export type Operacao = 'select' | 'insert' | 'update' | 'delete';
export type Responder = (op: Operacao, tabela: string) => unknown;

function nomeDa(alvo: unknown): string {
  return isTable(alvo) ? getTableName(alvo) : 'desconhecida';
}

function construtor(op: Operacao, responder: Responder, tabelaInicial?: unknown) {
  let tabela = tabelaInicial !== undefined ? nomeDa(tabelaInicial) : 'desconhecida';
  const alvo: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(alvo, {
    get(_t, prop) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => {
          try {
            return Promise.resolve(responder(op, tabela)).then(ok, erro);
          } catch (e) {
            return Promise.reject(e).then(ok, erro);
          }
        };
      }
      if (prop === 'catch') return (erro: (e: unknown) => unknown) => Promise.resolve(responder(op, tabela)).catch(erro);
      if (prop === 'from') {
        return (t: unknown) => {
          tabela = nomeDa(t);
          return proxy;
        };
      }
      return () => proxy;
    },
  });
  return proxy;
}

export function dbFalso(responder: Responder) {
  return {
    select: () => construtor('select', responder),
    insert: (t: unknown) => construtor('insert', responder, t),
    update: (t: unknown) => construtor('update', responder, t),
    delete: (t: unknown) => construtor('delete', responder, t),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(dbFalso(responder)),
  };
}
