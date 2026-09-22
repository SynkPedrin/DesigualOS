import { describe, expect, it } from 'vitest';
import * as schema from './index';

/**
 * Regressão da correção de 18/09/2026.
 *
 * O defeito: `updatedAt` vinha de `timestampColumns` só com `defaultNow()`, que
 * o Postgres aplica no INSERT e mais nunca. O Drizzle não toca a coluna sozinho
 * num `.update()`, então ela só mudava nas poucas rotas que escreviam
 * `updatedAt: new Date()` à mão.
 *
 * Medido no banco real ANTES da correção: 543 de 663 conversas (82%) com
 * `updated_at` mais velho que a última mensagem delas (a pior por 15 dias), e
 * 133 de 133 documentos do Canva com `updated_at = created_at` apesar de todos
 * terem conteúdo. Como as duas listagens ordenam por `updated_at desc`, a barra
 * lateral do chat e a grade do Canva mostravam a ordem errada - e a conversa
 * usada hoje podia cair fora do corte de 50.
 *
 * Este teste falha se alguém remover o `$onUpdate` de `timestampColumns` ou
 * criar uma tabela nova com `updated_at` sem ele.
 */

/**
 * Tabelas Drizzle exportadas pelo schema que têm coluna `updatedAt`.
 *
 * O cast passa por `unknown` porque os tipos do pg-core são estruturas
 * nominais (PgTable/PgEnum) sem índice de string: aqui a leitura é deliberada e
 * introspectiva, olhando o metadado interno da coluna, não o tipo público.
 */
function tabelasDoSchema(): [string, Record<string, unknown>][] {
  return Object.entries(schema).filter(
    ([, valor]) => typeof valor === 'object' && valor !== null && 'updatedAt' in (valor as object),
  ) as unknown as [string, Record<string, unknown>][];
}

describe('timestampColumns.updatedAt', () => {
  it('existe em várias tabelas (o teste não está passando por vacuidade)', () => {
    expect(tabelasDoSchema().length).toBeGreaterThan(5);
  });

  it('TODA tabela com updated_at atualiza a coluna sozinha no UPDATE', () => {
    const semOnUpdate = tabelasDoSchema()
      .filter(([, tabela]) => {
        const coluna = tabela.updatedAt as { onUpdateFn?: unknown };
        return typeof coluna?.onUpdateFn !== 'function';
      })
      .map(([nome]) => nome);

    expect(semOnUpdate).toEqual([]);
  });

  it('o valor gerado é um Date do instante da escrita', () => {
    const [, tabela] = tabelasDoSchema()[0]!;
    const coluna = tabela.updatedAt as { onUpdateFn: () => unknown };
    const antes = Date.now();
    const valor = coluna.onUpdateFn();
    expect(valor).toBeInstanceOf(Date);
    expect((valor as Date).getTime()).toBeGreaterThanOrEqual(antes);
  });
});
