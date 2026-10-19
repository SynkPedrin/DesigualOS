import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@desigual-os/database';
import { getThread, listRecentMessagesVisible, listThreads } from './service';

/** Isolamento da Inbox por dono da sessão, em Postgres real (só com OPENWA_TEST_DATABASE_URL). */
const enabled = Boolean(process.env.OPENWA_TEST_DATABASE_URL);
const org = randomUUID();
const dono = randomUUID();
const colega = randomUUID();
let threadDoDono = '';
let threadDaEmpresa = '';

beforeAll(async () => {
  if (!enabled) return;
  await db.insert(schema.organizations).values({ id: org, name: 'QA Isolamento', slug: `qa-iso-${org}` });
  await db.insert(schema.users).values([
    { id: dono, email: `dono-${dono}@example.com`, name: 'Dono' },
    { id: colega, email: `colega-${colega}@example.com`, name: 'Colega' },
  ]);
  const [sessao] = await db.insert(schema.whatsappSessions).values({
    organizationId: org, ownerUserId: dono, externalSessionId: randomUUID(), externalName: 'qa-iso',
    apiKeyEncrypted: 'x', webhookSecretEncrypted: 'x', status: 'ready',
  }).returning();
  const [pessoal] = await db.insert(schema.conversationThreads).values({
    organizationId: org, whatsappSessionId: sessao!.id, externalChatId: '5511900000000@c.us', kind: 'individual', channel: 'whatsapp', status: 'waiting_agency',
  }).returning();
  const [empresa] = await db.insert(schema.conversationThreads).values({
    organizationId: org, channel: 'whatsapp', status: 'waiting_agency',
  }).returning();
  threadDoDono = pessoal!.id;
  threadDaEmpresa = empresa!.id;
});

afterAll(async () => {
  if (!enabled) return;
  await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
  await db.delete(schema.users).where(eq(schema.users.id, dono));
  await db.delete(schema.users).where(eq(schema.users.id, colega));
});

describe('Inbox isolada por dono da sessão WhatsApp', () => {
  it('o dono vê a própria conversa; o colega só vê as da empresa', async () => {
    if (!enabled) return;
    const doDono = await listThreads({ organizationId: org, callerId: dono, limit: 50, offset: 0 });
    const doColega = await listThreads({ organizationId: org, callerId: colega, limit: 50, offset: 0 });
    expect(doDono.map((t) => t.id).sort()).toEqual([threadDoDono, threadDaEmpresa].sort());
    expect(doColega.map((t) => t.id)).toEqual([threadDaEmpresa]);
    expect(await getThread(org, threadDoDono, colega)).toBeNull();
    expect(await getThread(org, threadDoDono, dono)).not.toBeNull();
  });

  it('conversa sem data vai para o fim, nunca para o topo', async () => {
    if (!enabled) return;
    await db.update(schema.conversationThreads).set({ lastMessageAt: new Date() }).where(eq(schema.conversationThreads.id, threadDoDono));
    const lista = await listThreads({ organizationId: org, callerId: dono, limit: 50, offset: 0 });
    expect(lista.map((t) => t.id)).toEqual([threadDoDono, threadDaEmpresa]);
  });

  it('arquivada no WhatsApp sai da lista principal e aparece em Arquivadas; busca acha pelo título', async () => {
    if (!enabled) return;
    await db.update(schema.conversationThreads).set({ whatsappArchived: true, title: 'Grupo da Campanha' }).where(eq(schema.conversationThreads.id, threadDoDono));
    const principal = await listThreads({ organizationId: org, callerId: dono, limit: 50, offset: 0 });
    const arquivadas = await listThreads({ organizationId: org, callerId: dono, view: 'archived', limit: 50, offset: 0 });
    expect(principal.map((t) => t.id)).toEqual([threadDaEmpresa]);
    expect(arquivadas.map((t) => t.id)).toEqual([threadDoDono]);
    const busca = await listThreads({ organizationId: org, callerId: dono, view: 'archived', q: 'campanha', limit: 50, offset: 0 });
    expect(busca.map((t) => t.id)).toEqual([threadDoDono]);
    const nada = await listThreads({ organizationId: org, callerId: dono, view: 'archived', q: '100%_x', limit: 50, offset: 0 });
    expect(nada).toHaveLength(0);
  });

  it('conversa com mais de 50 mensagens abre nas MAIS RECENTES, em ordem; colega não vê', async () => {
    if (!enabled) return;
    const base = Date.now() - 60 * 60_000;
    await db.insert(schema.threadMessages).values(Array.from({ length: 60 }, (_, i) => ({
      threadId: threadDoDono, organizationId: org, channel: 'whatsapp' as const, direction: 'inbound' as const,
      content: `m${i}`, deliveryStatus: 'delivered' as const, createdAt: new Date(base + i * 1000),
    })));
    const pagina = await listRecentMessagesVisible(org, threadDoDono, dono, 50, 0);
    expect(pagina).toHaveLength(50);
    expect(pagina![0]!.content).toBe('m10');
    expect(pagina![49]!.content).toBe('m59');
    const anterior = await listRecentMessagesVisible(org, threadDoDono, dono, 50, 50);
    expect(anterior!.map((m) => m.content)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`));
    expect(await listRecentMessagesVisible(org, threadDoDono, colega, 50, 0)).toBeNull();
    expect(await listRecentMessagesVisible(org, threadDaEmpresa, colega, 50, 0)).toEqual([]);
  });
});
