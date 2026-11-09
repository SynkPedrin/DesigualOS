import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@desigual-os/database';
import { vigiarSessoesDoWhatsapp } from './openwa-vigia';
import type { OpenwaSessionSnapshot } from './openwa-gateway';
import type { WhatsappSessionRow } from './openwa-session-store';

const enabled = Boolean(process.env.OPENWA_TEST_DATABASE_URL);
const org = randomUUID();
const dona = randomUUID();
const admin = randomUUID();
const colega = randomUUID();
const sessao = randomUUID();

const snap = (status: string, extra: Partial<OpenwaSessionSnapshot> = {}): OpenwaSessionSnapshot => ({ id: 'x', name: 'x', status, phone: null, pushName: null, connectedAt: null, lastActive: null, lastError: null, engineLoaded: status === 'ready', ...extra });
/** O motor simulado responde pela NOSSA sessão; as de outros testes no mesmo banco ficam como estão. */
const motor = (resposta: (s: WhatsappSessionRow) => Promise<OpenwaSessionSnapshot>) => async (s: WhatsappSessionRow) => (s.id === sessao ? resposta(s) : snap(s.status));
const avisos = () => db.select().from(schema.notifications).where(and(inArray(schema.notifications.userId, [dona, admin, colega]), eq(schema.notifications.type, 'whatsapp_desconectado')));
const estado = async () => (await db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.id, sessao)))[0]!;

beforeAll(async () => {
  if (!enabled) return;
  await db.insert(schema.organizations).values({ id: org, name: 'QA vigia', slug: `qa-vigia-${org}` });
  await db.insert(schema.users).values([
    { id: dona, email: `dona-${dona}@example.com`, name: 'Alicia QA' },
    { id: admin, email: `admin-${admin}@example.com`, name: 'Admin QA' },
    { id: colega, email: `colega-${colega}@example.com`, name: 'Colega QA' },
  ]);
  await db.insert(schema.organizationMembers).values([
    { organizationId: org, userId: dona, role: 'collaborator' },
    { organizationId: org, userId: admin, role: 'admin' },
    { organizationId: org, userId: colega, role: 'collaborator' },
  ]);
  await db.insert(schema.whatsappSessions).values({ id: sessao, organizationId: org, ownerUserId: dona, provider: 'openwa', externalSessionId: randomUUID(), externalName: 'qa', apiKeyEncrypted: 'x', webhookSecretEncrypted: 'x', status: 'ready' });
});
afterAll(async () => {
  if (!enabled) return;
  await db.delete(schema.notifications).where(inArray(schema.notifications.userId, [dona, admin, colega]));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
  await db.delete(schema.users).where(inArray(schema.users.id, [dona, admin, colega]));
});

describe('vigia do WhatsApp', () => {
  it('caiu: grava o estado real e avisa a dona e o admin (não o colega); no mesmo dia não repete', async () => {
    if (!enabled) return;
    const r = await vigiarSessoesDoWhatsapp(motor(async () => snap('disconnected', { lastError: 'logout no celular' })));
    expect(r.mudancas.filter((m) => m.sessionId === sessao)).toEqual([{ sessionId: sessao, ownerUserId: dona, de: 'ready', para: 'disconnected' }]);
    expect((await estado()).status).toBe('disconnected');
    const a = await avisos();
    expect(a.map((n) => n.userId).sort()).toEqual([admin, dona].sort());
    expect(a.find((n) => n.userId === admin)!.title).toContain('Alicia QA');
    await vigiarSessoesDoWhatsapp(motor(async () => snap('disconnected')));
    expect(await avisos()).toHaveLength(2);
  });

  it('voltou: a mudança sai para o worker sincronizar', async () => {
    if (!enabled) return;
    const r = await vigiarSessoesDoWhatsapp(motor(async () => snap('ready')));
    expect(r.mudancas.find((m) => m.sessionId === sessao)).toMatchObject({ de: 'disconnected', para: 'ready' });
    expect((await estado()).status).toBe('ready');
  });

  it('motor inacessível não derruba ninguém: o estado fica como estava', async () => {
    if (!enabled) return;
    const r = await vigiarSessoesDoWhatsapp(async () => { throw Object.assign(new Error('OpenWA inacessível'), { status: null }); });
    expect(r.motorInacessivel).toBe(true);
    expect((await estado()).status).toBe('ready');
  });

  it('sessão que sumiu do motor (404) conta como desconectada', async () => {
    if (!enabled) return;
    await vigiarSessoesDoWhatsapp(motor(async () => { throw Object.assign(new Error('not found'), { status: 404 }); }));
    expect((await estado()).status).toBe('disconnected');
  });
});
