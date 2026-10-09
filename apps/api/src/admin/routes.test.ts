import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * A VULNERABILIDADE CROSS-TENANT NAS 4 MUTAÇÕES DE /admin/users, travada:
 *
 *   - `users:write` sozinho respondia "esta pessoa pode administrar gente?",
 *     nunca "gente de qual empresa?" — master da empresa A mudava papel,
 *     desativava, renomeava ou apagava um usuário cujo único vínculo era a
 *     empresa B, bastando saber o uuid. A listagem (`GET /admin/users`) já
 *     aplicava `recorteDePessoasVisiveis`; só as 4 mutações vazavam.
 *   - a correção reusa a MESMA escada de `requireTenant` (empresa de
 *     trabalho) + `userBelongsToTenant` (novo, mesmo princípio de
 *     `clientBelongsToTenant`) — nunca "qualquer empresa que o provider
 *     consegue ler", só a empresa ATIVA (escrita nunca atravessa).
 *   - empresa alheia responde 404 em todas as 4, nunca 403 (não confirma a
 *     existência de um usuário de outro tenant).
 *
 * Fastify real, banco mockado em memória (mesmo padrão de
 * organizations/membros.test.ts e connectors/routes.test.ts): `requireTenant`
 * é mockado (a escada de resolução de empresa de trabalho já tem suíte
 * própria em packages/auth); `userBelongsToTenant` roda de VERDADE contra o
 * banco em memória — é o código novo sob teste.
 */

let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let currentTenantOrgId: string | null;

interface UsuarioRow {
  id: string;
  email: string;
  name: string;
  active: boolean;
  authUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
interface MembroRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}
interface RoleRow {
  id: string;
  name: string;
}
interface UserRoleRow {
  userId: string;
  roleId: string;
}

let usuarios: UsuarioRow[];
let membros: MembroRow[];
let rolesRows: RoleRow[];
let userRolesRows: UserRoleRow[];
let auditRows: Array<Record<string, unknown>>;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ORGANIZACOES = [ORG_A, ORG_B];

const MASTER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALVO_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // membro só de A
const ALVO_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // membro só de B
const ALVO_MULTI = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // membro de A e B

/** Todos os valores string embutidos numa condição drizzle mockada (mesmo
 *  helper de organizations/membros.test.ts e connectors/routes.test.ts). */
function coletarParams(no: unknown, achados: string[] = []): string[] {
  if (typeof no === 'string') {
    achados.push(no);
    return achados;
  }
  if (Array.isArray(no)) {
    for (const item of no) coletarParams(item, achados);
    return achados;
  }
  if (no === null || typeof no !== 'object') return achados;
  if ('value' in no && !Array.isArray((no as { value: unknown }).value)) {
    coletarParams((no as { value: unknown }).value, achados);
  }
  const chunks = (no as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) for (const c of chunks) coletarParams(c, achados);
  return achados;
}

vi.mock('@desigual-os/database', () => {
  const users = {
    id: 'users.id',
    email: 'users.email',
    name: 'users.name',
    active: 'users.active',
    authUserId: 'users.auth_user_id',
    createdAt: 'users.created_at',
    updatedAt: 'users.updated_at',
  };
  const organizationMembers = {
    id: 'om.id',
    organizationId: 'om.organization_id',
    userId: 'om.user_id',
    role: 'om.role',
  };
  const roles = { id: 'roles.id', name: 'roles.name' };
  const userRoles = { userId: 'ur.user_id', roleId: 'ur.role_id' };
  const auditLogs = { id: 'audit.id', userId: 'audit.user_id' };
  const executions = { id: 'executions.id', userId: 'executions.user_id' };
  const conversations = { id: 'conversations.id', userId: 'conversations.user_id' };
  const directMessages = { id: 'dm.id', senderId: 'dm.sender_id', recipientId: 'dm.recipient_id' };
  const clientUsers = { userId: 'cu.user_id' };
  const notifications = { userId: 'notif.user_id' };

  // As cinco tabelas com FK `NOT NULL` + `restrict` a users. Sem elas no stub,
  // `schema.demands.id` era `undefined.id` e o DELETE devolvia 500 — que foi
  // exatamente o defeito visto em produção (09/10/2026), só que ali por outra
  // razão: a rota nem consultava essas tabelas e esbarrava na FK no fim.
  const demands = { id: 'demands.id', createdBy: 'demands.created_by' };
  const briefs = { id: 'briefs.id', createdBy: 'briefs.created_by' };
  const calendarEvents = { id: 'cal.id', createdBy: 'cal.created_by' };
  const approvalRequests = { id: 'appr.id', requestedBy: 'appr.requested_by' };
  const clientReports = { id: 'rep.id', requestedBy: 'rep.requested_by' };

  function filtrar(table: unknown, cond: unknown): unknown[] {
    const params = coletarParams(cond);
    if (table === users) return usuarios.filter((u) => params.includes(u.id)).map((u) => ({ ...u }));
    if (table === organizationMembers) {
      const orgIds = params.filter((p) => ORGANIZACOES.includes(p));
      const userIds = params.filter((p) => usuarios.some((u) => u.id === p));
      return membros.filter(
        (m) =>
          (orgIds.length === 0 || orgIds.includes(m.organizationId)) &&
          (userIds.length === 0 || userIds.includes(m.userId)),
      );
    }
    if (table === roles) return rolesRows.filter((r) => params.includes(r.id) || params.includes(r.name));
    if (table === userRoles) return userRolesRows.filter((r) => params.includes(r.userId) || params.includes(r.roleId));
    // Checagens de atividade do DELETE: sem fixture de atividade nestes
    // testes, sempre vazio (o 409 de "tem atividade" não é o que este slice
    // corrige, e tem teste próprio noutro lugar quando existir).
    return [];
  }

  const comLimit = <T>(linhas: T[]) => Object.assign(Promise.resolve(linhas), { limit: () => Promise.resolve(linhas) });

  return {
    db: {
      select: (_cols?: unknown) => ({
        from: (table: unknown) => ({
          where: (cond: unknown) => comLimit(filtrar(table, cond)),
          // Só o join que a rota de troca de papel usa (papel ANTERIOR, pra
          // auditoria) — mesma tabela de origem (userRoles), roles como alvo.
          innerJoin: (_joinTable: unknown, _on: unknown) => ({
            where: (cond: unknown) =>
              comLimit(
                (filtrar(userRoles, cond) as UserRoleRow[]).map((r) => ({
                  name: rolesRows.find((role) => role.id === r.roleId)?.name,
                })),
              ),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === userRoles) userRolesRows.push({ userId: v.userId as string, roleId: v.roleId as string });
          if (table === auditLogs) auditRows.push(v);
          return Promise.resolve(undefined);
        },
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            const linhas = filtrar(table, cond) as UsuarioRow[];
            for (const l of linhas) {
              const original = usuarios.find((u) => u.id === l.id);
              if (original) Object.assign(original, patch);
            }
            return { returning: () => Promise.resolve(linhas.map((l) => ({ ...l, ...patch }))) };
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: (cond: unknown) => {
          if (table === userRoles) {
            const params = coletarParams(cond);
            userRolesRows = userRolesRows.filter((r) => !params.includes(r.userId));
          }
          if (table === users) {
            const params = coletarParams(cond);
            usuarios = usuarios.filter((u) => !params.includes(u.id));
          }
          return Promise.resolve(undefined);
        },
      }),
    },
    schema: { users, organizationMembers, roles, userRoles, auditLogs, executions, conversations, directMessages, clientUsers, notifications, demands, briefs, calendarEvents, approvalRequests, clientReports },
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
  requirePermission: (resource: string, action: string) => async (request: { authUser?: typeof currentUser }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const permitido = (request.authUser?.permissions ?? []).some((p) => p.resource === resource && p.action === action);
    if (!permitido) reply.code(403).send({ error: `Missing permission ${resource}:${action}` });
  },
  requireRole: (...papeis: string[]) => async (request: { authUser?: typeof currentUser }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    if (!papeis.some((papel) => (request.authUser?.roles ?? []).includes(papel))) {
      reply.code(403).send({ error: 'Somente um administrador pode fazer isso.' });
    }
  },
  invalidateUserAccessCache: vi.fn(),
}));

// `requireTenant` é mockado (a escada empresa-ativa/vínculo-único/provedora já
// tem suíte própria em packages/auth); `userBelongsToTenant` é mantido REAL —
// é o código novo que este slice introduz, e roda contra o banco em memória
// acima.
vi.mock('../lib/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tenant-context')>();
  return {
    ...actual,
    requireTenant: async (
      request: { tenantContext?: unknown },
      reply: { code: (n: number) => { send: (b: unknown) => void }; sent?: boolean },
    ) => {
      if (currentTenantOrgId === null) {
        reply.code(403).send({ error: 'Organization membership required' });
        return;
      }
      request.tenantContext = { organizationId: currentTenantOrgId };
    },
  };
});

vi.mock('../lib/email', () => ({ sendInviteEmail: vi.fn() }));

const { registerAdminRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  await registerAdminRoutes(app);
  return app;
}

function usuario(id: string, extra: Partial<UsuarioRow> = {}): UsuarioRow {
  return {
    id,
    email: `${id.slice(0, 4)}@desigual.com`,
    name: `Usuário ${id.slice(0, 4)}`,
    active: true,
    authUserId: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...extra,
  };
}

function membro(userId: string, organizationId: string): MembroRow {
  return { id: `vinculo-${userId.slice(0, 4)}-${organizationId.slice(0, 4)}`, organizationId, userId, role: 'master' };
}

beforeEach(() => {
  auditRows = [];
  currentUser = { id: MASTER_A, roles: ['master'], permissions: [{ resource: 'users', action: 'write' }] };
  currentTenantOrgId = ORG_A;

  usuarios = [usuario(MASTER_A), usuario(ALVO_A), usuario(ALVO_B), usuario(ALVO_MULTI)];
  membros = [membro(MASTER_A, ORG_A), membro(ALVO_A, ORG_A), membro(ALVO_B, ORG_B), membro(ALVO_MULTI, ORG_A), membro(ALVO_MULTI, ORG_B)];
  rolesRows = [
    { id: 'role-master', name: 'master' },
    { id: 'role-colaborador', name: 'colaborador' },
  ];
  userRolesRows = [{ userId: ALVO_A, roleId: 'role-colaborador' }];
});

const ROTAS_DE_MUTACAO: Array<{ nome: string; chamar: (app: ReturnType<typeof Fastify>, id: string) => Promise<{ statusCode: number }> }> = [
  {
    nome: 'role',
    chamar: (app, id) => app.inject({ method: 'PATCH', url: `/admin/users/${id}/role`, payload: { role: 'master' } }),
  },
  {
    nome: 'status',
    chamar: (app, id) => app.inject({ method: 'PATCH', url: `/admin/users/${id}/status`, payload: { active: false } }),
  },
  {
    nome: 'rename',
    chamar: (app, id) => app.inject({ method: 'PATCH', url: `/admin/users/${id}`, payload: { name: 'Novo Nome' } }),
  },
  {
    nome: 'delete',
    chamar: (app, id) => app.inject({ method: 'DELETE', url: `/admin/users/${id}` }),
  },
];

describe('cross-tenant: master da empresa A não mexe em usuário só da empresa B', () => {
  for (const rota of ROTAS_DE_MUTACAO) {
    it(`${rota.nome}: 404, nenhuma mutação ocorre`, async () => {
      const app = await buildApp();
      const antes = usuarios.find((u) => u.id === ALVO_B);
      const vinculosAntes = userRolesRows.filter((r) => r.userId === ALVO_B).length;

      const res = await rota.chamar(app, ALVO_B);

      expect(res.statusCode).toBe(404);
      // Nada mudou: nem o usuário, nem os vínculos de papel.
      expect(usuarios.find((u) => u.id === ALVO_B)).toEqual(antes);
      expect(userRolesRows.filter((r) => r.userId === ALVO_B).length).toBe(vinculosAntes);
    });

    it(`${rota.nome}: tentativa cross-tenant grava authorization.denied`, async () => {
      const app = await buildApp();
      await rota.chamar(app, ALVO_B);

      const log = auditRows.find((r) => r.action === 'authorization.denied');
      expect(log).toMatchObject({
        userId: MASTER_A,
        result: 'denied',
        resourceType: 'user',
        resourceId: ALVO_B,
        metadata: expect.objectContaining({ reason: 'cross_tenant_target' }),
      });
    });
  }
});

describe('happy path: master da empresa A age sobre usuário da própria empresa A', () => {
  it('role: 200, papel muda', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}/role`, payload: { role: 'master' } });
    expect(res.statusCode).toBe(200);
    expect(userRolesRows.find((r) => r.userId === ALVO_A)?.roleId).toBe('role-master');
  });

  it('status: 200, usuário desativado', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}/status`, payload: { active: false } });
    expect(res.statusCode).toBe(200);
    expect(usuarios.find((u) => u.id === ALVO_A)?.active).toBe(false);
  });

  it('rename: 200, nome muda', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}`, payload: { name: 'Fulana' } });
    expect(res.statusCode).toBe(200);
    expect(usuarios.find((u) => u.id === ALVO_A)?.name).toBe('Fulana');
  });

  it('delete: 200, usuário removido (sem atividade)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${ALVO_A}` });
    expect(res.statusCode).toBe(200);
    expect(usuarios.find((u) => u.id === ALVO_A)).toBeUndefined();
  });
});

/**
 * ADMIN AUDIT COMPLETENESS: as 4 mutações respondem WHO/WHAT/WHICH
 * USER/WHICH ORGANIZATION/old/new, em colunas próprias de audit_logs — não
 * só `metadata` solta. `rename` e `delete` não gravavam NENHUM audit_log
 * antes desta correção.
 */
describe('audit completeness — as 4 mutações respondem quem/o quê/sobre quem/em qual empresa/antes/depois', () => {
  it('role: audit_log com resourceType/resourceId/organizationId/old/new', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}/role`, payload: { role: 'master' } });

    const log = auditRows.find((r) => r.action === 'user.role_changed');
    expect(log).toMatchObject({
      userId: MASTER_A,
      organizationId: ORG_A,
      resourceType: 'user',
      resourceId: ALVO_A,
      oldValue: { role: 'colaborador' },
      newValue: { role: 'master' },
    });
  });

  it('status: audit_log com old/new corretos', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}/status`, payload: { active: false } });

    const log = auditRows.find((r) => r.action === 'user.deactivated');
    expect(log).toMatchObject({
      resourceType: 'user',
      resourceId: ALVO_A,
      oldValue: { active: true },
      newValue: { active: false },
    });
  });

  it('rename: ganha audit_log (antes não gravava NENHUM)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}`, payload: { name: 'Fulana' } });

    const log = auditRows.find((r) => r.action === 'user.renamed');
    expect(log).toMatchObject({
      resourceType: 'user',
      resourceId: ALVO_A,
      oldValue: { name: expect.any(String) },
      newValue: { name: 'Fulana' },
    });
  });

  it('delete: ganha audit_log da própria exclusão (antes só LIA audit_logs como checagem prévia)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'DELETE', url: `/admin/users/${ALVO_A}` });

    const log = auditRows.find((r) => r.action === 'user.deleted');
    expect(log).toMatchObject({
      resourceType: 'user',
      resourceId: ALVO_A,
      newValue: null,
    });
    expect((log?.oldValue as { email?: string })?.email).toBeTruthy();
  });
});

describe('multi-org: alvo pertence a A e B, caller trabalha em A', () => {
  for (const rota of ROTAS_DE_MUTACAO) {
    it(`${rota.nome}: permitido — o vínculo com a empresa ativa (A) já basta`, async () => {
      const app = await buildApp();
      const res = await rota.chamar(app, ALVO_MULTI);
      expect(res.statusCode).toBe(200);
    });
  }

  it('caller muda de empresa ativa para B: continua permitido, porque o alvo também é membro de B', async () => {
    currentTenantOrgId = ORG_B;
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_MULTI}/status`, payload: { active: false } });
    expect(res.statusCode).toBe(200);
  });
});

describe('a correção de tenant não substitui RBAC', () => {
  it('caller sem users:write continua bloqueado (403), mesmo sobre usuário da própria empresa', async () => {
    currentUser = { ...currentUser, permissions: [] };
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}/status`, payload: { active: false } });
    expect(res.statusCode).toBe(403);
  });
});

describe('caller sem empresa de trabalho resolvida', () => {
  it('404 em vez de vazar (requireTenant recusa antes de qualquer checagem de alvo)', async () => {
    currentTenantOrgId = null;
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/admin/users/${ALVO_A}/status`, payload: { active: false } });
    // `requireTenant` responde 403 "Organization membership required" antes
    // de `userBelongsToTenant` ser chamado — não é 404, é a recusa correta de
    // quem não tem onde trabalhar (sem vínculo nenhum), caso diferente de
    // "empresa errada".
    expect(res.statusCode).toBe(403);
  });
});

/**
 * SÓ ADMINISTRADOR CRIA CONTA (07/10/2026).
 *
 * A regra anterior era `users:write` sozinho — uma LINHA na tabela
 * `permissions`. Um seed antigo, ou uma correção apressada num ambiente, e o
 * papel colaborador passa a fabricar acesso novo ao sistema inteiro sem que
 * nenhuma linha de código tenha mudado. Por isso o teste do caso negativo
 * concede `users:write` de propósito: é exatamente a configuração em que a
 * permissão sozinha deixaria passar.
 */
describe('POST /admin/invite — criar usuário é privilégio de administrador', () => {
  it('colaborador COM users:write: 403, o papel é a segunda porta', async () => {
    currentUser = { id: MASTER_A, roles: ['colaborador'], permissions: [{ resource: 'users', action: 'write' }] };
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/invite',
      payload: { email: 'nova@pessoa.com', role: 'colaborador' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('sem users:write: 403 pela permissão, antes mesmo do papel', async () => {
    currentUser = { id: MASTER_A, roles: ['master'], permissions: [] };
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/invite',
      payload: { email: 'nova@pessoa.com', role: 'colaborador' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('users:write');
  });

  /**
   * O master PASSA pelas duas portas. Para aquele dia-a-dia de chegar aqui com
   * o Supabase sem configurar, a rota recusa com 500 — e é esse 500, e não um
   * 403, que prova que nem a permissão nem o papel barraram a chamada.
   */
  it('master passa pelos dois gates (recusa seguinte não é mais de autorização)', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/invite',
      payload: { email: 'nova@pessoa.com', role: 'colaborador' },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('master sem empresa de trabalho resolvida: recusa antes de criar gente solta', async () => {
    currentTenantOrgId = null;
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/invite',
      payload: { email: 'nova@pessoa.com', role: 'colaborador' },
    });

    expect(res.statusCode).toBe(403);
  });
});
