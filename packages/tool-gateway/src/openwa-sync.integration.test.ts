import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@desigual-os/database';
import { persistOpenwaMessage } from './openwa-sync';
import type { WhatsappSessionRow } from './openwa-session-store';
import type { OpenwaMessage } from './openwa-gateway';

const enabled = Boolean(process.env.OPENWA_TEST_DATABASE_URL);
const organizationId = randomUUID();
const userId = randomUUID();
const sessionId = randomUUID();
let session: WhatsappSessionRow;

function message(overrides: Partial<OpenwaMessage>): OpenwaMessage {
  return {
    id: randomUUID(), chatId: '5511999999999@c.us', from: '5511999999999@c.us', to: 'session@c.us',
    author: null, body: 'texto', type: 'text', timestamp: 100, fromMe: false, isGroup: false,
    kind: 'individual', direction: 'incoming', status: null,
    ...overrides,
  };
}

beforeAll(async () => {
  if (!enabled) return;
  await db.insert(schema.organizations).values({ id: organizationId, name: 'QA OpenWA', slug: `qa-openwa-${organizationId}` });
  await db.insert(schema.users).values({ id: userId, email: `qa-openwa-${userId}@example.com`, name: 'QA OpenWA' });
  const [created] = await db.insert(schema.whatsappSessions).values({
    id: sessionId, organizationId, ownerUserId: userId, provider: 'openwa',
    externalSessionId: randomUUID(), externalName: 'qa-openwa', apiKeyEncrypted: 'not-used',
    webhookSecretEncrypted: 'not-used', status: 'ready',
  }).returning();
  session = created!;
});

afterAll(async () => {
  if (!enabled) return;
  await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
});

describe('persistência OpenWA em Postgres real', () => {
  it('preserva recebidas e enviadas, concilia duplicados e ordena pelo timestamp original', async () => {
    if (!enabled) return;
    const inbound = message({ id: 'same-external-id', body: 'recebida', timestamp: 100 });
    const outbound = message({ id: 'outbound-id', body: 'enviada', timestamp: 101, fromMe: true, direction: 'outgoing', status: 'sent' });
    expect((await persistOpenwaMessage({ session, message: inbound })).created).toBe(true);
    expect((await persistOpenwaMessage({ session, message: outbound })).created).toBe(true);
    expect((await persistOpenwaMessage({ session, message: inbound })).created).toBe(false);

    const rows = await db.select().from(schema.threadMessages).where(and(
      eq(schema.threadMessages.organizationId, organizationId),
      eq(schema.threadMessages.providerSessionKey, sessionId),
    )).orderBy(asc(schema.threadMessages.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.direction)).toEqual(['inbound', 'outbound']);
    expect(rows.map((row) => row.createdAt.toISOString())).toEqual([new Date(100_000).toISOString(), new Date(101_000).toISOString()]);
  });

  it('cria grupo sem associar o grupo a um único contato e guarda o autor', async () => {
    if (!enabled) return;
    await persistOpenwaMessage({
      session,
      message: message({
        id: 'group-message-1', chatId: '120363000000000000@g.us', from: '120363000000000000@g.us',
        author: '5511888888888@c.us', body: 'mensagem do grupo', isGroup: true, kind: 'group',
        contact: { pushName: 'Participante QA' },
      }),
    });
    const [thread] = await db.select().from(schema.conversationThreads).where(and(
      eq(schema.conversationThreads.organizationId, organizationId),
      eq(schema.conversationThreads.externalChatId, '120363000000000000@g.us'),
    ));
    expect(thread!.kind).toBe('group');
    expect(thread!.contactId).toBeNull();
    expect(thread!.groupId).not.toBeNull();
    const [stored] = await db.select().from(schema.threadMessages).where(and(
      eq(schema.threadMessages.providerSessionKey, sessionId),
      eq(schema.threadMessages.externalMessageId, 'group-message-1'),
    ));
    expect(stored!.senderContactId).not.toBeNull();
    expect(stored!.senderName).toBe('Participante QA');
  });

  it('não deixa uma mensagem antiga fora de ordem regredir a última atividade', async () => {
    if (!enabled) return;
    const [before] = await db.select().from(schema.conversationThreads).where(and(
      eq(schema.conversationThreads.whatsappSessionId, sessionId),
      eq(schema.conversationThreads.externalChatId, '5511999999999@c.us'),
    ));
    await persistOpenwaMessage({ session, message: message({ id: 'older-arrival', timestamp: 50, body: 'antiga' }) });
    const [after] = await db.select().from(schema.conversationThreads).where(eq(schema.conversationThreads.id, before!.id));
    expect(after!.lastMessageAt?.toISOString()).toBe(before!.lastMessageAt?.toISOString());
  });
});
