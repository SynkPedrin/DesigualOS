import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { quadrosVisiveisPara } from './routes';

/**
 * O `IS NULL` QUE SEGURA O QUADRO DA AGÊNCIA DE PÉ.
 *
 * `owner_id IS NULL` significa "quadro da agência". Em SQL, `owner_id = $1`
 * NUNCA é verdadeiro numa linha com NULL — então alguém que "simplifique"
 * esta cláusula para um `eq` sozinho faz todo quadro compartilhado sumir da
 * tela de todo mundo. Sem erro, sem log: a tela fica só com os quadros
 * pessoais e ninguém liga uma coisa à outra.
 *
 * Esse defeito já aconteceu neste repositório, com clientes, e levou horas
 * até alguém olhar o banco. Aqui ele é verificado no SQL gerado, que é o
 * único lugar onde ele seria visível antes de acontecer.
 */
const sqlDe = (c: unknown) => new PgDialect().sqlToQuery((c as never)).sql.toLowerCase();

describe('quadrosVisiveisPara', () => {
  const sql = sqlDe(quadrosVisiveisPara('user-1', 'org-1'));

  /**
   * A asserção é sobre `owner_id is null`, não sobre a string "is null" solta.
   * Na primeira versão deste teste eu escrevi `toContain('is null')` e ele
   * PASSOU com o `isNull` do owner removido — porque `deleted_at is null`, na
   * mesma consulta, já satisfazia a busca. Uma asserção que o defeito não
   * consegue derrubar é um enfeite com cara de rede de proteção.
   */
  it('pergunta por owner_id IS NULL — é o que mantém o quadro da agência visível', () => {
    expect(sql).toMatch(/owner_id"?\s+is\s+null/);
  });

  it('e também pelo dono, senão ninguém vê os próprios quadros', () => {
    expect(sql).toMatch(/owner_id"?\s*=/);
  });

  it('as duas condições são alternativas (OR), não exigências (AND)', () => {
    // Com AND, só apareceria quadro que é da agência E meu ao mesmo tempo —
    // ou seja, nenhum.
    expect(sql).toContain(' or ');
  });

  it('recorta por empresa e esconde apagado', () => {
    expect(sql).toMatch(/organization_id"?\s*=/);
    expect(sql).toContain('deleted_at');
  });
});
