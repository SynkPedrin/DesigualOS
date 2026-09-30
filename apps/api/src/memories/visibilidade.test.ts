import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { somenteMemoriaVisivel } from './visibilidade';

/**
 * Guarda de regressão de um vazamento REAL, publicado em 29/09/2026 e achado
 * duas horas depois: `/memories` devolvia anotações `USER_PRIVATE` de outras
 * pessoas — a conta de QA lendo a conta de atendimento, em registros cujo
 * próprio texto dizia "que ninguém mais pode ver".
 *
 * O teste serializa o SQL de verdade, com o dialeto do drizzle, em vez de
 * inspecionar a estrutura interna do objeto. A primeira versão fazia
 * `JSON.stringify` na condição e passava a afirmar coisas sobre um texto que
 * não existia — teste que verifica a própria ficção, que é o defeito que este
 * projeto viu seis vezes num dia.
 */
describe('visibilidade de memória', () => {
  const sqlDe = (userId: string) => new PgDialect().sqlToQuery(somenteMemoriaVisivel(userId)!);

  it('a condição existe — nunca undefined, que viraria "sem filtro nenhum"', () => {
    expect(somenteMemoriaVisivel('user-1')).toBeDefined();
  });

  /**
   * `IS DISTINCT FROM` e não `<>`: quase nenhuma memória tem `mcp_scope`, e com
   * `<>` o NULL faria a comparação virar NULL e a linha sumir — escondendo da
   * pessoa tudo que não veio pelo MCP, que é a maior parte do acervo.
   */
  it('usa IS DISTINCT FROM, que é o que faz NULL contar como visível', () => {
    const { sql } = sqlDe('user-1');
    expect(sql).toContain("->>'mcp_scope' IS DISTINCT FROM 'USER_PRIVATE'");
    expect(sql).not.toMatch(/<>\s*'USER_PRIVATE'/);
  });

  /** A segunda perna: o dono SEMPRE vê o que é dele, e por parâmetro. */
  it('libera o dono, e o id vai parametrizado', () => {
    const { sql, params } = sqlDe('user-42');
    expect(sql).toContain('"memories"."user_id" =');
    expect(params).toEqual(['user-42']);
  });

  /** É um OU: as duas pernas juntas por AND esconderiam tudo. */
  it('as duas pernas são alternativas, não acumulativas', () => {
    expect(sqlDe('user-1').sql).toMatch(/\bor\b/i);
    expect(sqlDe('user-1').sql).not.toMatch(/\band\b/i);
  });
});
