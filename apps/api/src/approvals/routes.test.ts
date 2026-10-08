import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * APPROVAL ENGINE (P1-I, 06/10/2026) — genérico por resourceType/resourceId.
 * Trava: resolução ATÔMICA (dois aprovadores simultâneos, só um vence) e
 * isolamento de organização.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const JAMILLE = '44444444-4444-4444-8444-444444444444';
const TAMMY = '55555555-5555-4555-8555-555555555555';

interface ApprovalRow {
  id: string;
  organizationId: string;
  clientId: string | null;
  resourceType: string;
  resourceId: string;
  version: string | null;
  requestedBy: string;
  approverId: string | null;
  status: string;
  comment: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

let approvals: ApprovalRow[];
let proximoId = 0;
let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let currentTenantOrgId: string | null;

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
  const approvalRequests = {
    id: 'ar.id', organizationId: 'ar.organization_id', clientId: 'ar.client_id', resourceType: 'ar.resource_type',
    resourceId: 'ar.resource_id', version: 'ar.version', requestedBy: 'ar.requested_by', approverId: 'ar.approver_id',
    status: 'ar.status', comment: 'ar.comment', createdAt: 'ar.created_at', resolvedAt: 'ar.resolved_at',
  };

  const thenableOrderBy = (linhas: unknown[]) =>
    Object.assign(Promise.resolve(linhas), { orderBy: () => Object.assign(Promise.resolve(linhas), { limit: () => Object.assign(Promise.resolve(linhas), { offset: () => Promise.resolve(linhas) }) }) });

  return {
    db: {
      select: () => ({
        from: () => ({
          where: (cond: unknown) => {
            const params = coletarParams(cond);
            // IS NULL (resolvedAt) não aparece em coletarParams (sem valor literal) —
            // distinguimos "resolução" (chamado via update) de "leitura simples" pelo
            // número de ids de organização presentes; aqui cobrimos ambos os usos com
            // o mesmo filtro por id/organizationId, suficiente para os testes abaixo.
            return thenableOrderBy(approvals.filter((a) => params.includes(a.id) && params.includes(a.organizationId)));
          },
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            const row: ApprovalRow = {
              id: `approval-${++proximoId}`,
              organizationId: v.organizationId as string,
              clientId: (v.clientId as string) ?? null,
              resourceType: v.resourceType as string,
              resourceId: v.resourceId as string,
              version: (v.version as string) ?? null,
              requestedBy: v.requestedBy as string,
              approverId: null,
              status: 'pending',
              comment: null,
              createdAt: new Date(),
              resolvedAt: null,
            };
            approvals.push(row);
            return Promise.resolve([row]);
          },
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: () => {
              const params = coletarParams(cond);
              // Resolução atômica: só pega quem AINDA está resolvedAt=null.
              const alvo = approvals.filter((a) => params.includes(a.id) && params.includes(a.organizationId) && a.resolvedAt === null);
              for (const a of alvo) Object.assign(a, patch);
              return Promise.resolve(alvo.map((a) => ({ ...a })));
            },
          }),
        }),
      }),
    },
    schema: { approvalRequests },
  };
});

vi.mock('@desigual-os/orchestrator', () => ({ recordOperationalEvent: vi.fn().mockResolvedValue({ status: 'recorded' }) }));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = currentUser;
  },
  requirePermission: (resource: string, action: string) => async (request: { authUser?: typeof currentUser }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const ok = (request.authUser?.permissions ?? []).some((p) => p.resource === resource && p.action === action);
    if (!ok) reply.code(403).send({ error: `Missing permission ${resource}:${action}` });
  },
}));

vi.mock('../auth/require-module', () => ({
  requireModule: () => async () => {},
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

const { registerApprovalRequestRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  await registerApprovalRequestRoutes(app);
  return app;
}

beforeEach(() => {
  proximoId = 0;
  currentUser = { id: JAMILLE, roles: ['colaborador'], permissions: [{ resource: 'approvals', action: 'read' }, { resource: 'approvals', action: 'write' }] };
  currentTenantOrgId = ORG_A;
  approvals = [];
});

describe('POST /approvals', () => {
  it('cria pedido pendente', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/approvals', payload: { resourceType: 'brief', resourceId: 'brief-1' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending', resource_type: 'brief', resource_id: 'brief-1' });
  });
});

describe('PATCH /approvals/:id — resolução atômica', () => {
  it('aprova uma vez com sucesso', async () => {
    approvals = [{ id: 'approval-1', organizationId: ORG_A, clientId: null, resourceType: 'brief', resourceId: 'b1', version: null, requestedBy: JAMILLE, approverId: null, status: 'pending', comment: null, createdAt: new Date(), resolvedAt: null }];
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/approvals/approval-1', payload: { status: 'approved' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'approved', approver_id: JAMILLE });
  });

  it('DOIS APROVADORES SIMULTÂNEOS: só o primeiro vence, o segundo recebe 409', async () => {
    approvals = [{ id: 'approval-1', organizationId: ORG_A, clientId: null, resourceType: 'brief', resourceId: 'b1', version: null, requestedBy: JAMILLE, approverId: null, status: 'pending', comment: null, createdAt: new Date(), resolvedAt: null }];
    const app = await buildApp();

    const [primeira, segunda] = await Promise.all([
      app.inject({ method: 'PATCH', url: '/approvals/approval-1', payload: { status: 'approved' } }),
      app.inject({ method: 'PATCH', url: '/approvals/approval-1', payload: { status: 'rejected' } }),
    ]);

    const statuses = [primeira.statusCode, segunda.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    // O estado final é o de QUEM GANHOU a corrida — nunca os dois aplicados.
    expect(['approved', 'rejected']).toContain(approvals[0]?.status);
  });

  it('já resolvida: 409, estado não muda de novo', async () => {
    approvals = [{ id: 'approval-1', organizationId: ORG_A, clientId: null, resourceType: 'brief', resourceId: 'b1', version: null, requestedBy: JAMILLE, approverId: TAMMY, status: 'approved', comment: null, createdAt: new Date(), resolvedAt: new Date() }];
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/approvals/approval-1', payload: { status: 'rejected' } });

    expect(res.statusCode).toBe(409);
    expect(approvals[0]?.status).toBe('approved');
  });

  it('não encontrada: 404', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/approvals/inexistente', payload: { status: 'approved' } });
    expect(res.statusCode).toBe(404);
  });

  it('CROSS-TENANT: aprovação de outra empresa -> 404, não resolve', async () => {
    approvals = [{ id: 'approval-b', organizationId: ORG_B, clientId: null, resourceType: 'brief', resourceId: 'b1', version: null, requestedBy: JAMILLE, approverId: null, status: 'pending', comment: null, createdAt: new Date(), resolvedAt: null }];
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/approvals/approval-b', payload: { status: 'approved' } });

    expect(res.statusCode).toBe(404);
    expect(approvals[0]?.status).toBe('pending');
  });
});
