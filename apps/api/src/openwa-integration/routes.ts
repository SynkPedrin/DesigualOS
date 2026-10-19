import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  createWhatsappSyncJob,
  encryptToken,
  gatewayForWhatsappSession,
  normalizeOpenwaMessage,
  OpenwaGatewayError,
  openwaAdminClient,
  recoverWhatsappWebhookEvent,
  registerOpenwaWebhookEvent,
  whatsappSessionForOwner,
  whatsappWebhookSecret,
  type WhatsappSessionRow,
} from '@desigual-os/tool-gateway';
import { enqueueWhatsappSync, enqueueWhatsappWebhook, publishWsEvent, retryWhatsappSync, retryWhatsappWebhook } from '@desigual-os/orchestrator';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';

const envelopeSchema = z.object({
  event: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
  idempotencyKey: z.string().optional(),
  deliveryId: z.string().optional(),
  data: z.unknown(),
}).passthrough();

function enabled(): boolean {
  return process.env.WHATSAPP_OPENWA_ENABLED === 'true' || (process.env.NODE_ENV !== 'production' && process.env.WHATSAPP_OPENWA_ENABLED !== 'false');
}

function canManageOthers(request: FastifyRequest): boolean {
  return request.authUser?.roles.includes('master') === true;
}

function canUse(request: FastifyRequest): boolean {
  return canManageOthers(request) || process.env.WHATSAPP_OPENWA_ADMIN_ONLY === 'false' || process.env.NODE_ENV !== 'production';
}

function webhookUrl(): string {
  const configured = process.env.OPENWA_WEBHOOK_URL?.trim();
  const publicUrl = process.env.API_PUBLIC_URL?.trim().replace(/\/$/, '');
  const value = configured || (publicUrl ? `${publicUrl}/openwa/webhook` : '');
  if (!value) throw new Error('OPENWA_WEBHOOK_URL ou API_PUBLIC_URL precisa estar configurada');
  return value;
}

function errorResponse(reply: FastifyReply, error: unknown) {
  if (error instanceof OpenwaGatewayError) {
    const status = error.status === 404 ? 404 : error.status === 501 ? 501 : error.status === 400 || error.status === 409 ? 409 : error.status === 413 ? 413 : error.status === 429 ? 429 : error.code === 'NETWORK' ? 503 : 502;
    reply.code(status);
    return { error: error.message, code: error.code, retryable: error.retryable };
  }
  reply.code(500);
  return { error: error instanceof Error ? error.message : 'Falha na integração OpenWA' };
}

function presentJob(job: typeof schema.whatsappSyncJobs.$inferSelect | null) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    processed_contacts: job.processedContacts,
    processed_chats: job.processedChats,
    processed_messages: job.processedMessages,
    duplicate_messages: job.duplicateMessages,
    imported_media: job.importedMedia,
    failures: job.failures,
    error: job.error,
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
    created_at: job.createdAt.toISOString(),
  };
}

async function latestJob(sessionId: string) {
  const [job] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.sessionId, sessionId)).orderBy(desc(schema.whatsappSyncJobs.createdAt)).limit(1);
  return job ?? null;
}

/**
 * As três contagens (conversas, contatos, mensagens) em memória por 60 s: a
 * Inbox e Integrações pedem a sessão a cada poucos segundos, e a de contatos
 * varre a agenda inteira da empresa. Medido em 19/10/2026: GET /openwa/sessions
 * em 2,5 s de mediana.
 */
const countsCache = new Map<string, { value: [Array<{ threads: number }>, Array<{ contacts: number }>, Array<{ messages: number }>]; at: number }>();

async function sessionCounts(session: WhatsappSessionRow) {
  const hit = countsCache.get(session.id);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = await Promise.all([
    db.select({ threads: sql<number>`count(distinct ${schema.conversationThreads.id})::int` }).from(schema.conversationThreads).where(eq(schema.conversationThreads.whatsappSessionId, session.id)),
    db.select({ contacts: sql<number>`count(*)::int` }).from(schema.contacts).where(and(
      eq(schema.contacts.organizationId, session.organizationId),
      sql`${schema.contacts.externalIds} ? ${`openwa:${session.id}`}`,
    )),
    db.select({ messages: sql<number>`count(*)::int` }).from(schema.threadMessages).where(eq(schema.threadMessages.whatsappSessionId, session.id)),
  ]);
  countsCache.set(session.id, { value, at: Date.now() });
  return value;
}

async function presentSession(session: WhatsappSessionRow) {
  const [job, [counts, contactCounts, messageCounts]] = await Promise.all([
    latestJob(session.id),
    sessionCounts(session),
  ]);
  return {
    id: session.id,
    provider: session.provider,
    external_session_id: session.externalSessionId,
    owner_user_id: session.ownerUserId,
    phone_number: session.phoneNumber,
    push_name: session.pushName,
    status: session.status,
    engine_loaded: session.engineLoaded,
    connected_at: session.connectedAt?.toISOString() ?? null,
    last_seen_at: session.lastSeenAt?.toISOString() ?? null,
    last_sync_at: session.lastSyncAt?.toISOString() ?? null,
    last_error: session.lastError,
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
    counts: {
      contacts: Number(contactCounts[0]?.contacts ?? 0),
      conversations: Number(counts[0]?.threads ?? 0),
      messages: Number(messageCounts[0]?.messages ?? 0),
    },
    latest_sync: presentJob(job),
  };
}

async function ownedSession(request: FastifyRequest, id: string) {
  return whatsappSessionForOwner({
    id,
    organizationId: request.tenantContext!.organizationId,
    ownerUserId: request.authUser!.id,
    canManageOthers: canManageOthers(request),
  });
}

async function refreshSession(session: WhatsappSessionRow) {
  const previousStatus = session.status;
  const snapshot = await gatewayForWhatsappSession(session).getSession();
  const [updated] = await db.update(schema.whatsappSessions).set({
    status: snapshot.status,
    phoneNumber: snapshot.phone,
    pushName: snapshot.pushName,
    connectedAt: snapshot.connectedAt ? new Date(snapshot.connectedAt) : session.connectedAt,
    lastSeenAt: snapshot.lastActive ? new Date(snapshot.lastActive) : new Date(),
    lastError: snapshot.lastError,
    engineLoaded: snapshot.engineLoaded,
  }).where(eq(schema.whatsappSessions.id, session.id)).returning();
  // Primeira vez pronta, ou pronta sem nunca ter sincronizado (o webhook de
  // "autenticado" pode não ter chegado): dispara a importação. O job é
  // deduplicado enquanto houver um na fila ou rodando.
  if (snapshot.status === 'ready' && (previousStatus !== 'ready' || (!session.lastSyncAt && !(await latestJob(session.id))))) {
    const job = await createWhatsappSyncJob(updated!, null);
    if (job.created) await enqueueWhatsappSync(job.id);
  }
  return updated!;
}

async function ensureWebhook(session: WhatsappSessionRow): Promise<void> {
  const client = gatewayForWhatsappSession(session);
  const input = { url: webhookUrl(), secret: whatsappWebhookSecret(session) };
  let webhookId = session.webhookId;
  if (webhookId) {
    try {
      await client.updateWebhook(webhookId, input);
      return;
    } catch (error) {
      if (!(error instanceof OpenwaGatewayError) || error.status !== 404) throw error;
    }
  }
  const created = await client.createWebhook(input);
  webhookId = created.id;
  await db.update(schema.whatsappSessions).set({ webhookId }).where(eq(schema.whatsappSessions.id, session.id));
}

export async function registerOpenwaRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (authed) => {
    authed.addHook('preHandler', async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent) return;
      await requireTenant(request, reply);
      if (reply.sent) return;
      await requireModule('inbox')(request, reply);
      if (reply.sent) return;
      if (!enabled()) {
        reply.code(404).send({ error: 'A integração OpenWA não está habilitada neste ambiente.' });
        return;
      }
      if (!canUse(request)) {
        reply.code(403).send({ error: 'A homologação do WhatsApp está restrita a administradores.' });
      }
    });

    authed.get('/openwa/sessions', { preHandler: requirePermission('communications', 'read') }, async (request) => {
      const conditions = [eq(schema.whatsappSessions.organizationId, request.tenantContext!.organizationId)];
      if (!canManageOthers(request)) conditions.push(eq(schema.whatsappSessions.ownerUserId, request.authUser!.id));
      const sessions = await db.select().from(schema.whatsappSessions).where(and(...conditions)).orderBy(desc(schema.whatsappSessions.createdAt));
      // A própria conexão é conferida no OpenWA enquanto não estiver pronta e
      // sincronizada: sem isso, quem fecha o modal logo após escanear ficava
      // com "Aguardando leitura" até um webhook que pode nunca chegar.
      const fresh = await Promise.all(sessions.map(async (session) => {
        if (session.ownerUserId !== request.authUser!.id || (session.status === 'ready' && session.lastSyncAt)) return session;
        try {
          return await refreshSession(session);
        } catch {
          return session;
        }
      }));
      return { sessions: await Promise.all(fresh.map(presentSession)) };
    });

    authed.post('/openwa/sessions', { preHandler: requirePermission('communications', 'write'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
      const organizationId = request.tenantContext!.organizationId;
      const ownerUserId = request.authUser!.id;
      let [session] = await db.select().from(schema.whatsappSessions).where(and(
        eq(schema.whatsappSessions.organizationId, organizationId),
        eq(schema.whatsappSessions.ownerUserId, ownerUserId),
        eq(schema.whatsappSessions.provider, 'openwa'),
      )).limit(1);
      try {
        let createdNow = false;
        if (!session) {
          createdNow = true;
          const externalName = `desigual-${randomUUID()}`;
          const admin = openwaAdminClient();
          const created = await admin.createSession(externalName);
          const scoped = await admin.createScopedOperatorKey(externalName, created.id);
          const secret = randomBytes(32).toString('hex');
          const scopedClient = gatewayForWhatsappSession({
            externalSessionId: created.id,
            apiKeyEncrypted: encryptToken(scoped.apiKey),
          } as WhatsappSessionRow);
          const webhook = await scopedClient.createWebhook({ url: webhookUrl(), secret });
          const [inserted] = await db.insert(schema.whatsappSessions).values({
            organizationId,
            ownerUserId,
            provider: 'openwa',
            externalSessionId: created.id,
            externalName,
            apiKeyEncrypted: encryptToken(scoped.apiKey),
            webhookSecretEncrypted: encryptToken(secret),
            webhookId: webhook.id,
            status: created.status,
            engineLoaded: created.engineLoaded,
          }).returning();
          session = inserted!;
        }
        if (!createdNow) await ensureWebhook(session);
        if (!session.engineLoaded || ['created', 'failed', 'disconnected'].includes(session.status)) {
          // Não espera o Chromium subir: o QR chega pelo status da sessão, que a tela acompanha.
          await gatewayForWhatsappSession(session).requestStart();
        }
        session = await refreshSession(session);
        await auditarAcao(request, { action: 'whatsapp.session_connect', resourceType: 'whatsapp_session', resourceId: session.id, newValue: { status: session.status } });
        reply.code(202);
        return presentSession(session);
      } catch (error) {
        return errorResponse(reply, error);
      }
    });

    authed.get<{ Params: { id: string } }>('/openwa/sessions/:id', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      try {
        return presentSession(await refreshSession(session));
      } catch (error) {
        if (error instanceof OpenwaGatewayError && error.code === 'NETWORK') {
          return presentSession({ ...session, status: 'unavailable', lastError: error.message });
        }
        return errorResponse(reply, error);
      }
    });

    authed.get<{ Params: { id: string } }>('/openwa/sessions/:id/qr', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      try {
        const qr = await gatewayForWhatsappSession(session).getQr();
        await auditarAcao(request, { action: 'whatsapp.session_qr_viewed', resourceType: 'whatsapp_session', resourceId: session.id, newValue: { status: qr.status } });
        return { qr_code: qr.qrCode, status: qr.status, fetched_at: new Date().toISOString() };
      } catch (error) {
        return errorResponse(reply, error);
      }
    });

    authed.post<{ Params: { id: string } }>('/openwa/sessions/:id/reconnect', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      try {
        if (!session.engineLoaded || session.status !== 'ready') await gatewayForWhatsappSession(session).requestStart();
        return presentSession(await refreshSession(session));
      } catch (error) {
        return errorResponse(reply, error);
      }
    });

    authed.delete<{ Params: { id: string } }>('/openwa/sessions/:id', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      try {
        if (session.engineLoaded) await gatewayForWhatsappSession(session).logoutSession();
        const [updated] = await db.update(schema.whatsappSessions).set({ status: 'disconnected', engineLoaded: false, phoneNumber: null, lastSeenAt: new Date() }).where(eq(schema.whatsappSessions.id, session.id)).returning();
        await auditarAcao(request, { action: 'whatsapp.session_disconnect', resourceType: 'whatsapp_session', resourceId: session.id });
        return presentSession(updated!);
      } catch (error) {
        return errorResponse(reply, error);
      }
    });

    authed.post<{ Params: { id: string } }>('/openwa/sessions/:id/sync', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      if (session.status !== 'ready') { reply.code(409); return { error: 'Conecte o WhatsApp antes de sincronizar.' }; }
      const job = await createWhatsappSyncJob(session, request.authUser!.id);
      await enqueueWhatsappSync(job.id);
      reply.code(202);
      return presentJob(await latestJob(session.id));
    });

    authed.get<{ Params: { id: string } }>('/openwa/sessions/:id/sync', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      const jobs = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.sessionId, session.id)).orderBy(desc(schema.whatsappSyncJobs.createdAt)).limit(20);
      return { jobs: jobs.map((job) => presentJob(job)) };
    });

    authed.post<{ Params: { id: string } }>('/openwa/sync-jobs/:id/retry', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const [job] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, request.params.id)).limit(1);
      if (!job) { reply.code(404); return { error: 'Sincronização não encontrada.' }; }
      const session = await ownedSession(request, job.sessionId);
      if (!session) { reply.code(404); return { error: 'Sincronização não encontrada.' }; }
      await db.update(schema.whatsappSyncJobs).set({ status: 'queued', phase: 'queued', error: null, finishedAt: null, failures: [] }).where(eq(schema.whatsappSyncJobs.id, job.id));
      await retryWhatsappSync(job.id);
      reply.code(202);
      return { ok: true };
    });

    authed.get<{ Params: { id: string } }>('/openwa/sessions/:id/events', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const session = await ownedSession(request, request.params.id);
      if (!session) { reply.code(404); return { error: 'Sessão não encontrada.' }; }
      const events = await db.select({ id: schema.whatsappWebhookEvents.id, eventType: schema.whatsappWebhookEvents.eventType, status: schema.whatsappWebhookEvents.status, attempts: schema.whatsappWebhookEvents.attempts, error: schema.whatsappWebhookEvents.error, receivedAt: schema.whatsappWebhookEvents.receivedAt, processedAt: schema.whatsappWebhookEvents.processedAt }).from(schema.whatsappWebhookEvents).where(eq(schema.whatsappWebhookEvents.sessionId, session.id)).orderBy(desc(schema.whatsappWebhookEvents.createdAt)).limit(50);
      return { events: events.map((event) => ({ ...event, receivedAt: event.receivedAt.toISOString(), processedAt: event.processedAt?.toISOString() ?? null })) };
    });

    authed.post<{ Params: { id: string } }>('/openwa/webhook-events/:id/retry', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const [event] = await db.select().from(schema.whatsappWebhookEvents).where(eq(schema.whatsappWebhookEvents.id, request.params.id)).limit(1);
      if (!event) { reply.code(404); return { error: 'Evento não encontrado.' }; }
      const session = await ownedSession(request, event.sessionId);
      if (!session) { reply.code(404); return { error: 'Evento não encontrado.' }; }
      await recoverWhatsappWebhookEvent(event.id);
      await retryWhatsappWebhook(event.id);
      reply.code(202);
      return { ok: true };
    });
  });

  await app.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => done(null, body));
    webhook.post('/openwa/webhook', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
      const rawBody = typeof request.body === 'string' ? request.body : '';
      try {
        const envelope = envelopeSchema.parse(JSON.parse(rawBody));
        const signature = request.headers['x-openwa-signature'];
        const headerKey = request.headers['x-openwa-idempotency-key'];
        const dedupeKey = envelope.idempotencyKey ?? (typeof headerKey === 'string' ? headerKey : null);
        if (!dedupeKey) { reply.code(400); return { error: 'Missing idempotency key' }; }
        const event = await registerOpenwaWebhookEvent({
          externalSessionId: envelope.sessionId,
          dedupeKey,
          eventType: envelope.event,
          envelope: envelope as Record<string, unknown>,
          rawBody,
          signature: typeof signature === 'string' ? signature : undefined,
        });
        if (!event) return { ok: true, ignored: 'unknown_session' };
        if (event.created) {
          // Na tela do dono antes de gravar: gravar leva ~0,5 s (banco em
          // us-east-1); a tela não precisa esperar isso para mostrar a mensagem.
          if (envelope.event === 'message.received' || envelope.event === 'message.sent') {
            const data = (envelope.data && typeof envelope.data === 'object' ? envelope.data : {}) as Record<string, unknown>;
            const m = normalizeOpenwaMessage(data);
            if (m.id && m.chatId) {
              void publishWsEvent({ type: 'inbox.message', payload: {
                owner_user_id: event.ownerUserId,
                chat_id: m.chatId,
                external_id: m.id,
                direction: m.direction === 'outgoing' ? 'outbound' : 'inbound',
                content: m.body,
                type: m.type,
                has_media: Boolean(m.media),
                sender_name: m.contact?.name ?? m.contact?.pushName ?? null,
                created_at: (m.timestamp ? new Date(m.timestamp * 1000) : new Date()).toISOString(),
              } }).catch(() => undefined);
            }
          }
          await enqueueWhatsappWebhook(event.id);
        }
        return { ok: true, duplicate: !event.created };
      } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_OPENWA_SIGNATURE') {
          reply.code(401);
          return { error: 'Invalid signature' };
        }
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          reply.code(400);
          return { error: 'Invalid payload' };
        }
        request.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Falha ao registrar webhook OpenWA');
        reply.code(503);
        return { error: 'Temporary webhook failure' };
      }
    });
  });
}
