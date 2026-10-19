import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regras de resolução do entity graph (migração 0051). O banco é mockado no
 * mesmo estilo de apps/api/src/clickup/routes.test.ts: o que se trava aqui é a
 * REGRA (link existe -> resolve; e-mail casa -> cria link; nada -> null), não o
 * SQL — a garantia de idempotência é o índice único, inspecionado na migração.
 */

const selectWhere = vi.fn();
const insertValues = vi.fn();
const insertReturning = vi.fn();

vi.mock('./client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => selectWhere(...args),
        leftJoin: () => ({ where: (...args: unknown[]) => selectWhere(...args) }),
        innerJoin: () => ({ where: (...args: unknown[]) => selectWhere(...args) }),
      }),
    }),
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return { onConflictDoNothing: () => ({ returning: () => insertReturning() }) };
      },
    }),
  },
}));

const { vincularEntidade, resolverPessoaPorClickupUserId, resolverPessoaPorEmail, linksDaEntidade } = await import(
  './entity-resolution'
);

const PESSOA = { userId: 'user-1', name: 'Ana', employeeId: 'emp-1' };

describe('entity-resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('link existente resolve a pessoa (clickup user id -> users.id)', async () => {
    selectWhere
      .mockResolvedValueOnce([{ desigualId: 'user-1' }]) // entity_links
      .mockResolvedValueOnce([PESSOA]); // users + membership
    const pessoa = await resolverPessoaPorClickupUserId('org-1', '12345');
    expect(pessoa).toEqual(PESSOA);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('sem link, devolve null — nunca inventa quem é', async () => {
    selectWhere.mockResolvedValueOnce([]);
    expect(await resolverPessoaPorClickupUserId('org-1', '99999')).toBeNull();
  });

  it('e-mail casa com users.clickup_email -> resolve E grava o link pra próxima vez', async () => {
    selectWhere.mockResolvedValueOnce([PESSOA]); // users join membership
    insertReturning.mockResolvedValueOnce([{ id: 'link-1' }]);
    const pessoa = await resolverPessoaPorEmail('org-1', 'ana@desigual.com', '12345');
    expect(pessoa).toEqual(PESSOA);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        entityType: 'person',
        desigualId: 'user-1',
        source: 'clickup',
        externalId: '12345',
      }),
    );
  });

  it('e-mail sem match -> null e NENHUM link gravado', async () => {
    selectWhere.mockResolvedValueOnce([]);
    expect(await resolverPessoaPorEmail('org-1', 'ninguem@fora.com', '99999')).toBeNull();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('e-mail casa mas sem clickupUserId -> resolve sem gravar link (não tem o que vincular)', async () => {
    selectWhere.mockResolvedValueOnce([PESSOA]);
    const pessoa = await resolverPessoaPorEmail('org-1', 'ana@desigual.com', null);
    expect(pessoa).toEqual(PESSOA);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('vincularEntidade é idempotente: conflito vira existing, não erro nem duplicata', async () => {
    insertReturning.mockResolvedValueOnce([]); // onConflictDoNothing: nada inserido
    selectWhere.mockResolvedValueOnce([{ id: 'link-existente' }]);
    const r = await vincularEntidade({
      organizationId: 'org-1',
      entityType: 'person',
      desigualId: 'user-1',
      source: 'clickup',
      externalId: '12345',
    });
    expect(r).toEqual({ status: 'existing', linkId: 'link-existente' });
  });

  it('linksDaEntidade lista os vínculos da entidade dentro da org', async () => {
    selectWhere.mockResolvedValueOnce([{ id: 'link-1', source: 'clickup', externalId: '12345' }]);
    const links = await linksDaEntidade('org-1', 'user-1');
    expect(links).toHaveLength(1);
  });
});
