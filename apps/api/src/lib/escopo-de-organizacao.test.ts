import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { recorteDePessoasVisiveis } from './escopo-de-organizacao';

describe('recorte de pessoas visíveis, em SQL', () => {
  const usuario = { id: 'user-1', roles: ['colaborador'] } as unknown as Parameters<
    typeof recorteDePessoasVisiveis
  >[0];
  const sqlDe = (u: typeof usuario) =>
    new PgDialect().sqlToQuery(recorteDePessoasVisiveis(u, sql`u.id`));

  it('liga a pessoa às organizações de quem pergunta', () => {
    const { sql: texto } = sqlDe(usuario);

    expect(texto).toContain('organization_members');
    // O join é o que garante "mesma empresa" — sem ele, o EXISTS passaria
    // para qualquer par de pessoas.
    expect(texto.replace(/\s+/g, ' ')).toMatch(/join organization_members .* on .*organization_id/i);
  });

  /** Quem pergunta sempre se vê, mesmo sem empresa nenhuma. */
  it('inclui a própria pessoa', () => {
    const { params } = sqlDe(usuario);

    expect(params.filter((p) => p === 'user-1').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * O id entra PARAMETRIZADO. Já tentei montar essa lista concatenando string
   * neste mesmo módulo — funciona e é injeção esperando acontecer.
   */
  it('não concatena o id no texto do SQL', () => {
    const malicioso = { id: "'; drop table users; --", roles: [] } as unknown as typeof usuario;
    const { sql: texto, params } = sqlDe(malicioso);

    expect(texto).not.toContain('drop table');
    expect(params).toContain("'; drop table users; --");
  });
});
