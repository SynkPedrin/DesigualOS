import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { somenteMemoriaVisivelNoMcp } from './visibilidade-de-memoria';

/**
 * Guarda de um vazamento PROVADO contra o banco de produção em 30/09/2026.
 *
 * A tool `search_memory` filtrava por status, texto e cliente opcional — e nada
 * mais. Rodando a cláusula WHERE exata dela, buscar "privada" devolvia 5
 * anotações da conta de atendimento cujo conteúdo diz, com todas as letras,
 * "Anotação privada da Tammy que ninguém mais pode ver". Qualquer pessoa da
 * organização que conectasse um Claude e pesquisasse recebia aquilo.
 *
 * O teste serializa o SQL de verdade, com o dialeto do drizzle, em vez de
 * inspecionar o objeto: a versão equivalente na API começou fazendo
 * `JSON.stringify` na condição e passou a afirmar coisas sobre um texto que não
 * existia — teste que verifica a própria ficção.
 */
describe('visibilidade de memória nas tools do MCP', () => {
  const sqlDe = (userId: string) => new PgDialect().sqlToQuery(somenteMemoriaVisivelNoMcp(userId)!);

  it('a condição existe — nunca undefined, que viraria "sem filtro nenhum"', () => {
    expect(somenteMemoriaVisivelNoMcp('user-1')).toBeDefined();
  });

  it('exclui USER_PRIVATE de terceiros', () => {
    const { sql } = sqlDe('user-1');
    expect(sql).toContain('USER_PRIVATE');
    expect(sql).toContain('mcp_scope');
  });

  /**
   * `IS DISTINCT FROM` e não `<>`: das 489 memórias do banco, 475 não têm
   * `mcp_scope` nenhum. Com `<>`, o NULL faria a comparação virar NULL e a
   * linha sumir — trocando um vazamento por uma amnésia, que é o erro que
   * ninguém reporta porque parece "não tem nada gravado".
   */
  it('usa IS DISTINCT FROM, que é o que faz NULL contar como visível', () => {
    const { sql } = sqlDe('user-1');
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).not.toMatch(/mcp_scope'\s*<>/);
  });

  /** O dono continua lendo a própria anotação — senão privado viraria inútil. */
  it('deixa a pessoa ver a própria memória privada', () => {
    const { sql, params } = sqlDe('user-dono');
    expect(sql).toContain('or');
    expect(params).toContain('user-dono');
  });

  /** O id entra como PARÂMETRO, não interpolado no texto do SQL. */
  it('passa o id do usuário parametrizado', () => {
    const { sql, params } = sqlDe("'; drop table memories; --");
    expect(sql).not.toContain('drop table');
    expect(params).toContain("'; drop table memories; --");
  });
});
