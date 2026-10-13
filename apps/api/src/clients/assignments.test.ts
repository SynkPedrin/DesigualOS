import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * CLIENT ASSIGNMENT (P0-C, 06/10/2026): responsabilidade operacional
 * (account/traffic/design/...) de um membro sobre um cliente — distinta do
 * `role` de acesso ao workspace (viewer/editor, rota /clients/:id/access,
 * sem teste próprio ainda). Trava as 3 rotas novas:
 *
 *   GET  /clients/:id/assignments        — responsáveis por cliente
 *   PUT  /clients/:id/assignments        — atribuir (idempotente)
 *   DELETE /clients/:id/assignments      — remover
 *   GET  /team/members/:id/assignments   — clientes de um colaborador
 *
 * Fastify real, banco mockado em memória (mesmo padrão de admin/routes.test.ts).
 */

let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let currentTenantOrgId: string | null;
let clientPertenceAoTenant: boolean;

interface ClientUserRow {
  id: string;
  clientId: string;
  userId: string;
  role: string;
  responsibility: string | null;
}
interface UsuarioRow {
  id: string;
  name: string;
  email: string;
}
interface MembroRow {
  userId: string;
  organizationId: string;
}
interface ClienteRow {
  id: string;
  name: string;
  organizationId: string;
  deletedAt: Date | null;
}

let clientUsersRows: ClientUserRow[];
let usuarios: UsuarioRow[];
let membros: MembroRow[];
let clientes: ClienteRow[];
let auditRows: Array<Record<string, unknown>>;
let eventRows: Array<Record<string, unknown>>;
let proximoId = 0;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CLIENTE_A = '33333333-3333-4333-8333-333333333333';
const JAMILLE = '44444444-4444-4444-8444-444444444444';
const ALICIA = '55555555-5555-4555-8555-555555555555';
const FORA_DA_ORG = '66666666-6666-4666-8666-666666666666';

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
  const users = { id: 'users.id', name: 'users.name', email: 'users.email' };
  const organizationMembers = { userId: 'om.user_id', organizationId: 'om.organization_id' };
  const clients = { id: 'clients.id', name: 'clients.name', organizationId: 'clients.organization_id', deletedAt: 'clients.deleted_at' };
  const clientUsers = {
    id: 'cu.id',
    clientId: 'cu.client_id',
    userId: 'cu.user_id',
    role: 'cu.role',
    responsibility: 'cu.responsibility',
  };

  function filtrar(table: unknown, cond: unknown): unknown[] {
    const params = coletarParams(cond);
    if (table === users) return usuarios.filter((u) => params.includes(u.id));
    if (table === organizationMembers) {
      const orgIds = params.filter((p) => [ORG_A, ORG_B].includes(p));
      const userIds = params.filter((p) => usuarios.some((u) => u.id === p));
      return membros.filter(
        (m) => (orgIds.length === 0 || orgIds.includes(m.organizationId)) && (userIds.length === 0 || userIds.includes(m.userId)),
      );
    }
    if (table === clients) return clientes.filter((c) => params.includes(c.id));
    if (table === clientUsers) {
      const clientIds = params.filter((p) => clientes.some((c) => c.id === p));
      const userIds = params.filter((p) => usuarios.some((u) => u.id === p));
      const responsibilities = params.filter((p) => !clientIds.includes(p) && !userIds.includes(p) && p !== 'null');
      return clientUsersRows.filter(
        (r) =>
          (clientIds.length === 0 || clientIds.includes(r.clientId)) &&
          (userIds.length === 0 || userIds.includes(r.userId)) &&
          (responsibilities.length === 0 || (r.responsibility !== null && responsibilities.includes(r.responsibility))),
      );
    }
    return [];
  }

  /** Join de 2 tabelas — só os dois usados pelas rotas de assignment. */
  function juntar(table: unknown, joinTable: unknown, cond: unknown): unknown[] {
    const params = coletarParams(cond);
    if (table === clientUsers && joinTable === users) {
      const clientIds = params.filter((p) => clientes.some((c) => c.id === p));
      return clientUsersRows
        .filter((r) => r.responsibility !== null && (clientIds.length === 0 || clientIds.includes(r.clientId)))
        .map((r) => ({
          userId: r.userId,
          userName: usuarios.find((u) => u.id === r.userId)?.name,
          userEmail: usuarios.find((u) => u.id === r.userId)?.email,
          responsibility: r.responsibility,
        }));
    }
    if (table === users && joinTable === organizationMembers) {
      const userIds = params.filter((p) => usuarios.some((u) => u.id === p));
      const orgIds = params.filter((p) => [ORG_A, ORG_B].includes(p));
      return membros.filter((m) => (userIds.length === 0 || userIds.includes(m.userId)) && (orgIds.length === 0 || orgIds.includes(m.organizationId)));
    }
    return [];
  }

  const thenableComOrderBy = (linhas: unknown[]) => Object.assign(Promise.resolve(linhas), { orderBy: () => Promise.resolve(linhas) });

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: (joinTable: unknown) => ({
            where: (cond: unknown) => thenableComOrderBy(juntar(table, joinTable, cond)),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table !== clientUsers) return Promise.resolve(undefined);
          const row: ClientUserRow = {
            id: `cu-${++proximoId}`,
            clientId: v.clientId as string,
            userId: v.userId as string,
            role: (v.role as string) ?? 'viewer',
            responsibility: (v.responsibility as string | undefined) ?? null,
          };
          return {
            onConflictDoNothing: () => {
              const existe = clientUsersRows.some(
                (r) => r.clientId === row.clientId && r.userId === row.userId && r.responsibility === row.responsibility,
              );
              if (!existe) clientUsersRows.push(row);
              return Promise.resolve(undefined);
            },
            onConflictDoUpdate: () => Promise.resolve(undefined),
          };
        },
      }),
      delete: (table: unknown) => ({
        where: (cond: unknown) => ({
          returning: () => {
            if (table !== clientUsers) return Promise.resolve([]);
            const alvo = filtrar(clientUsers, cond) as ClientUserRow[];
            clientUsersRows = clientUsersRows.filter((r) => !alvo.includes(r));
            return Promise.resolve(alvo.map((r) => ({ id: r.id })));
          },
        }),
      }),
    },
    schema: { users, organizationMembers, clients, clientUsers, notifications: { id: 'notif.id' } },
  };
});

vi.mock('@desigual-os/context-engine', () => ({ naturezaDoCliente: vi.fn() }));
vi.mock('@desigual-os/tool-gateway', () => ({ getTaskComments: vi.fn(), getTasksInList: vi.fn(), getTasksInListPaged: vi.fn() }));
vi.mock('@desigual-os/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const mockRecordOperationalEvent = vi.fn();
vi.mock('@desigual-os/orchestrator', () => ({ recordOperationalEvent: (...args: unknown[]) => mockRecordOperationalEvent(...args) }));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
  requirePermission: (resource: string, action: string) => async (request: { authUser?: typeof currentUser }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const ok = (request.authUser?.permissions ?? []).some((p) => p.resource === resource && p.action === action);
    if (!ok) reply.code(403).send({ error: `Missing permission ${resource}:${action}` });
  },
}));

vi.mock('../lib/access', () => ({ hasClientAccess: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/auditoria', () => ({ auditarAcao: vi.fn((_req: unknown, entrada: Record<string, unknown>) => { auditRows.push(entrada); return Promise.resolve(); }) }));
vi.mock('../integrations/access', () => ({ resolveClickUpAccess: vi.fn() }));

vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { tenantContext?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    if (currentTenantOrgId === null) {
      reply.code(403).send({ error: 'Organization membership required' });
      return;
    }
    request.tenantContext = { organizationId: currentTenantOrgId };
  },
  clientBelongsToTenant: async () => clientPertenceAoTenant,
}));

const { registerClientRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') {
      void reply.code(400).send({ error: (error as unknown as { issues: Array<{ message: string }> }).issues.map((i) => i.message).join(' ') });
      return;
    }
    void reply.code(500).send({ error: error.message, stack: error.stack });
  });
  await registerClientRoutes(app);
  return app;
}

function usuario(id: string, name: string): UsuarioRow {
  return { id, name, email: `${name.toLowerCase()}@desigual.com` };
}

beforeEach(() => {
  proximoId = 0;
  auditRows = [];
  eventRows = [];
  mockRecordOperationalEvent.mockReset().mockImplementation((e: Record<string, unknown>) => {
    eventRows.push(e);
    return Promise.resolve({ status: 'recorded', eventId: 'evt-1' });
  });

  currentUser = { id: JAMILLE, roles: ['colaborador'], permissions: [{ resource: 'clients', action: 'read' }, { resource: 'clients', action: 'write' }] };
  currentTenantOrgId = ORG_A;
  clientPertenceAoTenant = true;

  usuarios = [usuario(JAMILLE, 'Jamille'), usuario(ALICIA, 'Alicia'), usuario(FORA_DA_ORG, 'Fora')];
  membros = [
    { userId: JAMILLE, organizationId: ORG_A },
    { userId: ALICIA, organizationId: ORG_A },
    { userId: FORA_DA_ORG, organizationId: ORG_B },
  ];
  clientes = [{ id: CLIENTE_A, name: 'Cosentino', organizationId: ORG_A, deletedAt: null }];
  clientUsersRows = [];
});

describe('PUT /clients/:id/assignments', () => {
  it('atribui responsabilidade a um membro da mesma empresa', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/clients/${CLIENTE_A}/assignments`,
      payload: { userId: ALICIA, responsibility: 'traffic' },
    });

    expect(res.statusCode).toBe(201);
    expect(clientUsersRows).toContainEqual(expect.objectContaining({ clientId: CLIENTE_A, userId: ALICIA, responsibility: 'traffic' }));
  });

  it('idempotente: chamar de novo com o MESMO par não duplica linha', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });

    expect(clientUsersRows.filter((r) => r.userId === ALICIA && r.responsibility === 'traffic')).toHaveLength(1);
  });

  it('suporta MÚLTIPLAS responsabilidades da MESMA pessoa no MESMO cliente', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'manager' } });

    const deAlicia = clientUsersRows.filter((r) => r.userId === ALICIA);
    expect(deAlicia.map((r) => r.responsibility).sort()).toEqual(['manager', 'traffic']);
  });

  it('suporta MÚLTIPLAS pessoas na MESMA responsabilidade', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'design' } });
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: JAMILLE, responsibility: 'design' } });

    expect(clientUsersRows.filter((r) => r.responsibility === 'design')).toHaveLength(2);
  });

  it('CROSS-TENANT: não atribui responsabilidade a alguém de OUTRA empresa', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/clients/${CLIENTE_A}/assignments`,
      payload: { userId: FORA_DA_ORG, responsibility: 'design' },
    });

    expect(res.statusCode).toBe(404);
    expect(clientUsersRows).toHaveLength(0);
  });

  it('CROSS-TENANT: cliente de outra empresa (clientBelongsToTenant=false) -> 404 antes de qualquer coisa', async () => {
    clientPertenceAoTenant = false;
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/clients/${CLIENTE_A}/assignments`,
      payload: { userId: ALICIA, responsibility: 'design' },
    });

    expect(res.statusCode).toBe(404);
    expect(clientUsersRows).toHaveLength(0);
  });

  it('responsabilidade inválida (fora do enum) -> 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/clients/${CLIENTE_A}/assignments`,
      payload: { userId: ALICIA, responsibility: 'astrologia' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('grava audit_log e operational_event', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });

    expect(auditRows.find((r) => r.action === 'client.assignment_set')).toMatchObject({
      resourceType: 'client',
      resourceId: CLIENTE_A,
      newValue: { userId: ALICIA, responsibility: 'traffic' },
    });
    expect(eventRows.find((e) => e.type === 'client.assignment_set')).toMatchObject({ organizationId: ORG_A, clientId: CLIENTE_A });
  });
});

describe('DELETE /clients/:id/assignments', () => {
  it('remove uma responsabilidade específica, preservando as outras', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });
    await app.inject({ method: 'PUT', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'manager' } });

    const res = await app.inject({ method: 'DELETE', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });

    expect(res.statusCode).toBe(200);
    expect(clientUsersRows.map((r) => r.responsibility)).toEqual(['manager']);
  });

  it('remoção inexistente -> 404', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/clients/${CLIENTE_A}/assignments`, payload: { userId: ALICIA, responsibility: 'traffic' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /clients/:id/assignments, responsáveis por cliente', () => {
  it('lista todas as responsabilidades do cliente, nunca a linha de ACESSO (responsibility null)', async () => {
    clientUsersRows.push({ id: 'cu-acesso', clientId: CLIENTE_A, userId: JAMILLE, role: 'editor', responsibility: null });
    clientUsersRows.push({ id: 'cu-1', clientId: CLIENTE_A, userId: ALICIA, role: 'viewer', responsibility: 'traffic' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/clients/${CLIENTE_A}/assignments` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { assignments: Array<{ user_id: string; responsibility: string }> };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0]).toMatchObject({ user_id: ALICIA, responsibility: 'traffic' });
  });
});

// GET /team/members/:id/assignments vive em team/routes.ts (módulo e
// dependências diferentes — recorteDePessoasVisiveis, não tenant-context) —
// testado em team/routes.test.ts, não aqui.
