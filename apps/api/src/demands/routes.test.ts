import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * DEMAND (P1-D, 06/10/2026) — "o cliente pediu algo". Trava:
 *   - organização nunca vaza;
 *   - ownerId resolvido por client_users.responsibility='account' (P0-C),
 *     nunca um palpite quando ninguém tem essa responsabilidade;
 *   - cliente de outra empresa -> 404, nada criado.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const JAMILLE = '44444444-4444-4444-8444-444444444444';
const ALICIA = '55555555-5555-4555-8555-555555555555';
const CLIENTE_A = '33333333-3333-4333-8333-333333333333';
const CLIENTE_B = '77777777-7777-4777-8777-777777777777';

interface DemandRow {
  id: string;
  organizationId: string;
  clientId: string;
  ownerId: string | null;
  title: string;
  description: string | null;
  source: string;
  status: string;
  priority: string;
  requestedAt: Date;
  dueDate: Date | null;
}

let demands: DemandRow[];
let clientUsersRows: Array<{ clientId: string; userId: string; responsibility: string | null }>;
let hasAccess: boolean;
let proximoId = 0;
const mockRecordOperationalEvent = vi.fn();

let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let currentTenantOrgId: string | null;
let moduleEnabled: boolean;

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
  const demandsTable = {
    id: 'd.id', organizationId: 'd.organization_id', clientId: 'd.client_id', ownerId: 'd.owner_id',
    title: 'd.title', description: 'd.description', source: 'd.source', status: 'd.status',
    priority: 'd.priority', requestedAt: 'd.requested_at', dueDate: 'd.due_date',
  };
  const clients = { id: 'clients.id', name: 'clients.name' };
  const clientUsers = { clientId: 'cu.client_id', userId: 'cu.user_id', responsibility: 'cu.responsibility' };

  const thenableOrderBy = (linhas: unknown[]) =>
    Object.assign(Promise.resolve(linhas), { orderBy: () => Object.assign(Promise.resolve(linhas), { limit: () => Object.assign(Promise.resolve(linhas), { offset: () => Promise.resolve(linhas) }) }) });

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (cond: unknown) => {
            if (table === clientUsers) {
              const params = coletarParams(cond);
              const linhas = clientUsersRows.filter((r) => params.includes(r.clientId) && (r.responsibility === null || params.includes(r.responsibility)));
              return Object.assign(Promise.resolve(linhas), { limit: () => Promise.resolve(linhas.slice(0, 1)) });
            }
            if (table === demandsTable) {
              const params = coletarParams(cond);
              return thenableOrderBy(demands.filter((d) => params.includes(d.id) && params.includes(d.organizationId)));
            }
            return thenableOrderBy([]);
          },
          innerJoin: () => ({
            where: (cond: unknown) => {
              const params = coletarParams(cond);
              return thenableOrderBy(
                demands
                  .filter((d) => params.includes(d.organizationId))
                  .map((d) => ({ ...d, clientName: 'Cosentino' })),
              );
            },
          }),
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            const row: DemandRow = {
              id: `demand-${++proximoId}`,
              organizationId: v.organizationId as string,
              clientId: v.clientId as string,
              ownerId: (v.ownerId as string) ?? null,
              title: v.title as string,
              description: (v.description as string) ?? null,
              source: v.source as string,
              status: 'new',
              priority: (v.priority as string) ?? 'normal',
              requestedAt: new Date(),
              dueDate: (v.dueDate as Date) ?? null,
            };
            demands.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: () => {
              const params = coletarParams(cond);
              const alvo = demands.filter((d) => params.includes(d.id));
              for (const d of alvo) Object.assign(d, patch);
              return Promise.resolve(alvo.map((d) => ({ ...d })));
            },
          }),
        }),
      }),
    },
    schema: { demands: demandsTable, clients, clientUsers },
  };
});

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

// Workspace Builder (§79, 06/10/2026): requireModule é outra pergunta
// ("o workspace desta pessoa inclui este módulo?"). Simulado de verdade
// (não um no-op) pra provar o 403 — `moduleEnabled` começa true em todo
// teste, então só o teste dedicado abaixo precisa desligá-lo.
vi.mock('../auth/require-module', () => ({
  requireModule: (moduleName: string) => async (_request: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    if (!moduleEnabled) reply.code(403).send({ error: `O módulo '${moduleName}' não está habilitado no seu workspace.` });
  },
}));

vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { tenantContext?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    if (currentTenantOrgId === null) {
      reply.code(403).send({ error: 'Organization membership required' });
      return;
    }
    request.tenantContext = { organizationId: currentTenantOrgId };
  },
}));

vi.mock('../lib/access', () => ({ hasClientAccess: async () => hasAccess }));
vi.mock('../lib/auditoria', () => ({ auditarAcao: vi.fn().mockResolvedValue(undefined) }));

const { registerDemandRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') {
      void reply.code(400).send({ error: 'validation' });
      return;
    }
    void reply.code(500).send({ error: error.message });
  });
  await registerDemandRoutes(app);
  return app;
}

beforeEach(() => {
  proximoId = 0;
  mockRecordOperationalEvent.mockReset().mockResolvedValue({ status: 'recorded' });
  currentUser = { id: JAMILLE, roles: ['colaborador'], permissions: [{ resource: 'demands', action: 'read' }, { resource: 'demands', action: 'write' }] };
  currentTenantOrgId = ORG_A;
  hasAccess = true;
  moduleEnabled = true;
  demands = [];
  clientUsersRows = [{ clientId: CLIENTE_A, userId: ALICIA, responsibility: 'account' }];
});

describe('Workspace Builder — módulo desabilitado nunca basta esconder o menu', () => {
  it('"demandas" desabilitado no workspace -> 403, nunca a API aceitando mesmo assim', async () => {
    moduleEnabled = false;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/demands' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /demands', () => {
  it('cria a demanda e resolve ownerId pela responsabilidade account', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/demands', payload: { clientId: CLIENTE_A, title: 'Campanha de outubro', source: 'manual' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ owner_id: ALICIA, status: 'new', source: 'manual' });
  });

  it('sem ninguém com responsabilidade account: ownerId null, nunca um palpite', async () => {
    clientUsersRows = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/demands', payload: { clientId: CLIENTE_A, title: 'Campanha', source: 'manual' } });

    expect(res.json()).toMatchObject({ owner_id: null });
  });

  it('cliente sem acesso: 404, nada criado', async () => {
    hasAccess = false;
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/demands', payload: { clientId: CLIENTE_B, title: 'x', source: 'manual' } });

    expect(res.statusCode).toBe(404);
    expect(demands).toHaveLength(0);
  });

  it('grava evento operacional', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/demands', payload: { clientId: CLIENTE_A, title: 'x', source: 'manual' } });
    expect(mockRecordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'demand.created', organizationId: ORG_A }));
  });
});

describe('GET /demands/:id — cross-tenant', () => {
  it('demanda de outra empresa: 404', async () => {
    demands = [{ id: 'demand-x', organizationId: ORG_B, clientId: CLIENTE_B, ownerId: null, title: 't', description: null, source: 'manual', status: 'new', priority: 'normal', requestedAt: new Date(), dueDate: null }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/demands/demand-x' });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /demands/:id/status', () => {
  it('muda o status', async () => {
    demands = [{ id: 'demand-1', organizationId: ORG_A, clientId: CLIENTE_A, ownerId: ALICIA, title: 't', description: null, source: 'manual', status: 'new', priority: 'normal', requestedAt: new Date(), dueDate: null }];
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/demands/demand-1/status', payload: { status: 'briefing' } });

    expect(res.statusCode).toBe(200);
    expect(demands[0]?.status).toBe('briefing');
  });

  it('grava evento operacional com quem mudou, pra aparecer na atividade da campanha', async () => {
    demands = [{ id: 'demand-1', organizationId: ORG_A, clientId: CLIENTE_A, ownerId: ALICIA, title: 't', description: null, source: 'manual', status: 'new', priority: 'normal', requestedAt: new Date(), dueDate: null }];
    const app = await buildApp();
    await app.inject({ method: 'PATCH', url: '/demands/demand-1/status', payload: { status: 'done' } });

    expect(mockRecordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'demand.status_changed', userId: JAMILLE, entityType: 'demand', entityId: 'demand-1' }),
    );
  });
});
