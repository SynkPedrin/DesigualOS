import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, schema } from '@desigual-os/database';
import { createWhatsappSyncJob, persistOpenwaMessage, processOpenwaSyncJob } from './openwa-sync';
import { normalizeOpenwaMessage } from './openwa-gateway';
import { encryptToken } from './token-crypto';
import type { WhatsappSessionRow } from './openwa-session-store';

/**
 * O job de sincronização inteiro contra Postgres real e um OpenWA falso
 * (fetch simulado). Roda só com OPENWA_TEST_DATABASE_URL — banco descartável,
 * nunca o de produção.
 */
const enabled = Boolean(process.env.OPENWA_TEST_DATABASE_URL);
const organizationId = randomUUID();
const userId = randomUUID();
let session: WhatsappSessionRow;

const PESSOA = '5511911112222@c.us';
const LID = '99887766554433@lid';
const GRUPO = '120363111111111111@g.us';
const PICTURE = 'https://pps.whatsapp.net/v/foto-pessoa.jpg';

function msg(chatId: string, id: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return { id, chatId, from: chatId, to: 'eu@c.us', body: `texto ${id}`, type: 'chat', timestamp, fromMe: false, isGroup: chatId.endsWith('@g.us'), kind: chatId.endsWith('@g.us') ? 'group' : 'individual', ...extra };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function fakeOpenwa(url: string): Response {
  const path = new URL(url).pathname + new URL(url).search;
  if (path.includes('/chats')) {
    return json([
      { id: PESSOA, name: 'Cliente Pessoa', kind: 'individual', isGroup: false, unreadCount: 2, timestamp: 300 },
      { id: GRUPO, name: 'Grupo da Campanha', kind: 'group', isGroup: true, unreadCount: 0, timestamp: 400 },
      { id: LID, name: null, kind: 'individual', isGroup: false, unreadCount: 0, timestamp: 100, lastMessage: 'oi, sem histórico' },
      { id: 'status@broadcast', name: 'Status', kind: 'status', isGroup: false, unreadCount: 0, timestamp: 500 },
    ]);
  }
  if (path.includes(`/groups/`)) return json({ id: GRUPO, name: 'Grupo da Campanha', participants: [{ id: '5511933334444@c.us' }] });
  if (path.includes(`/messages/${encodeURIComponent(PESSOA)}/history`)) {
    return json([msg(PESSOA, 'p1', 290), msg(PESSOA, 'p2', 300, { fromMe: true, direction: 'outgoing' })]);
  }
  if (path.includes(`/messages/${encodeURIComponent(GRUPO)}/history`)) {
    return json([
      msg(GRUPO, 'g1', 390, { author: '5511933334444@c.us', contact: { pushName: 'Ana' } }),
      msg(GRUPO, 'g2', 400, { author: '5511933334444@c.us', contact: { pushName: 'Ana' } }),
    ]);
  }
  if (path.includes('/sem-midia/media')) return new Response(JSON.stringify({ message: 'No media stored for this message' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  if (path.includes('/history')) return json([]);
  if (path.includes('/contacts/profile-pictures')) return json({ pictures: { [PESSOA]: PICTURE, [GRUPO]: 'https://pps.whatsapp.net/v/grupo.jpg', [LID]: null } });
  if (path.includes('/contacts')) {
    return json([
      { id: PESSOA, name: 'Cliente Pessoa', number: '5511911112222', isMyContact: true },
      { id: '5511955556666@c.us', name: 'Fornecedor Salvo', number: '5511955556666', isMyContact: true },
      { id: '5511977778888@c.us', name: null, pushName: 'Desconhecido', number: '5511977778888', isMyContact: false },
    ]);
  }
  return new Response('{}', { status: 404 });
}

beforeAll(async () => {
  if (!enabled) return;
  process.env.OPENWA_BASE_URL = 'http://openwa.fake';
  process.env.NODE_SECRET ??= 'segredo-de-teste-openwa';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => fakeOpenwa(url)));
  await db.insert(schema.organizations).values({ id: organizationId, name: 'QA Sync', slug: `qa-sync-${organizationId}` });
  await db.insert(schema.users).values({ id: userId, email: `qa-sync-${userId}@example.com`, name: 'QA Sync' });
  const [created] = await db.insert(schema.whatsappSessions).values({
    organizationId, ownerUserId: userId, provider: 'openwa', externalSessionId: randomUUID(), externalName: 'qa-sync',
    apiKeyEncrypted: encryptToken('owa_scoped'), webhookSecretEncrypted: encryptToken('segredo'), status: 'ready',
  }).returning();
  session = created!;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (!enabled) return;
  await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
});

async function runSync() {
  const job = await createWhatsappSyncJob(session, null);
  await processOpenwaSyncJob(job.id);
  const [row] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, job.id));
  return row!;
}

describe('job de sincronização OpenWA em Postgres real', () => {
  it('importa conversas, histórico em lote, fotos e só a agenda salva', async () => {
    if (!enabled) return;
    const job = await runSync();
    expect(job.failures).toEqual([]);
    expect(job.status).toBe('completed');
    expect(job.processedChats).toBe(3);
    expect(job.processedMessages).toBe(4);

    const threads = await db.select().from(schema.conversationThreads).where(eq(schema.conversationThreads.whatsappSessionId, session.id));
    expect(threads.map((t) => t.externalChatId).sort()).toEqual([GRUPO, LID, PESSOA].sort());

    const pessoa = threads.find((t) => t.externalChatId === PESSOA)!;
    expect(pessoa.title).toBe('Cliente Pessoa');
    expect(pessoa.unreadCount).toBe(2);
    expect(pessoa.lastMessageAt?.toISOString()).toBe(new Date(300_000).toISOString());
    expect(pessoa.status).toBe('waiting_client');

    const grupo = threads.find((t) => t.externalChatId === GRUPO)!;
    expect(grupo.title).toBe('Grupo da Campanha');
    const [grupoRow] = await db.select().from(schema.whatsappGroups).where(eq(schema.whatsappGroups.id, grupo.groupId!));
    expect(grupoRow!.avatarUrl).toBe('https://pps.whatsapp.net/v/grupo.jpg');
    const groupMessages = await db.select().from(schema.threadMessages).where(eq(schema.threadMessages.threadId, grupo.id));
    expect(new Set(groupMessages.map((m) => m.senderContactId)).size).toBe(1);

    const lid = threads.find((t) => t.externalChatId === LID)!;
    expect(lid.lastMessagePreview).toBe('oi, sem histórico');
    expect(lid.lastMessageAt?.toISOString()).toBe(new Date(100_000).toISOString());

    const [contatoPessoa] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, pessoa.contactId!));
    expect(contatoPessoa!.metadata.profilePicUrl).toBe(PICTURE);

    const contatos = await db.select({ phone: schema.contacts.phone }).from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId));
    const phones = contatos.map((c) => c.phone);
    expect(phones).toContain('5511955556666');
    expect(phones).not.toContain('5511977778888');
  });

  it('reexecutar não duplica nada', async () => {
    if (!enabled) return;
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(schema.threadMessages).where(eq(schema.threadMessages.whatsappSessionId, session.id));
    const job = await runSync();
    expect(job.processedMessages).toBe(0);
    expect(job.duplicateMessages).toBe(4);
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(schema.threadMessages).where(eq(schema.threadMessages.whatsappSessionId, session.id));
    expect(after[0]!.n).toBe(before[0]!.n);
    const threads = await db.select().from(schema.conversationThreads).where(and(eq(schema.conversationThreads.organizationId, organizationId), eq(schema.conversationThreads.whatsappSessionId, session.id)));
    expect(threads).toHaveLength(3);
  });

  it('mídia que o OpenWA não guardou não derruba a mensagem nem o evento', async () => {
    if (!enabled) return;
    const message = normalizeOpenwaMessage({ ...msg(PESSOA, 'sem-midia', 500), type: 'image', body: null, media: { mimetype: 'image/jpeg', omitted: true } });
    const result = await persistOpenwaMessage({ session, message, importMedia: true, countUnread: true });
    expect(result.created).toBe(true);
    expect(result.mediaImported).toBe(false);
    const [row] = await db.select().from(schema.threadMessages).where(eq(schema.threadMessages.id, result.message.id));
    expect(row!.metadata.mediaError).toBe('No media stored for this message');
  });

  it('sync duplicado mais antigo se aposenta sem tocar no WhatsApp', async () => {
    if (!enabled) return;
    const [antigo] = await db.insert(schema.whatsappSyncJobs).values({ organizationId, sessionId: session.id, status: 'running', phase: 'messages', createdAt: new Date(Date.now() - 60_000) }).returning();
    const [novo] = await db.insert(schema.whatsappSyncJobs).values({ organizationId, sessionId: session.id, status: 'queued', phase: 'queued' }).returning();
    const chamadas = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await processOpenwaSyncJob(antigo!.id);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(chamadas);
    const [depois] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, antigo!.id));
    expect(depois!.status).toBe('superseded');
    await processOpenwaSyncJob(novo!.id);
    const [vencedor] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, novo!.id));
    expect(vencedor!.status).toBe('completed');
  });

  it('dois syncs do mesmo milissegundo: exatamente um continua', async () => {
    if (!enabled) return;
    const mesmo = new Date();
    const [a] = await db.insert(schema.whatsappSyncJobs).values({ organizationId, sessionId: session.id, status: 'queued', phase: 'queued', createdAt: mesmo }).returning();
    const [b] = await db.insert(schema.whatsappSyncJobs).values({ organizationId, sessionId: session.id, status: 'queued', phase: 'queued', createdAt: mesmo }).returning();
    // Empate de data: decide o id. O perdedor roda primeiro, com o vencedor ainda na fila.
    const [perdedor, vencedor] = [a!.id, b!.id].sort();
    await processOpenwaSyncJob(perdedor!);
    await processOpenwaSyncJob(vencedor!);
    const rows = await db.select({ status: schema.whatsappSyncJobs.status }).from(schema.whatsappSyncJobs).where(sql`${schema.whatsappSyncJobs.id} in (${a!.id}, ${b!.id})`);
    expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'superseded']);
  });

  it('sync parado há mais de 10 min não prende a sessão', async () => {
    if (!enabled) return;
    await db.update(schema.whatsappSyncJobs).set({ status: 'completed' }).where(sql`${schema.whatsappSyncJobs.sessionId} = ${session.id} and ${schema.whatsappSyncJobs.status} in ('queued','running')`);
    const velho = new Date(Date.now() - 20 * 60_000);
    const [orfao] = await db.insert(schema.whatsappSyncJobs).values({ organizationId, sessionId: session.id, status: 'running', phase: 'messages', createdAt: velho, updatedAt: velho }).returning();
    const novo = await createWhatsappSyncJob(session, null);
    expect(novo.created).toBe(true);
    const [depois] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, orfao!.id));
    expect(depois!.status).toBe('superseded');
    expect((await createWhatsappSyncJob(session, null)).id).toBe(novo.id);
  });

  it('envio pela Inbox + confirmação do WhatsApp viram uma mensagem só', async () => {
    if (!enabled) return;
    const [thread] = await db.select().from(schema.conversationThreads).where(and(eq(schema.conversationThreads.whatsappSessionId, session.id), eq(schema.conversationThreads.externalChatId, PESSOA)));
    const [pendente] = await db.insert(schema.threadMessages).values({
      threadId: thread!.id, organizationId, whatsappSessionId: session.id, providerSessionKey: session.id,
      channel: 'whatsapp', direction: 'outbound', senderUserId: userId, content: 'resposta da equipe', deliveryStatus: 'pending',
    }).returning();
    const eco = normalizeOpenwaMessage({ ...msg(PESSOA, 'eco-123', Math.floor(Date.now() / 1000)), body: 'resposta da equipe', fromMe: true, direction: 'outgoing', status: 'sent' });
    const result = await persistOpenwaMessage({ session, message: eco, countUnread: true });
    expect(result.created).toBe(false);
    expect(result.message.id).toBe(pendente!.id);
    const iguais = await db.select().from(schema.threadMessages).where(and(eq(schema.threadMessages.threadId, thread!.id), eq(schema.threadMessages.content, 'resposta da equipe')));
    expect(iguais).toHaveLength(1);
    expect(iguais[0]!.externalMessageId).toBe('eco-123');
    expect(iguais[0]!.deliveryStatus).toBe('sent');
    expect(iguais[0]!.senderUserId).toBe(userId);
  });
});
