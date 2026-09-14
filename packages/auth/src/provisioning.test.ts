import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOrProvisionUser } from './provisioning';
import type { SupabaseClaims } from './supabase-jwt';

/**
 * `resolveOrProvisionUser` fala com o banco (drizzle) direto, sem nenhuma
 * lógica pura separável - mockar `@desigual-os/database` é o jeito mais
 * direto de testar o comportamento sem subir um Postgres real (mesmo padrão
 * de apps/api/src/integrations/access.test.ts).
 *
 * drizzle-orm também é mockado aqui (só a função `eq`) pra poder inspecionar,
 * no `.where()` fabricado abaixo, com QUAL valor o código realmente
 * consultou - sem isso só daria pra verificar o resultado final, não a
 * decisão que leva até ele.
 *
 * Auditoria pré-deploy (14/09/2026): o JIT dava 'colaborador' (com
 * clients:write, clickup:write, chat:write) pra QUALQUER autocadastro em
 * /signup. Agora só e-mails em masterEmails ganham papel; os demais ficam
 * sem papel nenhum até um admin atribuir pelo painel. O teste "e-mail fora
 * de MASTER_USER_EMAILS" abaixo trava exatamente isso.
 */

const mockExistingUser = vi.fn<() => Array<{ id: string; authUserId: string; email: string }>>();
const mockRoleRow = vi.fn<() => Array<{ id: string; name: string }>>();
const mockInsertUser = vi.fn<(row: unknown) => Array<Record<string, unknown>>>();
const mockInsertUserRole = vi.fn<(row: { userId: string; roleId: string }) => void>();
const mockDbInsert = vi.fn();

vi.mock('drizzle-orm', () => ({
  eq: (_column: unknown, value: unknown) => ({ __op: 'eq' as const, value }),
}));

vi.mock('@desigual-os/database', () => {
  const usersTable = { authUserId: 'auth_user_id' };
  const rolesTable = { name: 'name' };
  const userRolesTable = { userId: 'user_id', roleId: 'role_id' };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === usersTable) return Promise.resolve(mockExistingUser());
            if (table === rolesTable) return Promise.resolve(mockRoleRow());
            return Promise.resolve([]);
          },
        }),
      }),
      insert: (table: unknown) => {
        mockDbInsert(table);
        return {
          values: (row: Record<string, unknown>) => {
            if (table === usersTable) {
              return { returning: () => Promise.resolve(mockInsertUser(row)) };
            }
            mockInsertUserRole(row as { userId: string; roleId: string });
            return Promise.resolve(undefined);
          },
        };
      },
    },
    schema: { users: usersTable, roles: rolesTable, userRoles: userRolesTable },
  };
});

function claims(overrides: Partial<SupabaseClaims> = {}): SupabaseClaims {
  return { sub: 'auth-uuid-1', email: 'novo@desigual.com', raw: {}, ...overrides };
}

describe('resolveOrProvisionUser', () => {
  beforeEach(() => {
    mockExistingUser.mockReset();
    mockRoleRow.mockReset();
    mockInsertUser.mockReset();
    mockInsertUserRole.mockReset();
    mockDbInsert.mockReset();
  });

  it('primeiro acesso, e-mail em MASTER_USER_EMAILS: cria o usuário e atribui o papel master', async () => {
    mockExistingUser.mockReturnValue([]);
    mockInsertUser.mockReturnValue([{ id: 'user-1', authUserId: 'auth-uuid-1', email: 'chefe@desigual.com' }]);
    mockRoleRow.mockReturnValue([{ id: 'role-master', name: 'master' }]);
    const masterEmails = new Set(['chefe@desigual.com']);

    const user = await resolveOrProvisionUser(claims({ email: 'chefe@desigual.com' }), masterEmails);

    expect(user).toEqual({ id: 'user-1', authUserId: 'auth-uuid-1', email: 'chefe@desigual.com' });
    expect(mockInsertUserRole).toHaveBeenCalledWith({ userId: 'user-1', roleId: 'role-master' });
  });

  it('primeiro acesso, e-mail fora de MASTER_USER_EMAILS: cria o usuário SEM papel nenhum', async () => {
    mockExistingUser.mockReturnValue([]);
    mockInsertUser.mockReturnValue([{ id: 'user-2', authUserId: 'auth-uuid-2', email: 'novo@desigual.com' }]);
    const masterEmails = new Set(['chefe@desigual.com']);

    const user = await resolveOrProvisionUser(claims({ sub: 'auth-uuid-2', email: 'novo@desigual.com' }), masterEmails);

    expect(user).toEqual({ id: 'user-2', authUserId: 'auth-uuid-2', email: 'novo@desigual.com' });
    // Nem consulta a roles, nem insert em user_roles: sem papel até um admin
    // atribuir pelo painel (auditoria pré-deploy 14/09/2026).
    expect(mockInsertUserRole).not.toHaveBeenCalled();
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it('checagem de e-mail master é case-insensitive (masterEmails já normalizado em minúsculo pelo middleware)', async () => {
    mockExistingUser.mockReturnValue([]);
    mockInsertUser.mockReturnValue([{ id: 'user-3', authUserId: 'auth-uuid-3', email: 'Chefe@Desigual.com' }]);
    mockRoleRow.mockReturnValue([{ id: 'role-master', name: 'master' }]);
    // O middleware real (apps/api/src/auth/middleware.ts) normaliza pra minúsculo
    // antes de montar o Set; resolveOrProvisionUser também normaliza o e-mail
    // do claim antes de comparar.
    const masterEmails = new Set(['chefe@desigual.com']);

    const user = await resolveOrProvisionUser(claims({ sub: 'auth-uuid-3', email: 'Chefe@Desigual.com' }), masterEmails);

    expect(user.id).toBe('user-3');
    expect(mockInsertUserRole).toHaveBeenCalledWith({ userId: 'user-3', roleId: 'role-master' });
  });

  it('chamada subsequente pro mesmo auth_user_id: devolve o usuário existente, sem inserir de novo (idempotência)', async () => {
    mockExistingUser.mockReturnValue([{ id: 'user-1', authUserId: 'auth-uuid-1', email: 'chefe@desigual.com' }]);

    const user = await resolveOrProvisionUser(claims({ email: 'chefe@desigual.com' }), new Set(['chefe@desigual.com']));

    expect(user).toEqual({ id: 'user-1', authUserId: 'auth-uuid-1', email: 'chefe@desigual.com' });
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockInsertUserRole).not.toHaveBeenCalled();
  });

  it('nome vem de user_metadata.name quando presente (enviado pelo signup em options.data.name)', async () => {
    mockExistingUser.mockReturnValue([]);
    mockInsertUser.mockReturnValue([{ id: 'user-4', authUserId: 'auth-uuid-4', email: 'maria@desigual.com' }]);

    await resolveOrProvisionUser(claims({ email: 'maria@desigual.com', raw: { user_metadata: { name: 'Maria Silva' } } }), new Set());

    expect(mockInsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Maria Silva' }),
    );
  });

  it('user_metadata.name ausente ou vazio cai pro prefixo do e-mail, como antes', async () => {
    mockExistingUser.mockReturnValue([]);
    mockInsertUser.mockReturnValue([{ id: 'user-5', authUserId: 'auth-uuid-5', email: 'joao@desigual.com' }]);
    await resolveOrProvisionUser(claims({ email: 'joao@desigual.com', raw: { user_metadata: { name: '   ' } } }), new Set());
    expect(mockInsertUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'joao' }));

    mockInsertUser.mockClear().mockReturnValue([{ id: 'user-6', authUserId: 'auth-uuid-6', email: 'ana@desigual.com' }]);
    await resolveOrProvisionUser(claims({ email: 'ana@desigual.com', raw: {} }), new Set());
    expect(mockInsertUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'ana' }));
  });
});
