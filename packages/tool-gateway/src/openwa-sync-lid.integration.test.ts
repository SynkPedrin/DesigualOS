import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, schema } from '@desigual-os/database';
import type { WhatsappSessionRow } from './openwa-session-store';
import type { OpenwaMessage } from './openwa-gateway';

/**
 * Contatos e conversas duplicados quando o WhatsApp troca `@c.us` por `@lid` (medido em produção, 28-29/10/2026).
 * Postgres real; do OpenWA só a tabela lid→telefone é simulada.
 */
const enabled = Boolean(process.env.OPENWA_TEST_DATABASE_URL);

const motor = vi.hoisted(() => ({ lids: new Map<string, string | null>(), consultas: 0 }));
vi.mock('./openwa-session-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./openwa-session-store')>()),
  gatewayForWhatsappSession: () => ({
    resolvePhone: async (lid: string) => { motor.consultas += 1; return motor.lids.get(lid) ?? null; },
  }),
}));

const { persistOpenwaMessage } = await import('./openwa-sync');

const organizationId = randomUUID();
const userId = randomUUID();
const sessionId = randomUUID();
const PROPRIO = '5518900000001'; // o número da colaboradora dona da sessão
let session: WhatsappSessionRow;

function msg(o: Partial<OpenwaMessage>): OpenwaMessage {
  return {
    id: randomUUID(), chatId: '5511911110000@c.us', from: '5511911110000@c.us', to: `${PROPRIO}@c.us`,
    author: null, body: 'oi', type: 'text', timestamp: Math.floor(Date.now() / 1000), fromMe: false, isGroup: false,
    kind: 'individual', direction: 'incoming', status: null, ...o,
  };
}
const contatos = () => db.select().from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId));
const conversas = () => db.select().from(schema.conversationThreads).where(eq(schema.conversationThreads.organizationId, organizationId));

beforeAll(async () => {
  if (!enabled) return;
  await db.insert(schema.organizations).values({ id: organizationId, name: 'QA LID', slug: `qa-lid-${organizationId}` });
  await db.insert(schema.users).values({ id: userId, email: `qa-lid-${userId}@example.com`, name: 'QA LID' });
  const [created] = await db.insert(schema.whatsappSessions).values({
    id: sessionId, organizationId, ownerUserId: userId, provider: 'openwa', phoneNumber: PROPRIO,
    externalSessionId: randomUUID(), externalName: 'qa-lid', apiKeyEncrypted: 'not-used', webhookSecretEncrypted: 'not-used', status: 'ready',
  }).returning();
  session = created!;
});

afterAll(async () => {
  if (!enabled) return;
  await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
});

beforeEach(() => { motor.lids.clear(); motor.consultas = 0; });

describe('WhatsApp: a mesma pessoa por @c.us e por @lid', () => {
  it('quem já conversava por número continua no MESMO contato e na MESMA conversa quando passa a vir por @lid', async () => {
    if (!enabled) return;
    await persistOpenwaMessage({ session, message: msg({ chatId: '5511922220000@c.us', from: '5511922220000@c.us', body: 'antes' }) });
    motor.lids.set('77001@lid', '5511922220000');
    await persistOpenwaMessage({ session, message: msg({ chatId: '77001@lid', from: '77001@lid', body: 'depois' }) });
    const doNumero = (await contatos()).filter((c) => c.phone === '5511922220000');
    expect(doNumero).toHaveLength(1);
    expect(doNumero[0]!.externalIds).toMatchObject({ whatsapp: '5511922220000@c.us', whatsappLid: '77001@lid' }); // um não apaga o outro
    const dele = (await conversas()).filter((t) => t.contactId === doNumero[0]!.id);
    expect(dele).toHaveLength(1);
    const msgs = await db.select().from(schema.threadMessages).where(eq(schema.threadMessages.threadId, dele[0]!.id));
    expect(msgs.map((m) => m.content).sort()).toEqual(['antes', 'depois']);
  });

  it('mensagem ENVIADA num chat @lid não vira contato com o número da própria colaboradora', async () => {
    if (!enabled) return;
    motor.lids.set('77002@lid', '5511933330000');
    await persistOpenwaMessage({ session, message: msg({ chatId: '77002@lid', from: `${PROPRIO}@c.us`, to: '77002@lid', fromMe: true, direction: 'outgoing', status: 'sent', body: 'enviei' }) });
    const todos = await contatos();
    expect(todos.some((c) => c.phone === PROPRIO)).toBe(false);
    expect(todos.filter((c) => c.phone === '5511933330000')).toHaveLength(1);
  });

  it('sem telefone conhecido, duas pessoas @lid diferentes continuam separadas (nunca juntadas por engano)', async () => {
    if (!enabled) return;
    await persistOpenwaMessage({ session, message: msg({ chatId: '88001@lid', from: `${PROPRIO}@c.us`, fromMe: true, direction: 'outgoing', body: 'para A' }) });
    await persistOpenwaMessage({ session, message: msg({ chatId: '88002@lid', from: `${PROPRIO}@c.us`, fromMe: true, direction: 'outgoing', body: 'para B' }) });
    const ids = (await conversas()).filter((t) => ['88001@lid', '88002@lid'].includes(t.externalChatId ?? ''));
    expect(ids).toHaveLength(2);
    expect(new Set(ids.map((t) => t.contactId)).size).toBe(2);
  });

  it('cinco mensagens simultâneas de um número novo: um contato e uma conversa', async () => {
    if (!enabled) return;
    await Promise.all(Array.from({ length: 5 }, (_, i) => persistOpenwaMessage({ session, message: msg({ chatId: '5511944440000@c.us', from: '5511944440000@c.us', body: `rajada ${i}` }) })));
    expect((await contatos()).filter((c) => c.phone === '5511944440000')).toHaveLength(1);
    expect((await conversas()).filter((t) => t.externalChatId === '5511944440000@c.us')).toHaveLength(1);
  });

  it('autor @lid de um grupo é reconhecido pelo telefone: o mesmo contato de quando falava em particular', async () => {
    if (!enabled) return;
    await persistOpenwaMessage({ session, message: msg({ chatId: '5511955550000@c.us', from: '5511955550000@c.us', body: 'particular' }) });
    motor.lids.set('77005@lid', '5511955550000');
    await persistOpenwaMessage({ session, message: msg({ chatId: '120363999@g.us', from: '120363999@g.us', author: '77005@lid', isGroup: true, kind: 'group', body: 'no grupo' }) });
    expect((await contatos()).filter((c) => c.phone === '5511955550000')).toHaveLength(1);
    const [noGrupo] = await db.select().from(schema.threadMessages).where(and(eq(schema.threadMessages.organizationId, organizationId), eq(schema.threadMessages.content, 'no grupo')));
    const [particular] = (await contatos()).filter((c) => c.phone === '5511955550000');
    expect(noGrupo!.senderContactId).toBe(particular!.id);
  });

  it('contato @lid sem número MAIS ANTIGO que o do número: a mensagem vai para o do número, sem criar telefone repetido', async () => {
    if (!enabled) return;
    await db.insert(schema.contacts).values({ organizationId, name: 'Só lid', phone: null, externalIds: { whatsappLid: '77007@lid' }, createdAt: new Date('2026-01-01') });
    await persistOpenwaMessage({ session, message: msg({ chatId: '5511977770000@c.us', from: '5511977770000@c.us', body: 'pelo número' }) });
    motor.lids.set('77007@lid', '5511977770000');
    await persistOpenwaMessage({ session, message: msg({ chatId: '77007@lid', from: '77007@lid', body: 'pelo lid' }) });
    expect((await contatos()).filter((c) => c.phone === '5511977770000')).toHaveLength(1);
  });

  it('a tabela lid→telefone é consultada uma vez por pessoa, não por mensagem', async () => {
    if (!enabled) return;
    motor.lids.set('77006@lid', '5511966660000');
    for (let i = 0; i < 3; i++) await persistOpenwaMessage({ session, message: msg({ id: randomUUID(), chatId: '77006@lid', from: '77006@lid', body: `m${i}` }) });
    expect(motor.consultas).toBe(1);
  });
});
