import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * "Nova conversa" e "Chamada de vídeo" da Inbox (30/10/2026) — trava:
 *   - número que o WhatsApp diz não existir não vira conversa;
 *   - WhatsApp sem responder não é tratado como "número não existe" nem abre conversa às cegas;
 *   - sem o WhatsApp da própria pessoa conectado, nada é criado;
 *   - a chamada de vídeo só devolve link quando a Microsoft gerou um link do Teams.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const PESSOA = '44444444-4444-4444-8444-444444444444';
const THREAD = '33333333-3333-4333-8333-333333333333';

let sessoes: Array<Record<string, unknown>>;
const checkNumber = vi.fn();
const abrirConversa = vi.fn();
const resolveAccess = vi.fn();
const listCalendars = vi.fn();
const createEvent = vi.fn();
const getThread = vi.fn();
const auditRows: Array<Record<string, unknown>> = [];

class OpenwaError extends Error {
  constructor(message: string, readonly status: number | null) { super(message); }
}

vi.mock('@desigual-os/tool-gateway', () => ({
  OpenwaError,
  abrirConversaComNumero: (...args: unknown[]) => abrirConversa(...args),
  senderForWhatsappSession: () => ({ checkNumber }),
  resolveMicrosoftCalendarAccess: (...args: unknown[]) => resolveAccess(...args),
  listMicrosoftCalendars: (...args: unknown[]) => listCalendars(...args),
  createMicrosoftCalendarEvent: (...args: unknown[]) => createEvent(...args),
  parseEvolutionWebhookEvent: () => null,
  phoneFromRemoteJid: (jid: string) => jid.split('@')[0],
  WHATSAPP_MEDIA_MAX_BYTES: 1,
}));
vi.mock('@desigual-os/database', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(sessoes) }) }) }) },
  schema: { whatsappSessions: { organizationId: 'ws.org', ownerUserId: 'ws.owner', status: 'ws.status' } },
}));
vi.mock('./service', () => ({ getThread: (...args: unknown[]) => getThread(...args) }));
vi.mock('./openwa-send', () => ({ pessoasMarcaveis: vi.fn(), sendMediaFast: vi.fn(), sendTextFast: vi.fn() }));
vi.mock('@desigual-os/logging', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => { request.authUser = { id: PESSOA }; },
  requirePermission: () => async () => {},
}));
vi.mock('../auth/require-module', () => ({ requireModule: () => async () => {} }));
vi.mock('../lib/tenant-context', () => ({
  requireTenant: async (request: { tenantContext?: unknown }) => { request.tenantContext = { organizationId: ORG }; },
  clientBelongsToTenant: async () => true,
}));
vi.mock('../lib/auditoria', () => ({ auditarAcao: (_r: unknown, e: Record<string, unknown>) => { auditRows.push(e); return Promise.resolve(); } }));

const { registerCommunicationRoutes } = await import('./routes');

async function app() {
  const a = Fastify();
  await registerCommunicationRoutes(a);
  return a;
}

const threadDoBanco = {
  id: THREAD, clientId: null, clientName: null, contactId: 'c1', contactName: 'Maria', contactPhone: '5518996326160', contactMetadata: null,
  whatsappSessionId: 's1', groupId: null, externalChatId: '5518996326160@c.us', kind: 'individual', title: 'Maria', unreadCount: 0,
  lastMessagePreview: null, groupName: null, groupAvatarUrl: null, channel: 'whatsapp', status: 'waiting_agency', assignedToUserId: null, lastMessageAt: null,
};

beforeEach(() => {
  sessoes = [{ id: 's1', organizationId: ORG, ownerUserId: PESSOA, status: 'ready' }];
  auditRows.length = 0;
  for (const f of [checkNumber, abrirConversa, resolveAccess, listCalendars, createEvent, getThread]) f.mockReset();
  abrirConversa.mockResolvedValue({ id: THREAD });
  getThread.mockResolvedValue(threadDoBanco);
});

describe('POST /inbox/threads — nova conversa', () => {
  it('confere o número no WhatsApp e abre a conversa pelo id que ele devolveu', async () => {
    checkNumber.mockResolvedValue({ exists: true, whatsappId: '5518996326160@s.whatsapp.net' });
    const res = await (await app()).inject({ method: 'POST', url: '/inbox/threads', payload: { phone: '(18) 99632-6160' } });
    expect(res.statusCode).toBe(201);
    expect(checkNumber).toHaveBeenCalledWith('5518996326160');
    expect(abrirConversa).toHaveBeenCalledWith(sessoes[0], { chatId: '5518996326160@s.whatsapp.net', phone: '5518996326160' });
    expect(res.json()).toMatchObject({ id: THREAD, contact_phone: '5518996326160' });
    expect(auditRows[0]).toMatchObject({ action: 'conversation.started' });
  });

  it('número sem WhatsApp não vira conversa', async () => {
    checkNumber.mockResolvedValue({ exists: false, whatsappId: null });
    const res = await (await app()).inject({ method: 'POST', url: '/inbox/threads', payload: { phone: '18 99632-6160' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('não tem WhatsApp');
    expect(abrirConversa).not.toHaveBeenCalled();
  });

  it('WhatsApp sem responder é 503, não "não existe", e não abre nada', async () => {
    checkNumber.mockRejectedValue(new OpenwaError('WhatsApp did not answer', 503));
    const res = await (await app()).inject({ method: 'POST', url: '/inbox/threads', payload: { phone: '18 99632-6160' } });
    expect(res.statusCode).toBe(503);
    expect(abrirConversa).not.toHaveBeenCalled();
  });

  it('motor sem a rota de consulta (404) segue pelo número', async () => {
    checkNumber.mockRejectedValue(new OpenwaError('Not Found', 404));
    const res = await (await app()).inject({ method: 'POST', url: '/inbox/threads', payload: { phone: '18 99632-6160' } });
    expect(res.statusCode).toBe(201);
    expect(abrirConversa).toHaveBeenCalledWith(sessoes[0], { chatId: '5518996326160@c.us', phone: '5518996326160' });
  });

  it('sem o WhatsApp da pessoa conectado, 409 e nada criado', async () => {
    sessoes = [];
    const res = await (await app()).inject({ method: 'POST', url: '/inbox/threads', payload: { phone: '18 99632-6160' } });
    expect(res.statusCode).toBe(409);
    expect(checkNumber).not.toHaveBeenCalled();
    expect(abrirConversa).not.toHaveBeenCalled();
  });

  it('número sem DDD é 400 antes de perguntar ao WhatsApp', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/inbox/threads', payload: { phone: '99632-6160' } });
    expect(res.statusCode).toBe(400);
    expect(checkNumber).not.toHaveBeenCalled();
  });
});

describe('POST /inbox/threads/:id/video-call — chamada de vídeo', () => {
  it('cria a reunião do Teams na agenda padrão e devolve o link', async () => {
    resolveAccess.mockResolvedValue({ accessToken: 'tok' });
    listCalendars.mockResolvedValue([{ id: 'outra', isDefault: false, canEdit: true }, { id: 'padrao', isDefault: true, canEdit: true }]);
    createEvent.mockResolvedValue({ id: 'e1', webLink: 'https://outlook/e1', meetingUrl: 'https://teams.microsoft.com/l/meetup-join/x' });
    const res = await (await app()).inject({ method: 'POST', url: `/inbox/threads/${THREAD}/video-call` });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ join_url: 'https://teams.microsoft.com/l/meetup-join/x', web_link: 'https://outlook/e1' });
    expect(createEvent).toHaveBeenCalledWith('tok', 'padrao', expect.objectContaining({ subject: 'Chamada com Maria', requestTeamsMeeting: true, timezone: 'UTC' }));
  });

  it('sem agenda Microsoft conectada, 409 e nada criado', async () => {
    resolveAccess.mockResolvedValue(null);
    const res = await (await app()).inject({ method: 'POST', url: `/inbox/threads/${THREAD}/video-call` });
    expect(res.statusCode).toBe(409);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('conta sem Teams: avisa e entrega o link do evento, sem fingir que há chamada', async () => {
    resolveAccess.mockResolvedValue({ accessToken: 'tok' });
    listCalendars.mockResolvedValue([{ id: 'padrao', isDefault: true, canEdit: true }]);
    createEvent.mockResolvedValue({ id: 'e1', webLink: 'https://outlook/e1', meetingUrl: null });
    const res = await (await app()).inject({ method: 'POST', url: `/inbox/threads/${THREAD}/video-call` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ web_link: 'https://outlook/e1' });
    expect(res.json().join_url).toBeUndefined();
  });

  it('conversa de outra pessoa ou inexistente é 404', async () => {
    getThread.mockResolvedValue(null);
    const res = await (await app()).inject({ method: 'POST', url: `/inbox/threads/${THREAD}/video-call` });
    expect(res.statusCode).toBe(404);
    expect(resolveAccess).not.toHaveBeenCalled();
  });
});
