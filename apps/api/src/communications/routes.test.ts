import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * INBOX (P1-A/C, 06/10/2026) — trava:
 *   - organização nunca vaza (thread de B não aparece/não é acessível pra A);
 *   - enviar mensagem sem WhatsApp conectado falha CLARO (409), mas a
 *     mensagem fica registrada (deliveryStatus='failed'), nunca silenciosa;
 *   - webhook idempotente (mesmo externalMessageId não duplica) e nunca
 *     processa payload com apikey que não confere com o conector gravado.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const JAMILLE = '44444444-4444-4444-8444-444444444444';
const THREAD_A = '33333333-3333-4333-8333-333333333333';
const THREAD_B = '77777777-7777-4777-8777-777777777777';
const CONTACT_A = '88888888-8888-4888-8888-888888888888';

interface ThreadRow {
  id: string;
  organizationId: string;
  clientId: string | null;
  contactId: string;
  channel: string;
  status: string;
  assignedToUserId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}
interface MessageRow {
  id: string;
  threadId: string;
  organizationId: string;
  channel: string;
  direction: string;
  senderContactId: string | null;
  senderUserId: string | null;
  content: string | null;
  attachmentUrl: string | null;
  externalMessageId: string | null;
  deliveryStatus: string;
  createdAt: Date;
}
interface ContactRow {
  id: string;
  organizationId: string;
  clientId: string | null;
  name: string;
  phone: string | null;
}
interface ConnectorRow {
  organizationId: string;
  provider: string;
  credentials: Record<string, unknown>;
  status: string;
}

let threads: ThreadRow[];
let messages: MessageRow[];
let contacts: ContactRow[];
let connectors: ConnectorRow[];
let proximoId = 0;

let currentUser: { id: string; roles: string[]; permissions: { resource: string; action: string }[] };
let currentTenantOrgId: string | null;

const mockResolveCommunicationProvider = vi.fn();
const mockRecordOperationalEvent = vi.fn();

vi.mock('@desigual-os/tool-gateway', () => ({
  resolveCommunicationProvider: (...args: unknown[]) => mockResolveCommunicationProvider(...args),
  ConnectorConfigError: class ConnectorConfigError extends Error {},
  parseEvolutionWebhookEvent: (raw: unknown) => {
    const body = raw as Record<string, unknown>;
    if (body?.event !== 'messages.upsert') return null;
    const data = body.data as Record<string, unknown>;
    const key = data?.key as Record<string, unknown>;
    return { event: 'messages.upsert', instance: body.instance, data: { key: { id: key.id, remoteJid: key.remoteJid, fromMe: Boolean(key.fromMe) }, message: data.message, messageTimestamp: data.messageTimestamp, pushName: data.pushName } };
  },
  phoneFromRemoteJid: (jid: string) => jid.split('@')[0],
}));

vi.mock('@desigual-os/orchestrator', () => ({ recordOperationalEvent: (...args: unknown[]) => mockRecordOperationalEvent(...args) }));
vi.mock('@desigual-os/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

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

const auditRows: Array<Record<string, unknown>> = [];
vi.mock('../lib/auditoria', () => ({
  auditarAcao: (_req: unknown, entrada: Record<string, unknown>) => {
    auditRows.push(entrada);
    return Promise.resolve();
  },
}));

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
  const conversationThreads = {
    id: 'ct.id', organizationId: 'ct.organization_id', clientId: 'ct.client_id', contactId: 'ct.contact_id',
    channel: 'ct.channel', status: 'ct.status', assignedToUserId: 'ct.assigned_to_user_id', lastMessageAt: 'ct.last_message_at', createdAt: 'ct.created_at',
  };
  const threadMessages = {
    id: 'tm.id', threadId: 'tm.thread_id', organizationId: 'tm.organization_id', channel: 'tm.channel', direction: 'tm.direction',
    senderContactId: 'tm.sender_contact_id', senderUserId: 'tm.sender_user_id', content: 'tm.content', attachmentUrl: 'tm.attachment_url',
    externalMessageId: 'tm.external_message_id', deliveryStatus: 'tm.delivery_status', createdAt: 'tm.created_at',
  };
  const contactsTable = { id: 'c.id', organizationId: 'c.organization_id', clientId: 'c.client_id', name: 'c.name', phone: 'c.phone' };
  const clients = { id: 'clients.id', name: 'clients.name' };
  const organizationConnectors = { organizationId: 'oc.organization_id', provider: 'oc.provider', credentials: 'oc.credentials', status: 'oc.status' };

  function filtrarThreads(cond: unknown): ThreadRow[] {
    const params = coletarParams(cond);
    const orgIds = params.filter((p) => [ORG_A, ORG_B].includes(p));
    const threadIds = params.filter((p) => threads.some((t) => t.id === p));
    const userIds = params.filter((p) => p === JAMILLE);
    return threads.filter(
      (t) =>
        (orgIds.length === 0 || orgIds.includes(t.organizationId)) &&
        (threadIds.length === 0 || threadIds.includes(t.id)) &&
        (userIds.length === 0 || t.assignedToUserId === userIds[0] || params.includes('IS_NULL_ASSIGNED')),
    );
  }

  const comPaginacao = (linhas: unknown[]) =>
    Object.assign(Promise.resolve(linhas), { orderBy: () => Object.assign(Promise.resolve(linhas), { limit: () => Object.assign(Promise.resolve(linhas), { offset: () => Promise.resolve(linhas) }) }) });

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: (joinTable: unknown) => ({
            leftJoin: () => ({
              where: (cond: unknown) => comPaginacao(filtrarThreads(cond).map((t) => ({
                id: t.id, organizationId: t.organizationId, clientId: t.clientId, clientName: null,
                contactId: t.contactId, contactName: contacts.find((c) => c.id === t.contactId)?.name ?? '',
                contactPhone: contacts.find((c) => c.id === t.contactId)?.phone ?? null,
                channel: t.channel, status: t.status, assignedToUserId: t.assignedToUserId, lastMessageAt: t.lastMessageAt,
              }))),
            }),
            where: (cond: unknown) => {
              if (table === threadMessages) {
                const params = coletarParams(cond);
                const linhas = messages.filter((m) => params.includes(m.channel) || params.includes(m.externalMessageId ?? '__none__'));
                return comPaginacao(linhas);
              }
              return comPaginacao([]);
            },
          }),
          where: (cond: unknown) => {
            if (table === threadMessages) {
              const params = coletarParams(cond);
              const threadIds = params.filter((p) => threads.some((t) => t.id === p));
              const linhas = messages.filter((m) => threadIds.length === 0 || threadIds.includes(m.threadId));
              return comPaginacao(linhas);
            }
            if (table === contactsTable) {
              const params = coletarParams(cond);
              return Promise.resolve(contacts.filter((c) => params.includes(c.organizationId) && params.includes(c.phone ?? '__none__')));
            }
            if (table === organizationConnectors) {
              const params = coletarParams(cond);
              return Promise.resolve(connectors.filter((c) => params.includes('whatsapp') ? c.provider === 'whatsapp' : true).filter((c) => params.includes('ativa') ? c.status === 'ativa' : true));
            }
            if (table === conversationThreads) {
              const params = coletarParams(cond);
              const linhas = threads.filter((t) => params.includes(t.organizationId) && params.includes(t.contactId) && params.includes(t.channel));
              return comPaginacao(linhas);
            }
            return Promise.resolve([]);
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (table === contactsTable) {
            const row: ContactRow = { id: `contact-${++proximoId}`, organizationId: v.organizationId as string, clientId: (v.clientId as string) ?? null, name: v.name as string, phone: (v.phone as string) ?? null };
            contacts.push(row);
            return { returning: () => Promise.resolve([row]) };
          }
          if (table === conversationThreads) {
            const row: ThreadRow = {
              id: `thread-${++proximoId}`, organizationId: v.organizationId as string, clientId: (v.clientId as string) ?? null,
              contactId: v.contactId as string, channel: v.channel as string, status: (v.status as string) ?? 'open',
              assignedToUserId: null, lastMessageAt: null, createdAt: new Date(),
            };
            threads.push(row);
            return { returning: () => Promise.resolve([row]) };
          }
          if (table === threadMessages) {
            const row: MessageRow = {
              id: `msg-${++proximoId}`, threadId: v.threadId as string, organizationId: v.organizationId as string,
              channel: v.channel as string, direction: v.direction as string, senderContactId: (v.senderContactId as string) ?? null,
              senderUserId: (v.senderUserId as string) ?? null, content: (v.content as string) ?? null, attachmentUrl: null,
              externalMessageId: (v.externalMessageId as string) ?? null, deliveryStatus: v.deliveryStatus as string,
              createdAt: (v.createdAt as Date) ?? new Date(),
            };
            const duplicado = row.externalMessageId && messages.some((m) => m.channel === row.channel && m.externalMessageId === row.externalMessageId);
            return {
              onConflictDoNothing: () => {
                if (!duplicado) messages.push(row);
                return { returning: () => Promise.resolve(duplicado ? [] : [row]) };
              },
              returning: () => {
                messages.push(row);
                return Promise.resolve([row]);
              },
            };
          }
          return { returning: () => Promise.resolve([]) };
        },
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            if (table === conversationThreads) {
              const params = coletarParams(cond);
              const alvo = threads.filter((t) => params.includes(t.id));
              for (const t of alvo) Object.assign(t, patch);
              return { returning: () => Promise.resolve(alvo.map((t) => ({ ...t }))) };
            }
            return { returning: () => Promise.resolve([]) };
          },
        }),
      }),
    },
    schema: { conversationThreads, threadMessages, contacts: contactsTable, clients, organizationConnectors },
  };
});

const { registerCommunicationRoutes } = await import('./routes');

async function buildApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    void reply.code(500).send({ error: error.message, stack: error.stack });
  });
  await registerCommunicationRoutes(app);
  return app;
}

beforeEach(() => {
  auditRows.length = 0;
  mockResolveCommunicationProvider.mockReset();
  mockRecordOperationalEvent.mockReset().mockResolvedValue({ status: 'recorded', eventId: 'e1' });
  currentUser = { id: JAMILLE, roles: ['colaborador'], permissions: [{ resource: 'communications', action: 'read' }, { resource: 'communications', action: 'write' }] };
  currentTenantOrgId = ORG_A;

  contacts = [{ id: CONTACT_A, organizationId: ORG_A, clientId: null, name: 'Maria Cliente', phone: '5511999998888' }];
  threads = [
    { id: THREAD_A, organizationId: ORG_A, clientId: null, contactId: CONTACT_A, channel: 'whatsapp', status: 'open', assignedToUserId: null, lastMessageAt: null, createdAt: new Date() },
    { id: THREAD_B, organizationId: ORG_B, clientId: null, contactId: CONTACT_A, channel: 'whatsapp', status: 'open', assignedToUserId: null, lastMessageAt: null, createdAt: new Date() },
  ];
  messages = [];
  connectors = [];
  proximoId = 0;
});

describe('GET /inbox/threads/:id — cross-tenant', () => {
  it('thread da própria empresa: 200', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/inbox/threads/${THREAD_A}` });
    expect(res.statusCode).toBe(200);
  });

  it('thread de OUTRA empresa: 404, nunca 200 com dado de outro tenant', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/inbox/threads/${THREAD_B}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /inbox/threads/:id/messages', () => {
  it('WhatsApp não conectado: 409, mas a mensagem fica registrada como failed', async () => {
    mockResolveCommunicationProvider.mockResolvedValue(null);
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/inbox/threads/${THREAD_A}/messages`, payload: { text: 'Oi, tudo bem?' } });

    expect(res.statusCode).toBe(409);
    const gravada = messages.find((m) => m.threadId === THREAD_A);
    expect(gravada).toMatchObject({ content: 'Oi, tudo bem?', deliveryStatus: 'failed', direction: 'outbound' });
  });

  it('WhatsApp conectado: envia, grava delivered=sent com o id externo', async () => {
    mockResolveCommunicationProvider.mockResolvedValue({ provider: 'whatsapp', sendMessage: vi.fn().mockResolvedValue({ externalMessageId: 'wa-msg-1' }), health: vi.fn() });
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: `/inbox/threads/${THREAD_A}/messages`, payload: { text: 'Oi!' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ delivery_status: 'sent' });
    expect(threads.find((t) => t.id === THREAD_A)?.status).toBe('waiting_client');
  });

  it('não pode mandar mensagem numa thread de outra empresa', async () => {
    mockResolveCommunicationProvider.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/inbox/threads/${THREAD_B}/messages`, payload: { text: 'oi' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /inbox/threads/:id/assign', () => {
  it('atribui e audita', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `/inbox/threads/${THREAD_A}/assign`, payload: { userId: JAMILLE } });

    expect(res.statusCode).toBe(200);
    expect(threads.find((t) => t.id === THREAD_A)?.assignedToUserId).toBe(JAMILLE);
    expect(auditRows.find((r) => r.action === 'conversation.assigned')).toBeTruthy();
  });
});

describe('POST /webhooks/whatsapp', () => {
  function evento(keyOverrides: Record<string, unknown> = {}) {
    return {
      event: 'messages.upsert',
      instance: 'desigual-cosentino',
      apikey: 'chave-certa',
      data: {
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'wa-ext-1', ...keyOverrides },
        message: { conversation: 'Preciso de um orçamento' },
        messageTimestamp: 1_700_000_000,
        pushName: 'Maria Cliente',
      },
    };
  }

  beforeEach(() => {
    connectors = [{ organizationId: ORG_A, provider: 'whatsapp', credentials: { instance: 'desigual-cosentino', apiKey: 'chave-certa', baseUrl: 'https://evo.com' }, status: 'ativa' }];
  });

  it('mensagem nova: cria contato+thread+mensagem', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: evento() });

    expect(res.statusCode).toBe(200);
    expect(messages.some((m) => m.externalMessageId === 'wa-ext-1' && m.direction === 'inbound')).toBe(true);
  });

  it('IDEMPOTENTE: mesmo externalMessageId não duplica em retry', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: evento() });
    await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: evento() });

    expect(messages.filter((m) => m.externalMessageId === 'wa-ext-1')).toHaveLength(1);
  });

  it('apikey que não confere com o conector: ignorado, nada gravado', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: { ...evento(), apikey: 'chave-errada' } });

    expect(res.statusCode).toBe(200);
    expect(messages).toHaveLength(0);
  });

  it('fromMe=true (mandado pelo próprio WhatsApp conectado): ignorado', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: evento({ fromMe: true }) });

    expect(res.statusCode).toBe(200);
    expect(messages).toHaveLength(0);
  });

  it('instância desconhecida (nenhum conector): ignorado, não derruba', async () => {
    connectors = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: evento() });

    expect(res.statusCode).toBe(200);
    expect(messages).toHaveLength(0);
  });
});
