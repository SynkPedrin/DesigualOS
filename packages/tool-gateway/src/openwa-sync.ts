import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { OpenwaGatewayError, normalizeOpenwaMessage, type OpenwaMessage } from './openwa-gateway';
import { gatewayForWhatsappSession, whatsappSessionByExternalId, whatsappSessionById, whatsappWebhookSecret, type WhatsappSessionRow } from './openwa-session-store';
import { saveWhatsappMedia, WHATSAPP_MEDIA_MAX_BYTES } from './openwa-media-store';

export const LIMITE_PADRAO_HISTORICO = 10;

type Session = WhatsappSessionRow;
type Contact = typeof schema.contacts.$inferSelect;
type Thread = typeof schema.conversationThreads.$inferSelect;
type Message = typeof schema.threadMessages.$inferSelect;

export function telefoneDoChat(chatId: string): string | null {
  const [user, domain] = chatId.split('@');
  if (!user || (domain !== 'c.us' && domain !== 's.whatsapp.net')) return null;
  const digits = user.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function phoneFromMessage(message: OpenwaMessage): string | null {
  return message.senderPhone?.replace(/\D/g, '') || telefoneDoChat(message.author ?? message.from ?? message.chatId);
}

function occurredAt(message: OpenwaMessage): Date {
  return message.timestamp && message.timestamp > 0 ? new Date(message.timestamp * 1000) : new Date();
}

function preview(message: OpenwaMessage): string {
  if (message.body) return message.body.slice(0, 500);
  const labels: Record<string, string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', voice: 'Áudio', document: 'Documento', sticker: 'Figurinha' };
  return labels[message.type] ?? 'Mensagem';
}

async function ensureContact(input: {
  session: Session;
  externalId: string;
  phone: string | null;
  name?: string | null | undefined;
  avatarUrl?: string | null | undefined;
}): Promise<Contact> {
  const phone = input.phone?.replace(/\D/g, '') || null;
  const conditions = [eq(schema.contacts.organizationId, input.session.organizationId)];
  const identity = phone
    ? or(eq(schema.contacts.phone, phone), sql`${schema.contacts.externalIds}->>'whatsapp' = ${input.externalId}`)
    : sql`${schema.contacts.externalIds}->>'whatsapp' = ${input.externalId}`;
  const [existing] = await db.select().from(schema.contacts).where(and(...conditions, identity)).limit(1);
  const name = input.name?.trim() || phone || input.externalId.split('@')[0] || 'Contato WhatsApp';
  if (existing) {
    const nextName = input.name?.trim() || existing.name;
    const externalIds = { ...existing.externalIds, whatsapp: input.externalId, [`openwa:${input.session.id}`]: input.externalId };
    const metadata = { ...existing.metadata, ...(input.avatarUrl ? { profilePicUrl: input.avatarUrl } : {}) };
    if (existing.name !== nextName || input.avatarUrl || externalIds.whatsapp !== existing.externalIds.whatsapp || existing.externalIds[`openwa:${input.session.id}`] !== input.externalId) {
      const [updated] = await db.update(schema.contacts).set({ name: nextName, externalIds, metadata, ...(phone ? { phone } : {}) }).where(eq(schema.contacts.id, existing.id)).returning();
      return updated!;
    }
    return existing;
  }
  const [created] = await db.insert(schema.contacts).values({
    organizationId: input.session.organizationId,
    clientId: null,
    name,
    phone,
    externalIds: { whatsapp: input.externalId, [`openwa:${input.session.id}`]: input.externalId },
    metadata: input.avatarUrl ? { profilePicUrl: input.avatarUrl } : {},
  }).returning();
  return created!;
}

async function ensureThread(input: {
  session: Session;
  chatId: string;
  kind: string;
  name?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  contact?: Contact | undefined;
}): Promise<Thread> {
  const [existing] = await db.select().from(schema.conversationThreads).where(and(
    eq(schema.conversationThreads.organizationId, input.session.organizationId),
    eq(schema.conversationThreads.whatsappSessionId, input.session.id),
    eq(schema.conversationThreads.externalChatId, input.chatId),
  )).limit(1);
  const isGroup = input.kind === 'group' || input.chatId.endsWith('@g.us');
  const title = input.name || (isGroup ? 'Grupo WhatsApp' : input.contact?.name || input.chatId.split('@')[0] || 'Conversa WhatsApp');
  if (existing) {
    const patch: Partial<Thread> = {};
    if (input.contact && existing.contactId !== input.contact.id) patch.contactId = input.contact.id;
    // O primeiro contato com a conversa pode ter vindo só com o número; o nome chega depois.
    if (input.name && input.name !== existing.title) patch.title = input.name;
    if (Object.keys(patch).length > 0) {
      const [updated] = await db.update(schema.conversationThreads).set(patch).where(eq(schema.conversationThreads.id, existing.id)).returning();
      return updated!;
    }
    return existing;
  }
  let groupId: string | null = null;
  if (isGroup) {
    const [group] = await db.insert(schema.whatsappGroups).values({
      organizationId: input.session.organizationId,
      sessionId: input.session.id,
      externalGroupId: input.chatId,
      name: title,
      avatarUrl: input.avatarUrl ?? null,
      participants: [],
    }).onConflictDoUpdate({
      target: [schema.whatsappGroups.sessionId, schema.whatsappGroups.externalGroupId],
      set: { name: title, ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}) },
    }).returning();
    groupId = group!.id;
  }
  const [created] = await db.insert(schema.conversationThreads).values({
    organizationId: input.session.organizationId,
    clientId: null,
    contactId: isGroup ? null : input.contact?.id ?? null,
    whatsappSessionId: input.session.id,
    groupId,
    externalChatId: input.chatId,
    kind: isGroup ? 'group' : input.kind || 'individual',
    title,
    channel: 'whatsapp',
    status: 'waiting_agency',
    unreadCount: 0,
  }).returning();
  return created!;
}

async function threadAndSender(session: Session, message: OpenwaMessage) {
  const isGroup = message.isGroup || message.kind === 'group' || message.chatId.endsWith('@g.us');
  const contactExternalId = isGroup ? message.author ?? message.from ?? 'desconhecido@lid' : message.chatId;
  const contact = isGroup && message.direction === 'outgoing'
    ? null
    : await ensureContact({
        session,
        externalId: contactExternalId,
        phone: isGroup ? phoneFromMessage(message) : telefoneDoChat(message.chatId) ?? phoneFromMessage(message),
        name: message.contact?.name ?? message.contact?.pushName,
        avatarUrl: message.contact?.profilePicUrl,
      });
  const thread = await ensureThread({
    session,
    chatId: message.chatId,
    kind: isGroup ? 'group' : message.kind,
    // Grupo: o nome vem do sync (a mensagem não traz); passar o id aqui sobrescreveria o título bom.
    name: isGroup ? undefined : contact?.name,
    contact: contact ?? undefined,
  });
  return { thread, senderContact: contact };
}

async function attachMedia(session: Session, row: Message, message: OpenwaMessage): Promise<boolean> {
  if (!message.media || row.attachmentUrl) return false;
  try {
    const bytes = message.media.data
      ? Buffer.from(message.media.data, 'base64')
      : (await gatewayForWhatsappSession(session).downloadMedia(message.chatId, message.id, WHATSAPP_MEDIA_MAX_BYTES)).bytes;
    const saved = await saveWhatsappMedia({
      organizationId: session.organizationId,
      sessionId: session.id,
      bytes,
      mimetype: message.media.mimetype,
      filename: message.media.filename,
      maxBytes: WHATSAPP_MEDIA_MAX_BYTES,
    });
    await db.update(schema.threadMessages).set({
      attachmentUrl: `/inbox/messages/${row.id}/media`,
      attachmentType: message.media.mimetype,
      attachmentFilename: saved.filename,
      attachmentSizeBytes: saved.sizeBytes,
      metadata: { ...row.metadata, storageKey: saved.storageKey },
    }).where(eq(schema.threadMessages.id, row.id));
    return true;
  } catch (error) {
    await db.update(schema.threadMessages).set({
      metadata: { ...row.metadata, mediaError: error instanceof Error ? error.message : String(error) },
    }).where(eq(schema.threadMessages.id, row.id));
    throw error;
  }
}

async function touchThread(thread: Thread, message: OpenwaMessage, created: boolean, countUnread: boolean): Promise<void> {
  const at = occurredAt(message);
  const [current] = await db.select({ lastMessageAt: schema.conversationThreads.lastMessageAt }).from(schema.conversationThreads).where(eq(schema.conversationThreads.id, thread.id)).limit(1);
  const isNewest = !current?.lastMessageAt || at >= current.lastMessageAt;
  const patch: Record<string, unknown> = {};
  if (isNewest) {
    patch.lastMessageAt = at;
    patch.lastMessagePreview = preview(message);
    patch.status = message.direction === 'incoming' ? 'waiting_agency' : 'waiting_client';
  }
  if (created && countUnread && message.direction === 'incoming') {
    patch.unreadCount = sql`${schema.conversationThreads.unreadCount} + 1`;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(schema.conversationThreads).set(patch).where(eq(schema.conversationThreads.id, thread.id));
  }
}

export async function persistOpenwaMessage(input: {
  session: Session;
  message: OpenwaMessage;
  countUnread?: boolean;
  importMedia?: boolean;
}): Promise<{ created: boolean; message: Message; mediaImported: boolean }> {
  const { session, message } = input;
  if (!message.id || !message.chatId) throw new Error('Mensagem OpenWA sem id ou chatId');
  const { thread, senderContact } = await threadAndSender(session, message);
  const values = {
    threadId: thread.id,
    organizationId: session.organizationId,
    whatsappSessionId: session.id,
    providerSessionKey: session.id,
    channel: 'whatsapp' as const,
    direction: message.direction === 'outgoing' ? 'outbound' as const : 'inbound' as const,
    senderContactId: senderContact?.id ?? null,
    senderUserId: null,
    senderExternalId: message.author ?? message.from,
    senderName: message.contact?.name ?? message.contact?.pushName ?? null,
    content: message.body,
    externalMessageId: message.id,
    deliveryStatus: message.direction === 'outgoing'
      ? (['pending', 'sent', 'delivered', 'read', 'failed'].includes(message.status ?? '') ? message.status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed' : 'sent' as const)
      : 'delivered' as const,
    createdAt: occurredAt(message),
    metadata: { type: message.type },
  };
  const [inserted] = await db.insert(schema.threadMessages).values(values).onConflictDoNothing({
    target: [schema.threadMessages.organizationId, schema.threadMessages.channel, schema.threadMessages.providerSessionKey, schema.threadMessages.externalMessageId],
  }).returning();
  let row = inserted;
  if (!row) {
    const [existing] = await db.select().from(schema.threadMessages).where(and(
      eq(schema.threadMessages.organizationId, session.organizationId),
      eq(schema.threadMessages.channel, 'whatsapp'),
      eq(schema.threadMessages.providerSessionKey, session.id),
      eq(schema.threadMessages.externalMessageId, message.id),
    )).limit(1);
    if (!existing) throw new Error('Falha ao conciliar mensagem duplicada');
    row = existing;
  }
  let mediaImported = false;
  if (input.importMedia !== false && message.media) {
    mediaImported = await attachMedia(session, row, message);
  }
  await touchThread(thread, message, Boolean(inserted), input.countUnread === true);
  return { created: Boolean(inserted), message: row, mediaImported };
}

async function updateSyncJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  await db.update(schema.whatsappSyncJobs).set(patch).where(eq(schema.whatsappSyncJobs.id, jobId));
}

export async function createWhatsappSyncJob(session: Session, requestedByUserId: string | null): Promise<{ id: string; created: boolean }> {
  const [existing] = await db.select().from(schema.whatsappSyncJobs).where(and(
    eq(schema.whatsappSyncJobs.sessionId, session.id),
    sql`${schema.whatsappSyncJobs.status} in ('queued','running')`,
  )).orderBy(desc(schema.whatsappSyncJobs.createdAt)).limit(1);
  if (existing) return { id: existing.id, created: false };
  const [job] = await db.insert(schema.whatsappSyncJobs).values({
    organizationId: session.organizationId,
    sessionId: session.id,
    requestedByUserId,
    status: 'queued',
    phase: 'queued',
  }).returning();
  return { id: job!.id, created: true };
}

/** Roda `worker` sobre `items` com no máximo `limit` em paralelo. */
async function inParallel<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Conversas importadas em paralelo. Mais que isso pressiona o WhatsApp Web (histórico é leitura ao vivo). */
const CHATS_EM_PARALELO = 4;
const CONTATOS_EM_PARALELO = 8;

/**
 * Ordem pensada no que a pessoa vê: primeiro as conversas (mais recentes
 * antes, já aparecendo na Inbox enquanto o resto chega), depois as fotos,
 * por último a agenda — que pode ter milhares de entradas e não bloqueia
 * mais a Inbox como bloqueava quando vinha primeiro.
 */
export async function processOpenwaSyncJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, jobId)).limit(1);
  if (!job || ['completed', 'completed_with_errors'].includes(job.status)) return;
  const session = await whatsappSessionById(job.sessionId);
  if (!session) throw new Error('Sessão da sincronização não encontrada');
  const client = gatewayForWhatsappSession(session);
  const failures: Array<{ chatId?: string; message: string }> = [];
  let processedContacts = 0;
  let processedChats = 0;
  let processedMessages = 0;
  let duplicateMessages = 0;
  let importedMedia = 0;
  const progress = () => ({ processedContacts, processedChats, processedMessages, duplicateMessages, importedMedia, failures });
  await updateSyncJob(jobId, { status: 'running', phase: 'chats', startedAt: job.startedAt ?? new Date(), error: null });
  try {
    const chats = (await client.chats())
      .filter((chat) => chat.id && !['status', 'broadcast', 'channel'].includes(chat.kind))
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    const contactByChat = new Map<string, string>();
    await updateSyncJob(jobId, { phase: 'messages' });
    await inParallel(chats, CHATS_EM_PARALELO, async (chat) => {
      try {
        const contact = chat.isGroup ? null : await ensureContact({ session, externalId: chat.id, phone: telefoneDoChat(chat.id), name: chat.name });
        if (contact) contactByChat.set(chat.id, contact.id);
        const thread = await ensureThread({ session, chatId: chat.id, kind: chat.kind, name: chat.name ?? contact?.name, contact: contact ?? undefined });
        if (chat.isGroup) {
          try {
            const details = await client.group(chat.id);
            await db.update(schema.whatsappGroups).set({ name: details.name || chat.name || 'Grupo WhatsApp', participants: details.participants }).where(and(eq(schema.whatsappGroups.sessionId, session.id), eq(schema.whatsappGroups.externalGroupId, chat.id)));
          } catch (error) {
            failures.push({ chatId: chat.id, message: `Participantes indisponíveis: ${reason(error)}` });
          }
        }
        const history = await client.history(chat.id, LIMITE_PADRAO_HISTORICO);
        for (const message of history) {
          try {
            const result = await persistOpenwaMessage({ session, message, importMedia: true });
            if (result.created) processedMessages += 1;
            else duplicateMessages += 1;
            if (result.mediaImported) importedMedia += 1;
          } catch (error) {
            failures.push({ chatId: chat.id, message: reason(error) });
          }
        }
        const patch: Record<string, unknown> = { unreadCount: chat.unreadCount };
        // Conversa sem histórico legível ainda precisa de data e prévia, ou cai no fim da Inbox sem contexto.
        if (history.length === 0 && chat.timestamp) {
          patch.lastMessageAt = sql`coalesce(${schema.conversationThreads.lastMessageAt}, ${new Date(chat.timestamp * 1000)})`;
          if (chat.lastMessage) patch.lastMessagePreview = sql`coalesce(${schema.conversationThreads.lastMessagePreview}, ${chat.lastMessage.slice(0, 500)})`;
        }
        await db.update(schema.conversationThreads).set(patch).where(eq(schema.conversationThreads.id, thread.id));
      } catch (error) {
        const detail = error instanceof OpenwaGatewayError && error.status === 501 ? 'Histórico não disponível neste engine' : reason(error);
        failures.push({ chatId: chat.id, message: detail });
      }
      processedChats += 1;
      await updateSyncJob(jobId, progress());
    });

    await updateSyncJob(jobId, { phase: 'photos' });
    try {
      const pictures = await client.profilePictures(chats.map((chat) => chat.id));
      for (const chat of chats) {
        const url = pictures[chat.id];
        if (!url) continue;
        if (chat.isGroup) {
          await db.update(schema.whatsappGroups).set({ avatarUrl: url }).where(and(eq(schema.whatsappGroups.sessionId, session.id), eq(schema.whatsappGroups.externalGroupId, chat.id)));
        } else {
          const contactId = contactByChat.get(chat.id);
          if (contactId) {
            await db.update(schema.contacts).set({ metadata: sql`coalesce(${schema.contacts.metadata}, '{}'::jsonb) || ${JSON.stringify({ profilePicUrl: url })}::jsonb` }).where(eq(schema.contacts.id, contactId));
          }
        }
      }
    } catch (error) {
      // Foto é enfeite: sem ela a conversa continua inteira.
      failures.push({ message: `Fotos de perfil indisponíveis: ${reason(error)}` });
    }

    await updateSyncJob(jobId, { phase: 'contacts', ...progress() });
    const seen = new Set<string>();
    const contacts = (await client.contacts()).filter((contact) => {
      if (!contact.id || contactByChat.has(contact.id)) return false;
      if (!/@(c\.us|s\.whatsapp\.net|lid)$/.test(contact.id)) return false;
      // A "agenda" do whatsapp-web.js inclui todo número que já cruzou a conta; só entra quem está salvo ou tem nome.
      if (!contact.isMyContact && !contact.name) return false;
      const key = contact.number?.replace(/\D/g, '') || contact.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    let sinceUpdate = 0;
    await inParallel(contacts, CONTATOS_EM_PARALELO, async (contact) => {
      try {
        await ensureContact({ session, externalId: contact.id, phone: contact.number, name: contact.name ?? contact.pushName, avatarUrl: contact.profilePicUrl });
        processedContacts += 1;
      } catch (error) {
        failures.push({ message: reason(error) });
      }
      sinceUpdate += 1;
      if (sinceUpdate >= 50) {
        sinceUpdate = 0;
        await updateSyncJob(jobId, progress());
      }
    });
    processedContacts += contactByChat.size;

    const status = failures.length ? 'completed_with_errors' : 'completed';
    await updateSyncJob(jobId, { status, phase: status, ...progress(), finishedAt: new Date() });
    await db.update(schema.whatsappSessions).set({ lastSyncAt: new Date(), lastError: failures.length ? `${failures.length} pendência(s) na sincronização` : null }).where(eq(schema.whatsappSessions.id, session.id));
  } catch (error) {
    await updateSyncJob(jobId, { status: 'failed', phase: 'failed', error: reason(error), failures, finishedAt: new Date() });
    throw error;
  }
}

export async function registerOpenwaWebhookEvent(input: {
  externalSessionId: string;
  dedupeKey: string;
  eventType: string;
  envelope: Record<string, unknown>;
  rawBody: string;
  signature: string | undefined;
}): Promise<{ id: string; created: boolean } | null> {
  const session = await whatsappSessionByExternalId(input.externalSessionId);
  if (!session) return null;
  const { assinaturaOpenwaValida } = await import('./openwa-signature');
  if (!assinaturaOpenwaValida(input.rawBody, input.signature, whatsappWebhookSecret(session))) {
    throw new Error('INVALID_OPENWA_SIGNATURE');
  }
  const [event] = await db.insert(schema.whatsappWebhookEvents).values({
    dedupeKey: input.dedupeKey,
    organizationId: session.organizationId,
    sessionId: session.id,
    eventType: input.eventType,
    payload: input.envelope,
    status: 'queued',
  }).onConflictDoNothing({ target: schema.whatsappWebhookEvents.dedupeKey }).returning();
  if (event) return { id: event.id, created: true };
  const [existing] = await db.select({ id: schema.whatsappWebhookEvents.id }).from(schema.whatsappWebhookEvents).where(eq(schema.whatsappWebhookEvents.dedupeKey, input.dedupeKey)).limit(1);
  return existing ? { id: existing.id, created: false } : null;
}

export async function processOpenwaWebhookEvent(eventId: string): Promise<{ syncSessionId?: string }> {
  const [event] = await db.select().from(schema.whatsappWebhookEvents).where(eq(schema.whatsappWebhookEvents.id, eventId)).limit(1);
  if (!event || event.status === 'processed' || event.status === 'ignored') return {};
  const session = await whatsappSessionById(event.sessionId);
  if (!session) throw new Error('Sessão do evento não encontrada');
  await db.update(schema.whatsappWebhookEvents).set({ status: 'processing', attempts: event.attempts + 1, error: null }).where(eq(schema.whatsappWebhookEvents.id, eventId));
  try {
    const envelope = event.payload as { data?: unknown };
    const data = (envelope.data && typeof envelope.data === 'object' ? envelope.data : {}) as Record<string, unknown>;
    let syncSessionId: string | undefined;
    if (event.eventType === 'message.received' || event.eventType === 'message.sent') {
      await persistOpenwaMessage({ session, message: normalizeOpenwaMessage(data), countUnread: true, importMedia: true });
    } else if (event.eventType === 'message.ack' || event.eventType === 'message.failed') {
      const externalId = String(data.messageId ?? data.id ?? '');
      const status = event.eventType === 'message.failed' ? 'failed' : String(data.status ?? 'sent');
      if (externalId && ['pending', 'sent', 'delivered', 'read', 'failed'].includes(status)) {
        await db.update(schema.threadMessages).set({ deliveryStatus: status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed' }).where(and(
          eq(schema.threadMessages.organizationId, session.organizationId),
          eq(schema.threadMessages.providerSessionKey, session.id),
          eq(schema.threadMessages.externalMessageId, externalId),
        ));
      }
    } else if (event.eventType === 'message.edited') {
      await db.update(schema.threadMessages).set({ content: typeof data.body === 'string' ? data.body : null }).where(and(
        eq(schema.threadMessages.organizationId, session.organizationId),
        eq(schema.threadMessages.providerSessionKey, session.id),
        eq(schema.threadMessages.externalMessageId, String(data.messageId ?? '')),
      ));
    } else if (event.eventType === 'message.revoked') {
      await db.update(schema.threadMessages).set({ content: null, metadata: { revoked: true } }).where(and(
        eq(schema.threadMessages.organizationId, session.organizationId),
        eq(schema.threadMessages.providerSessionKey, session.id),
        eq(schema.threadMessages.externalMessageId, String(data.revokedId ?? data.id ?? '')),
      ));
    } else if (event.eventType.startsWith('session.')) {
      const status = event.eventType === 'session.disconnected' ? 'disconnected'
        : event.eventType === 'session.reconnect_loop' ? 'reconnecting'
          : event.eventType === 'session.authenticated' ? 'ready'
            : typeof data.status === 'string' ? data.status : session.status;
      await db.update(schema.whatsappSessions).set({
        status,
        phoneNumber: typeof data.phone === 'string' ? data.phone : session.phoneNumber,
        pushName: typeof data.pushName === 'string' ? data.pushName : session.pushName,
        connectedAt: status === 'ready' ? session.connectedAt ?? new Date() : session.connectedAt,
        lastSeenAt: new Date(),
        lastError: typeof data.reason === 'string' ? data.reason : null,
      }).where(eq(schema.whatsappSessions.id, session.id));
      if (status === 'ready') syncSessionId = session.id;
    }
    await db.update(schema.whatsappWebhookEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(schema.whatsappWebhookEvents.id, eventId));
    return syncSessionId ? { syncSessionId } : {};
  } catch (error) {
    await db.update(schema.whatsappWebhookEvents).set({ status: 'failed', error: error instanceof Error ? error.message : String(error), processedAt: new Date() }).where(eq(schema.whatsappWebhookEvents.id, eventId));
    throw error;
  }
}

export async function recoverWhatsappWebhookEvent(eventId: string): Promise<void> {
  await db.update(schema.whatsappWebhookEvents).set({ status: 'queued', error: null, processedAt: null }).where(eq(schema.whatsappWebhookEvents.id, eventId));
}

export async function listPendingWhatsappSyncJobs() {
  return db.select().from(schema.whatsappSyncJobs).where(sql`${schema.whatsappSyncJobs.status} in ('queued','running')`).orderBy(asc(schema.whatsappSyncJobs.createdAt)).limit(100);
}

export async function listPendingWhatsappWebhookEvents() {
  return db.select().from(schema.whatsappWebhookEvents).where(sql`${schema.whatsappWebhookEvents.status} in ('queued','processing')`).orderBy(asc(schema.whatsappWebhookEvents.createdAt)).limit(100);
}
