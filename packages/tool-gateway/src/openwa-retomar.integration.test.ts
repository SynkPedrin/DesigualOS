import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@desigual-os/database';
import { listWhatsappWebhookEventsParaRetomar } from './openwa-sync';

const enabled = Boolean(process.env.OPENWA_TEST_DATABASE_URL);
const organizationId = randomUUID();
const userId = randomUUID();
const sessionId = randomUUID();

async function evento(rotulo: string, status: string, attempts: number, recebidoHaMin: number, processadoHaMin: number | null) {
  const [e] = await db.insert(schema.whatsappWebhookEvents).values({
    dedupeKey: `${sessionId}-${rotulo}`, organizationId, sessionId, eventType: 'message.received', payload: { rotulo }, status, attempts,
    receivedAt: sql`now() - make_interval(mins => ${recebidoHaMin})` as unknown as Date,
    processedAt: processadoHaMin === null ? null : sql`now() - make_interval(mins => ${processadoHaMin})` as unknown as Date,
  }).returning({ id: schema.whatsappWebhookEvents.id });
  return e!.id;
}

beforeAll(async () => {
  if (!enabled) return;
  await db.insert(schema.organizations).values({ id: organizationId, name: 'QA retomar', slug: `qa-retomar-${organizationId}` });
  await db.insert(schema.users).values({ id: userId, email: `qa-retomar-${userId}@example.com`, name: 'QA retomar' });
  await db.insert(schema.whatsappSessions).values({ id: sessionId, organizationId, ownerUserId: userId, provider: 'openwa', externalSessionId: randomUUID(), externalName: 'qa', apiKeyEncrypted: 'x', webhookSecretEncrypted: 'x', status: 'ready' });
});
afterAll(async () => {
  if (!enabled) return;
  await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
});

describe('WhatsApp: eventos falhos voltam sozinhos para a fila', () => {
  it('retoma o que falhou ou ficou preso; deixa em paz o recente, o processado, o velho demais e o que já girou 15 vezes', async () => {
    if (!enabled) return;
    const volta = [
      await evento('falhou há 10 min', 'failed', 5, 12, 10),
      await evento('preso em processing há 20 min', 'processing', 1, 20, null),
      await evento('preso em queued há 30 min', 'queued', 0, 30, null),
    ];
    const fica = [
      await evento('falhou agora há pouco', 'failed', 5, 3, 1),
      await evento('na fila há 2 min', 'queued', 0, 2, null),
      await evento('processado', 'processed', 1, 60, 59),
      await evento('girou 15 vezes', 'failed', 15, 120, 60),
      await evento('de anteontem', 'failed', 5, 60 * 30, 60 * 29),
    ];
    const ids = (await listWhatsappWebhookEventsParaRetomar()).map((e) => e.id);
    for (const id of volta) expect(ids).toContain(id);
    for (const id of fica) expect(ids).not.toContain(id);
  });
});
