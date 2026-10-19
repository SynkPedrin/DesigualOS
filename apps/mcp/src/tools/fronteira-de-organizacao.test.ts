import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { schema } from '@desigual-os/database';
import { fronteiraDeOrganizacao } from './fronteira-de-organizacao';

/**
 * A condição que faz organization_id (migração 0045) valer em toda consulta,
 * não só nas que alguém lembrou de escrever à mão.
 */
describe('fronteira de organização', () => {
  const sqlDe = (organizationId: string) =>
    new PgDialect().sqlToQuery(fronteiraDeOrganizacao(schema.memories.organizationId, organizationId));

  it('a condição existe — nunca undefined, que viraria "sem filtro nenhum"', () => {
    expect(fronteiraDeOrganizacao(schema.memories.organizationId, 'org-1')).toBeDefined();
  });

  it('compara organization_id com o valor certo', () => {
    const { sql, params } = sqlDe('org-1');
    expect(sql).toContain('organization_id');
    expect(params).toContain('org-1');
  });

  /**
   * TRANSICIONAL: linha sem organization_id (backfill não resolveu, ou
   * caminho de escrita ainda não popula) continua visível. Excluir agora
   * faria memória de sistema legítima sumir de busca — trocaria vazamento
   * por amnésia, mesmo erro que IS DISTINCT FROM evita em
   * visibilidade-de-memoria.ts.
   */
  it('linha com organization_id nulo continua visível (transicional)', () => {
    const { sql } = sqlDe('org-1');
    expect(sql).toMatch(/is null/i);
  });

  it('aceita a coluna de outra tabela, não só memories', () => {
    const { sql } = new PgDialect().sqlToQuery(fronteiraDeOrganizacao(schema.proactiveSignals.organizationId, 'org-1'));
    expect(sql).toBeTruthy();
  });

  /** O id entra como PARÂMETRO, não interpolado no texto do SQL. */
  it('passa o organizationId parametrizado', () => {
    const { sql, params } = sqlDe("'; drop table memories; --");
    expect(sql).not.toContain('drop table');
    expect(params).toContain("'; drop table memories; --");
  });
});
