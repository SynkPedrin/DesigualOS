import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const SESSION = '66666666-6666-4666-8666-666666666666';
const EXTERNAL = '77777777-7777-4777-8777-777777777777';

let currentUser = { id: USER, roles: ['colaborador'] };
let sessions: Array<Record<string, unknown>> = [];
let jobs: Array<Record<string, unknown>> = [];
let snapshotStatus = 'qr_ready';

const admin = {
  createSession: vi.fn(async (name: string) => ({ id: EXTERNAL, name, status: 'created', phone: null, pushName: null, connectedAt: null, lastActive: null, lastError: null, engineLoaded: false })),
  createScopedOperatorKey: vi.fn(async () => ({ id: 'key-1', apiKey: 'owa_k1_scoped' })),
};
const gateway = {
  createWebhook: vi.fn(async () => ({ id: 'hook-1' })),
  requestStart: vi.fn(async () => 'starting' as const),
  getSession: vi.fn(async () => ({ id: EXTERNAL, name: 'session', status: snapshotStatus, phone: '5511999999999', pushName: 'Operação', connectedAt: null, lastActive: null, lastError: null, engineLoaded: true })),
  getQr: vi.fn(async () => ({ qrCode: 'data:image/png;base64,real-provider-payload', status: 'qr_ready' })),
  logoutSession: vi.fn(),
};
const enqueueSync = vi.fn(async (..._args: unknown[]) => undefined);
const enqueueWebhook = vi.fn(async (..._args: unknown[]) => undefined);
const registerEvent = vi.fn();

vi.mock('@desigual-os/tool-gateway', () => ({
  OpenwaGatewayError: class OpenwaGatewayError extends Error {
    constructor(message: string, readonly status: number | null, readonly code: string | null = null, readonly retryable = false) { super(message); }
  },
  openwaAdminClient: () => admin,
  gatewayForWhatsappSession: () => gateway,
  encryptToken: (value: string) => `encrypted:${value}`,
  createWhatsappSyncJob: vi.fn(async () => ({ id: 'job-1', created: true })),
  recoverWhatsappWebhookEvent: vi.fn(async () => undefined),
  registerOpenwaWebhookEvent: (...args: unknown[]) => registerEvent(...args),
  whatsappSessionForOwner: vi.fn(async (input: { id: string; organizationId: string; ownerUserId: string; canManageOthers?: boolean }) => {
    const session = sessions.find((row) => row.id === input.id && row.organizationId === input.organizationId);
    if (!session || (!input.canManageOthers && session.ownerUserId !== input.ownerUserId)) return null;
    return session;
  }),
}));
vi.mock('@desigual-os/orchestrator', () => ({
  enqueueWhatsappSync: (...args: unknown[]) => enqueueSync(...args),
  enqueueWhatsappWebhook: (...args: unknown[]) => enqueueWebhook(...args),
  retryWhatsappSync: vi.fn(async () => undefined),
  retryWhatsappWebhook: vi.fn(async () => undefined),
}));
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => { request.authUser = currentUser; },
  requirePermission: () => async () => undefined,
}));
vi.mock('../auth/require-module', () => ({ requireModule: () => async () => undefined }));
vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { tenantContext?: unknown }) => { request.tenantContext = { organizationId: ORG }; },
}));
vi.mock('../lib/auditoria', () => ({ auditarAcao: vi.fn(async () => undefined) }));

function params(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  if (Array.isArray(value)) value.forEach((item) => params(item, found));
  if (value && typeof value === 'object') {
    if ('value' in value) params((value as { value: unknown }).value, found);
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) chunks.forEach((item) => params(item, found));
  }
  return found;
}

function paged(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    orderBy: () => Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows.slice(0, 1)) }),
    limit: () => Promise.resolve(rows.slice(0, 1)),
  });
}

vi.mock('@desigual-os/database', () => {
  const whatsappSessions = { id: 'ws.id', organizationId: 'ws.organization_id', ownerUserId: 'ws.owner_user_id', provider: 'ws.provider' };
  const whatsappSyncJobs = { id: 'job.id', sessionId: 'job.session_id', createdAt: 'job.created_at', status: 'job.status' };
  const conversationThreads = { id: 'ct.id', contactId: 'ct.contact_id', whatsappSessionId: 'ct.whatsapp_session_id' };
  const threadMessages = { whatsappSessionId: 'tm.whatsapp_session_id' };
  const whatsappWebhookEvents = { id: 'event.id', sessionId: 'event.session_id', createdAt: 'event.created_at' };
  const contacts = { organizationId: 'c.organization_id', externalIds: 'c.external_ids' };
  return {
    schema: { whatsappSessions, whatsappSyncJobs, conversationThreads, threadMessages, whatsappWebhookEvents, contacts },
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            const values = params(condition);
            if (table === conversationThreads) return Promise.resolve([{ threads: 0, contacts: 0 }]);
            if (table === contacts) return Promise.resolve([{ contacts: 0 }]);
            if (table === threadMessages) return Promise.resolve([{ messages: 0 }]);
            if (table === whatsappSyncJobs) return paged(jobs.filter((job) => values.length === 0 || values.includes(String(job.sessionId))));
            return paged(sessions.filter((session) => values.length === 0 || values.includes(String(session.id)) || values.includes(String(session.organizationId)) || values.includes(String(session.ownerUserId))));
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (value: Record<string, unknown>) => ({
          returning: async () => {
            if (table === whatsappSessions) {
              const row = { id: SESSION, ...value, lastSeenAt: null, lastSyncAt: null, connectedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date() };
              sessions.push(row);
              return [row];
            }
            return [];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (condition: unknown) => ({
            returning: async () => {
              const values = params(condition);
              const rows = table === whatsappSessions ? sessions : jobs;
              const updated = rows.filter((row) => values.includes(String(row.id))).map((row) => ({ ...row, ...patch }));
              for (const row of updated) Object.assign(rows.find((candidate) => candidate.id === row.id)!, patch);
              return updated;
            },
          }),
        }),
      }),
    },
  };
});

const { registerOpenwaRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  await registerOpenwaRoutes(app);
  return app;
}

beforeEach(() => {
  currentUser = { id: USER, roles: ['colaborador'] };
  sessions = [];
  jobs = [];
  snapshotStatus = 'qr_ready';
  vi.clearAllMocks();
  process.env.API_PUBLIC_URL = 'https://api.example.com';
  process.env.OPENWA_BASE_URL = 'http://openwa.local';
  process.env.OPENWA_ADMIN_API_KEY = 'admin-key';
  delete process.env.WHATSAPP_OPENWA_ENABLED;
});

describe('sessões OpenWA', () => {
  it('cria sessão, chave escopada e webhook sem iniciar sync dentro do HTTP', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/openwa/sessions' });
    expect(response.statusCode).toBe(202);
    expect(admin.createScopedOperatorKey).toHaveBeenCalledWith(expect.any(String), EXTERNAL);
    expect(gateway.createWebhook).toHaveBeenCalledWith({ url: 'https://api.example.com/openwa/webhook', secret: expect.any(String) });
    expect(gateway.requestStart).toHaveBeenCalled();
    expect(enqueueSync).not.toHaveBeenCalled();
    expect(sessions[0]).toMatchObject({ organizationId: ORG, ownerUserId: USER, externalSessionId: EXTERNAL });
  });

  it('retorna o QR real do provider, nunca um QR gerado pelo Desigual OS', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/openwa/sessions' });
    const response = await app.inject({ method: 'GET', url: `/openwa/sessions/${SESSION}/qr` });
    expect(response.statusCode).toBe(200);
    expect(response.json().qr_code).toBe('data:image/png;base64,real-provider-payload');
  });

  it('bloqueia acesso à sessão de outro colaborador', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/openwa/sessions' });
    currentUser = { id: OTHER, roles: ['colaborador'] };
    const response = await app.inject({ method: 'GET', url: `/openwa/sessions/${SESSION}/qr` });
    expect(response.statusCode).toBe(404);
    expect(gateway.getQr).not.toHaveBeenCalled();
  });

  it('dispara sincronização inicial ao observar ready, fora da conexão HTTP', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/openwa/sessions' });
    snapshotStatus = 'ready';
    const response = await app.inject({ method: 'GET', url: `/openwa/sessions/${SESSION}` });
    expect(response.statusCode).toBe(200);
    expect(enqueueSync).toHaveBeenCalledWith('job-1');
  });
});

describe('webhook OpenWA', () => {
  const envelope = { event: 'message.received', timestamp: '2026-10-16T12:00:00.000Z', sessionId: EXTERNAL, idempotencyKey: 'msg_1', data: { id: 'message-1' } };

  it('aceita payload assinado, persiste e enfileira uma única vez', async () => {
    registerEvent.mockResolvedValue({ id: 'event-1', created: true });
    const app = await buildApp();
    const raw = JSON.stringify(envelope);
    const response = await app.inject({ method: 'POST', url: '/openwa/webhook', headers: { 'content-type': 'application/json', 'x-openwa-signature': 'valid' }, payload: raw });
    expect(response.statusCode).toBe(200);
    expect(registerEvent).toHaveBeenCalledWith(expect.objectContaining({ rawBody: raw, signature: 'valid', externalSessionId: EXTERNAL }));
    expect(enqueueWebhook).toHaveBeenCalledWith('event-1');
  });

  it('não enfileira entrega duplicada', async () => {
    registerEvent.mockResolvedValue({ id: 'event-1', created: false });
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/openwa/webhook', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(envelope) });
    expect(response.json().duplicate).toBe(true);
    expect(enqueueWebhook).not.toHaveBeenCalled();
  });

  it('recusa assinatura inválida', async () => {
    registerEvent.mockRejectedValue(new Error('INVALID_OPENWA_SIGNATURE'));
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/openwa/webhook', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(envelope) });
    expect(response.statusCode).toBe(401);
    expect(enqueueWebhook).not.toHaveBeenCalled();
  });
});
