import { describe, expect, it, vi } from 'vitest';
import { hasPermission, loadUserAccess } from './rbac';

/**
 * Cadeia Usuário -> Role -> Permission (seção 6.8). Este pacote não tem
 * acesso fácil a um Postgres real em teste unitário, então `loadUserAccess`
 * é testado mockando `@desigual-os/database` (mesmo padrão usado em
 * apps/api/src/integrations/access.test.ts): o `eq`/`innerJoin`/`leftJoin`
 * reais do drizzle-orm continuam em uso (não precisam de coluna real pra
 * montar a query, só pra executá-la), só o resultado final do `.where()` é
 * trocado por linhas fabricadas.
 *
 * A lista de permissões seedadas pro papel `colaborador` abaixo é copiada
 * de packages/database/src/seed.ts (PERMISSIONS), conferida em 08/09/2026:
 * chat:write, executions:read, clients:read, clients:write, studio:write,
 * knowledge:read, clickup:write. Qualquer combinação fora dessa lista (ex:
 * admin:write, costs:read) precisa continuar negada.
 */

const mockAccessRows = vi.fn<() => Array<{ roleName: string; resource: string | null; action: string | null }>>();

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({
            where: () => Promise.resolve(mockAccessRows()),
          }),
        }),
      }),
    }),
  },
  schema: {
    userRoles: { userId: 'user_id', roleId: 'role_id' },
    roles: { id: 'id', name: 'name' },
    permissions: { roleId: 'role_id', resource: 'resource', action: 'action' },
  },
}));

const COLABORADOR_PERMISSIONS = [
  { resource: 'chat', action: 'write' },
  { resource: 'executions', action: 'read' },
  { resource: 'clients', action: 'read' },
  { resource: 'clients', action: 'write' },
  { resource: 'studio', action: 'write' },
  { resource: 'knowledge', action: 'read' },
  { resource: 'clickup', action: 'write' },
];

describe('hasPermission', () => {
  it('papel master (resource=* action=*) libera qualquer combinação de resource/action', () => {
    const permissions = [{ resource: '*', action: '*' }];

    expect(hasPermission(permissions, 'clients', 'read')).toBe(true);
    expect(hasPermission(permissions, 'admin', 'write')).toBe(true);
    expect(hasPermission(permissions, 'qualquer-coisa', 'qualquer-acao')).toBe(true);
  });

  it('colaborador: libera exatamente as permissões seedadas, nega tudo fora da lista', () => {
    for (const permission of COLABORADOR_PERMISSIONS) {
      expect(hasPermission(COLABORADOR_PERMISSIONS, permission.resource, permission.action)).toBe(true);
    }

    // Fora da lista seedada pro colaborador.
    expect(hasPermission(COLABORADOR_PERMISSIONS, 'admin', 'write')).toBe(false);
    expect(hasPermission(COLABORADOR_PERMISSIONS, 'costs', 'read')).toBe(false);
    // Resource seedado, mas ação errada (só existe clients:read/clients:write, não clients:delete).
    expect(hasPermission(COLABORADOR_PERMISSIONS, 'clients', 'delete')).toBe(false);
    // Resource seedado só com uma ação (chat só tem write, não read).
    expect(hasPermission(COLABORADOR_PERMISSIONS, 'chat', 'read')).toBe(false);
  });

  it('curinga parcial: resource=* com action específica só libera aquela action', () => {
    const permissions = [{ resource: '*', action: 'read' }];

    expect(hasPermission(permissions, 'clients', 'read')).toBe(true);
    expect(hasPermission(permissions, 'costs', 'read')).toBe(true);
    expect(hasPermission(permissions, 'clients', 'write')).toBe(false);
  });

  it('usuário sem permissão nenhuma: nega tudo', () => {
    expect(hasPermission([], 'clients', 'read')).toBe(false);
    expect(hasPermission([], '*', '*')).toBe(false);
  });
});

describe('loadUserAccess', () => {
  it('usuário master: resolve role e permissão curinga', async () => {
    mockAccessRows.mockReturnValue([{ roleName: 'master', resource: '*', action: '*' }]);

    const access = await loadUserAccess('user-master');

    expect(access.roles).toEqual(['master']);
    expect(access.permissions).toEqual([{ resource: '*', action: '*' }]);
    expect(hasPermission(access.permissions, 'anything', 'anything')).toBe(true);
  });

  it('usuário colaborador: resolve exatamente a matriz seedada (uma linha por permissão, mesma role repetida)', async () => {
    mockAccessRows.mockReturnValue(
      COLABORADOR_PERMISSIONS.map((permission) => ({ roleName: 'colaborador', ...permission })),
    );

    const access = await loadUserAccess('user-colaborador');

    // roles é um Set: mesmo com 7 linhas (uma por permissão), só uma role.
    expect(access.roles).toEqual(['colaborador']);
    expect(access.permissions).toEqual(COLABORADOR_PERMISSIONS);
    expect(hasPermission(access.permissions, 'admin', 'write')).toBe(false);
  });

  it('usuário com role mas sem nenhuma permission (leftJoin sem match): role aparece, permissions vazio', async () => {
    // leftJoin sem match do lado de permissions devolve resource/action null.
    mockAccessRows.mockReturnValue([{ roleName: 'colaborador', resource: null, action: null }]);

    const access = await loadUserAccess('user-sem-permissao');

    expect(access.roles).toEqual(['colaborador']);
    expect(access.permissions).toEqual([]);
    expect(hasPermission(access.permissions, 'clients', 'read')).toBe(false);
  });

  it('usuário sem nenhum papel atribuído: roles e permissions vazios, nega tudo', async () => {
    mockAccessRows.mockReturnValue([]);

    const access = await loadUserAccess('user-sem-role');

    expect(access.roles).toEqual([]);
    expect(access.permissions).toEqual([]);
    expect(hasPermission(access.permissions, 'chat', 'write')).toBe(false);
  });
});
