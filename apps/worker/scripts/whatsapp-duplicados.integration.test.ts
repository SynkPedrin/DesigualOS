import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** O script de duplicados contra Postgres real e isolado: relatório não grava; --aplicar junta sem perder mensagem. */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);
const script = fileURLToPath(new URL('./whatsapp-duplicados.mts', import.meta.url));
const rodar = (...args: string[]) => execFileSync('npx', ['tsx', script, ...args], { env: { ...process.env }, encoding: 'utf8' });

describe.skipIf(!enabled)('whatsapp-duplicados × PostgreSQL real', () => {
  const org = randomUUID();
  const dona = randomUUID();
  const sessao = randomUUID();
  const PROPRIO = '5518900000009';
  let dbm: typeof import('@desigual-os/database');
  const ids = { velho: randomUUID(), novo: randomUUID(), proprio: randomUUID(), tVelha: randomUUID(), tNova: randomUUID(), tPropria: randomUUID() };

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: 'QA dup', slug: `qa-dup-${org}` });
    await db.insert(schema.users).values({ id: dona, email: `dup-${dona}@example.com`, name: 'Dona QA' });
    await db.insert(schema.whatsappSessions).values({ id: sessao, organizationId: org, ownerUserId: dona, provider: 'openwa', phoneNumber: PROPRIO, externalSessionId: randomUUID(), externalName: 'qa', apiKeyEncrypted: 'x', webhookSecretEncrypted: 'x', status: 'ready' });
    await db.insert(schema.contacts).values([
      { id: ids.velho, organizationId: org, name: 'Cliente Fulano', phone: '5511977770000', externalIds: { whatsapp: '5511977770000@c.us' }, createdAt: new Date('2026-10-01') },
      { id: ids.novo, organizationId: org, name: '5511977770000', phone: '5511977770000', externalIds: { whatsappLid: '99001@lid' }, createdAt: new Date('2026-10-28') },
      { id: ids.proprio, organizationId: org, name: 'Dona QA', phone: PROPRIO, externalIds: { whatsapp: '99002@lid' } },
    ]);
    const base = { organizationId: org, whatsappSessionId: sessao, channel: 'whatsapp' as const, kind: 'individual', status: 'waiting_agency' as const };
    await db.insert(schema.conversationThreads).values([
      { ...base, id: ids.tVelha, contactId: ids.velho, externalChatId: '5511977770000@c.us', title: 'Fulano', unreadCount: 1, lastMessageAt: new Date('2026-10-20'), lastMessagePreview: 'antiga', createdAt: new Date('2026-10-01') },
      { ...base, id: ids.tNova, contactId: ids.novo, externalChatId: '99001@lid', title: 'Fulano', unreadCount: 2, lastMessageAt: new Date('2026-10-29'), lastMessagePreview: 'nova', createdAt: new Date('2026-10-28') },
      { ...base, id: ids.tPropria, contactId: ids.proprio, externalChatId: '99002@lid', title: 'Alguém', unreadCount: 0 },
    ]);
    const m = (threadId: string, ext: string, senderContactId: string | null) => ({ threadId, organizationId: org, whatsappSessionId: sessao, providerSessionKey: sessao, channel: 'whatsapp' as const, direction: 'inbound' as const, senderContactId, content: ext, externalMessageId: ext, deliveryStatus: 'delivered' as const });
    await db.insert(schema.threadMessages).values([m(ids.tVelha, 'm1', ids.velho), m(ids.tNova, 'm2', ids.novo), m(ids.tNova, 'm3', ids.novo), m(ids.tPropria, 'm4', ids.proprio)]);
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(eq(schema.users.id, dona));
  });

  it('sem --aplicar só relata: nada muda', async () => {
    const saida = rodar();
    expect(saida).toContain('Simulação: nada foi gravado');
    expect(saida).toMatch(/Contatos com o número da própria colaboradora: [1-9]/);
    const { db, schema } = dbm;
    expect(await db.select().from(schema.contacts).where(eq(schema.contacts.organizationId, org))).toHaveLength(3);
  });

  it('--aplicar junta contato e conversa da mesma pessoa, solta o número da colaboradora e não perde mensagem', async () => {
    rodar('--aplicar');
    const { db, schema } = dbm;
    const contatos = await db.select().from(schema.contacts).where(eq(schema.contacts.organizationId, org));
    expect(contatos.map((c) => c.id).sort()).toEqual([ids.velho, ids.proprio].sort());
    const velho = contatos.find((c) => c.id === ids.velho)!;
    expect(velho.name).toBe('Cliente Fulano');
    expect(velho.externalIds).toMatchObject({ whatsapp: '5511977770000@c.us', whatsappLid: '99001@lid' });
    expect(contatos.find((c) => c.id === ids.proprio)!.phone).toBeNull();

    const conversas = await db.select().from(schema.conversationThreads).where(eq(schema.conversationThreads.organizationId, org));
    expect(conversas.map((t) => t.id).sort()).toEqual([ids.tVelha, ids.tPropria].sort());
    const fundida = conversas.find((t) => t.id === ids.tVelha)!;
    expect(fundida).toMatchObject({ unreadCount: 3, lastMessagePreview: 'nova', externalChatId: '5511977770000@c.us' });
    expect(conversas.find((t) => t.id === ids.tPropria)!.contactId).toBeNull();

    const msgs = await db.select().from(schema.threadMessages).where(inArray(schema.threadMessages.externalMessageId, ['m1', 'm2', 'm3', 'm4']));
    expect(msgs).toHaveLength(4);
    expect(msgs.filter((x) => x.threadId === ids.tVelha).map((x) => x.externalMessageId).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(msgs.filter((x) => ['m2', 'm3'].includes(x.externalMessageId!)).every((x) => x.senderContactId === ids.velho)).toBe(true);
  }, 60_000);
});
