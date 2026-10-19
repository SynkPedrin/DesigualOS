import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * BRIEF + VERSIONING + BRIEF->TASK (P1-E/F/G, 06/10/2026). Trava:
 *   - versão nova NUNCA apaga a anterior;
 *   - approve-version só aceita versão do PRÓPRIO brief;
 *   - send-to-production usa o TaskProvider (nunca ClickUp direto) e exige
 *     versão aprovada;
 *   - draft a partir de demanda sem conversa -> erro claro, não inventa.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const JAMILLE = '44444444-4444-4444-8444-444444444444';
const CLIENTE_A = '33333333-3333-4333-8333-333333333333';
const DEMAND_A = '99999999-9999-4999-8999-999999999999';

interface BriefRow {
  id: string;
  organizationId: string;
  clientId: string;
  demandId: string;
  conversationThreadId: string | null;
  createdBy: string;
  approvedVersionId: string | null;
  status: string;
  externalTaskId: string | null;
  externalTaskProvider: string | null;
}
interface VersionRow {
  id: string;
  briefId: string;
  version: number;
  content: Record<string, unknown>;
  source: string;
  sourceEvidence: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
}

let briefs: BriefRow[];
let versions: VersionRow[];
let demandsRows: Array<{ id: string; organizationId: string; clientId: string; conversationThreadId: string | null; status: string }>;
let threadMessagesRows: Array<{ id: string; threadId: string; content: string | null; direction: string }>;
let clientsRows: Array<{ id: string; clickupListId: string | null }>;
let proximoId = 0;
let mockCreateTask: ReturnType<typeof vi.fn>;
let mockResolveTaskProvider: ReturnType<typeof vi.fn>;

let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let currentTenantOrgId: string | null;

/** IDs de teste precisam ter formato de uuid de verdade — as rotas validam
 *  `z.string().uuid()` nos params, mesmo em mock. */
function uuidDeTeste(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

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
  const briefsTable = {
    id: 'b.id', organizationId: 'b.organization_id', clientId: 'b.client_id', demandId: 'b.demand_id',
    conversationThreadId: 'b.conversation_thread_id', createdBy: 'b.created_by', approvedVersionId: 'b.approved_version_id',
    status: 'b.status', externalTaskId: 'b.external_task_id', externalTaskProvider: 'b.external_task_provider',
  };
  const briefVersionsTable = { id: 'bv.id', briefId: 'bv.brief_id', version: 'bv.version', content: 'bv.content', source: 'bv.source', sourceEvidence: 'bv.source_evidence', createdBy: 'bv.created_by', createdAt: 'bv.created_at' };
  const demandsTable = { id: 'd.id', organizationId: 'd.organization_id', clientId: 'd.client_id', conversationThreadId: 'd.conversation_thread_id', status: 'd.status' };
  const threadMessagesTable = { id: 'tm.id', threadId: 'tm.thread_id', content: 'tm.content', direction: 'tm.direction' };
  const clientsTable = { id: 'clients.id', clickupListId: 'clients.clickup_list_id' };

  const thenableOrderBy = (linhas: unknown[]) => Object.assign(Promise.resolve(linhas), { orderBy: () => Promise.resolve(linhas) });

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (cond: unknown) => {
            const params = coletarParams(cond);
            if (table === briefsTable) {
              return thenableOrderBy(
                briefs.filter((b) => (params.includes(b.id) || params.includes(b.demandId)) && params.includes(b.organizationId)),
              );
            }
            if (table === briefVersionsTable) {
              const briefIds = params.filter((p) => briefs.some((b) => b.id === p));
              const versionIds = params.filter((p) => versions.some((v) => v.id === p));
              return thenableOrderBy(
                versions.filter((v) => (briefIds.length === 0 || briefIds.includes(v.briefId)) && (versionIds.length === 0 || versionIds.includes(v.id))),
              );
            }
            if (table === demandsTable) return Promise.resolve(demandsRows.filter((d) => params.includes(d.id) && params.includes(d.organizationId)));
            if (table === threadMessagesTable) return Promise.resolve(threadMessagesRows.filter((m) => params.includes(m.threadId)));
            if (table === clientsTable) return Promise.resolve(clientsRows.filter((c) => params.includes(c.id)));
            return thenableOrderBy([]);
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            if (table === briefsTable) {
              const row: BriefRow = {
                id: uuidDeTeste(++proximoId), organizationId: v.organizationId as string, clientId: v.clientId as string,
                demandId: v.demandId as string, conversationThreadId: (v.conversationThreadId as string) ?? null,
                createdBy: v.createdBy as string, approvedVersionId: null, status: 'draft', externalTaskId: null, externalTaskProvider: null,
              };
              briefs.push(row);
              return Promise.resolve([row]);
            }
            if (table === briefVersionsTable) {
              const row: VersionRow = {
                id: uuidDeTeste(++proximoId), briefId: v.briefId as string, version: v.version as number,
                content: v.content as Record<string, unknown>, source: v.source as string,
                sourceEvidence: (v.sourceEvidence as Record<string, unknown>) ?? null, createdBy: (v.createdBy as string) ?? null, createdAt: new Date(),
              };
              versions.push(row);
              return Promise.resolve([row]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            const params = coletarParams(cond);
            if (table === briefsTable) {
              const alvo = briefs.filter((b) => params.includes(b.id));
              for (const b of alvo) Object.assign(b, patch);
              return { returning: () => Promise.resolve(alvo.map((b) => ({ ...b }))) };
            }
            if (table === demandsTable) {
              const alvo = demandsRows.filter((d) => params.includes(d.id));
              for (const d of alvo) Object.assign(d, patch);
              return Promise.resolve(undefined);
            }
            return { returning: () => Promise.resolve([]) };
          },
        }),
      }),
    },
    schema: { briefs: briefsTable, briefVersions: briefVersionsTable, demands: demandsTable, threadMessages: threadMessagesTable, clients: clientsTable },
  };
});

vi.mock('@desigual-os/tool-gateway', () => ({
  resolveTaskProvider: (...args: unknown[]) => mockResolveTaskProvider(...args),
}));
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
vi.mock('../lib/auditoria', () => ({ auditarAcao: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../demands/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../demands/service')>();
  return actual;
});

const { registerBriefRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => void reply.code(error.name === 'ZodError' ? 400 : 500).send({ error: error.message }));
  await registerBriefRoutes(app);
  return app;
}

beforeEach(() => {
  proximoId = 0;
  currentUser = { id: JAMILLE, roles: ['colaborador'], permissions: [{ resource: 'briefs', action: 'read' }, { resource: 'briefs', action: 'write' }] };
  currentTenantOrgId = ORG_A;
  briefs = [];
  versions = [];
  demandsRows = [{ id: DEMAND_A, organizationId: ORG_A, clientId: CLIENTE_A, conversationThreadId: 'thread-1', status: 'briefing' }];
  threadMessagesRows = [
    { id: 'm1', threadId: 'thread-1', content: 'Precisamos de um carrossel pro Dia do Cliente', direction: 'inbound' },
    { id: 'm2', threadId: 'thread-1', content: 'Algo premium, sem urgência', direction: 'inbound' },
  ];
  clientsRows = [{ id: CLIENTE_A, clickupListId: 'list-123' }];
  mockCreateTask = vi.fn().mockResolvedValue({ id: 'clickup-task-1', title: 't', description: null, status: null, statusType: null, assignees: [], dueDate: null, updatedAt: null, url: null });
  mockResolveTaskProvider = vi.fn().mockResolvedValue({ provider: 'clickup', createTask: mockCreateTask });
});

describe('POST /briefs (manual) e versionamento', () => {
  it('cria o brief com versão 1', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: { objective: 'Divulgar o Dia do Cliente' } } });
    expect(res.statusCode).toBe(201);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, source: 'human_edit' });
  });

  it('nova versão NUNCA apaga a anterior', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: { objective: 'v1' } } });
    const briefId = created.json().id as string;

    await app.inject({ method: 'POST', url: `/briefs/${briefId}/versions`, payload: { content: { objective: 'v2' } } });

    expect(versions.filter((v) => v.briefId === briefId)).toHaveLength(2);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });
});

describe('GET /demands/:id/briefs — como o detalhe da demanda acha o brief dela', () => {
  it('lista os briefs da demanda, vazio quando nenhum foi criado ainda', async () => {
    const app = await buildApp();
    const vazio = await app.inject({ method: 'GET', url: `/demands/${DEMAND_A}/briefs` });
    expect(vazio.statusCode).toBe(200);
    expect(vazio.json().briefs).toEqual([]);

    await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: { objective: 'v1' } } });
    const comBrief = await app.inject({ method: 'GET', url: `/demands/${DEMAND_A}/briefs` });
    expect(comBrief.json().briefs).toHaveLength(1);
    expect(comBrief.json().briefs[0]).toMatchObject({ demand_id: DEMAND_A, status: 'draft' });
  });

  it('nunca devolve brief de outra demanda', async () => {
    const app = await buildApp();
    demandsRows.push({ id: uuidDeTeste(999), organizationId: ORG_A, clientId: CLIENTE_A, conversationThreadId: null, status: 'new' });
    await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: { objective: 'v1' } } });

    const outraDemanda = await app.inject({ method: 'GET', url: `/demands/${uuidDeTeste(999)}/briefs` });
    expect(outraDemanda.json().briefs).toEqual([]);
  });
});

describe('POST /demands/:id/draft-brief — P1-F, honesto sobre o que é', () => {
  it('monta rascunho a partir das mensagens recebidas, com evidência', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/demands/${DEMAND_A}/draft-brief` });

    expect(res.statusCode).toBe(201);
    const draft = res.json().draft_version;
    expect(draft.source).toBe('ai_draft');
    expect(draft.content.notes).toContain('carrossel');
    expect(draft.content.objective).toBeUndefined(); // nunca inventa campo estruturado
  });

  it('demanda sem conversa vinculada: erro claro, não inventa rascunho', async () => {
    demandsRows[0]!.conversationThreadId = null;
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/demands/${DEMAND_A}/draft-brief` });
    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /briefs/:id/approve-version', () => {
  it('aprova versão do PRÓPRIO brief', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: {} } });
    const briefId = created.json().id as string;
    const versionId = versions[0]!.id;

    const res = await app.inject({ method: 'PATCH', url: `/briefs/${briefId}/approve-version`, payload: { versionId } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'approved', approved_version_id: versionId });
  });

  it('versão de OUTRO brief: 404, não aprova por engano', async () => {
    const app = await buildApp();
    const b1 = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: {} } });
    const DEMAND_B = '88888888-8888-4888-8888-888888888888';
    demandsRows.push({ id: DEMAND_B, organizationId: ORG_A, clientId: CLIENTE_A, conversationThreadId: null, status: 'new' });
    const b2 = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_B, content: {} } });
    const versionDoB2 = versions.find((v) => v.briefId === b2.json().id)!.id;

    const res = await app.inject({ method: 'PATCH', url: `/briefs/${b1.json().id}/approve-version`, payload: { versionId: versionDoB2 } });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /briefs/:id/send-to-production', () => {
  it('sem versão aprovada: 409, nunca chama o provider', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: {} } });

    const res = await app.inject({ method: 'POST', url: `/briefs/${created.json().id}/send-to-production`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('com versão aprovada: cria task via TaskProvider (nunca ClickUp direto)', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'POST', url: '/briefs', payload: { demandId: DEMAND_A, content: { deliverable: 'Carrossel' } } });
    const briefId = created.json().id as string;
    await app.inject({ method: 'PATCH', url: `/briefs/${briefId}/approve-version`, payload: { versionId: versions[0]!.id } });

    const res = await app.inject({ method: 'POST', url: `/briefs/${briefId}/send-to-production`, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(mockResolveTaskProvider).toHaveBeenCalledWith(ORG_A);
    expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ listId: 'list-123', title: expect.stringContaining('Carrossel') }), { authorizedForProduction: true });
    expect(res.json()).toMatchObject({ status: 'sent_to_production', external_task_id: 'clickup-task-1' });
    expect(demandsRows[0]?.status).toBe('in_production');
  });
});
