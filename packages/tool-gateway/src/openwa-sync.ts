import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { OpenwaGatewayError, normalizeOpenwaMessage, type OpenwaMessage } from './openwa-gateway';
import { cachedWhatsappSession, gatewayForWhatsappSession, whatsappSessionById, whatsappWebhookSecret, type WhatsappSessionRow } from './openwa-session-store';
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

/**
 * O WhatsApp passou a identificar contatos por `@lid` (sem número) no lugar de `@c.us` (28/10/2026, medido em
 * produção). Sem o telefone, a mesma pessoa virava um contato e uma conversa novos, e a conversa antiga "parava".
 * A tabela lid→telefone do OpenWA responde por sessão; o cache poupa uma ida ao motor por mensagem.
 */
const LID_TTL_ACHADO_MS = 24 * 3_600_000;
const LID_TTL_SEM_NUMERO_MS = 3_600_000;
const telefonesDeLid = new Map<string, { phone: string | null; at: number }>();
export async function telefoneDoLid(session: Session, lid: string): Promise<string | null> {
  if (!lid.endsWith('@lid')) return null;
  const chave = `${session.id}|${lid}`;
  const hit = telefonesDeLid.get(chave);
  if (hit && Date.now() - hit.at < (hit.phone ? LID_TTL_ACHADO_MS : LID_TTL_SEM_NUMERO_MS)) return hit.phone;
  try {
    const phone = await gatewayForWhatsappSession(session).resolvePhone(lid);
    if (telefonesDeLid.size > 20_000) telefonesDeLid.clear();
    telefonesDeLid.set(chave, { phone, at: Date.now() });
    return phone;
  } catch {
    return null; // motor fora ou lento: segue sem telefone (não guarda, tenta de novo na próxima)
  }
}

/** O número da própria colaboradora nunca é o telefone de um contato. */
function semONumeroDaSessao(session: Session, phone: string | null): string | null {
  const proprio = session.phoneNumber?.replace(/\D/g, '');
  return phone && proprio && phone === proprio ? null : phone;
}

/**
 * Telefone do CONTATO de uma conversa individual. Vem do chat; se o chat é `@lid`, do que o motor informou sobre o
 * remetente (só em mensagem RECEBIDA) ou da tabela lid→telefone. Nunca do `from` de uma mensagem ENVIADA: ali o
 * remetente é a própria colaboradora, e o contato da conversa virava ela mesma.
 */
async function telefoneDoContatoIndividual(session: Session, message: OpenwaMessage): Promise<string | null> {
  const doChat = telefoneDoChat(message.chatId);
  if (doChat) return semONumeroDaSessao(session, doChat);
  const informado = message.direction === 'incoming' ? message.senderPhone?.replace(/\D/g, '') || null : null;
  if (informado) return semONumeroDaSessao(session, informado);
  return semONumeroDaSessao(session, await telefoneDoLid(session, message.chatId));
}

/** Telefone de quem escreveu num grupo (só mensagem recebida). */
async function telefoneDoAutor(session: Session, message: OpenwaMessage): Promise<string | null> {
  const direto = phoneFromMessage(message);
  if (direto) return semONumeroDaSessao(session, direto);
  const autor = message.author ?? message.from;
  return autor ? semONumeroDaSessao(session, await telefoneDoLid(session, autor)) : null;
}

/**
 * Uma criação por vez para a mesma chave. O worker processa 12 eventos em paralelo e o sync mais 2+8; sem isto, duas
 * mensagens da mesma pessoa no mesmo instante criavam dois contatos (não há índice único em `contacts`).
 */
const travas = new Map<string, Promise<unknown>>();
async function umPorVez<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = travas.get(chave) ?? Promise.resolve();
  const atual = anterior.catch(() => undefined).then(fn);
  travas.set(chave, atual);
  try {
    return await atual;
  } finally {
    if (travas.get(chave) === atual) travas.delete(chave);
  }
}

/** `@lid` e `@c.us` ficam em chaves separadas do contato: um não apaga o outro. */
function chaveDoId(externalId: string): 'whatsapp' | 'whatsappLid' {
  return externalId.endsWith('@lid') ? 'whatsappLid' : 'whatsapp';
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
  const phone = semONumeroDaSessao(input.session, input.phone?.replace(/\D/g, '') || null);
  return umPorVez(`contato|${input.session.organizationId}|${phone ?? input.externalId}`, async () => {
    const porId = or(
      sql`${schema.contacts.externalIds}->>'whatsapp' = ${input.externalId}`,
      sql`${schema.contacts.externalIds}->>'whatsappLid' = ${input.externalId}`,
    );
    const identity = phone ? or(eq(schema.contacts.phone, phone), porId) : porId;
    // O mais antigo primeiro: havendo duplicados de antes, tudo converge para o original.
    const [existing] = await db.select().from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, input.session.organizationId), identity))
      .orderBy(asc(schema.contacts.createdAt)).limit(1);
    const name = input.name?.trim() || phone || input.externalId.split('@')[0] || 'Contato WhatsApp';
    const chave = chaveDoId(input.externalId);
    if (existing) {
      const nextName = input.name?.trim() || existing.name;
      const externalIds = { ...existing.externalIds, [chave]: input.externalId, [`openwa:${input.session.id}`]: input.externalId };
      const metadata = { ...existing.metadata, ...(input.avatarUrl ? { profilePicUrl: input.avatarUrl } : {}) };
      // Telefone só entra onde falta, ou corrige o número da própria colaboradora gravado pelo defeito antigo.
      const proprio = input.session.phoneNumber?.replace(/\D/g, '');
      const corrigeTelefone = phone && (!existing.phone || (proprio && existing.phone === proprio)) && existing.phone !== phone;
      if (existing.name !== nextName || input.avatarUrl || existing.externalIds[chave] !== input.externalId || existing.externalIds[`openwa:${input.session.id}`] !== input.externalId || corrigeTelefone) {
        const [updated] = await db.update(schema.contacts).set({ name: nextName, externalIds, metadata, ...(corrigeTelefone ? { phone } : {}) }).where(eq(schema.contacts.id, existing.id)).returning();
        return updated!;
      }
      return existing;
    }
    const [created] = await db.insert(schema.contacts).values({
      organizationId: input.session.organizationId,
      clientId: null,
      name,
      phone,
      externalIds: { [chave]: input.externalId, [`openwa:${input.session.id}`]: input.externalId },
      metadata: input.avatarUrl ? { profilePicUrl: input.avatarUrl } : {},
    }).returning();
    return created!;
  });
}

async function ensureThread(input: {
  session: Session;
  chatId: string;
  kind: string;
  name?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  contact?: Contact | undefined;
}): Promise<Thread> {
  const isGroup = input.kind === 'group' || input.chatId.endsWith('@g.us');
  return umPorVez(`conversa|${input.session.id}|${!isGroup && input.contact ? input.contact.id : input.chatId}`, () => ensureThreadSemTrava(input, isGroup));
}

async function ensureThreadSemTrava(input: Parameters<typeof ensureThread>[0], isGroup: boolean): Promise<Thread> {
  let [existing] = await db.select().from(schema.conversationThreads).where(and(
    eq(schema.conversationThreads.organizationId, input.session.organizationId),
    eq(schema.conversationThreads.whatsappSessionId, input.session.id),
    eq(schema.conversationThreads.externalChatId, input.chatId),
  )).orderBy(asc(schema.conversationThreads.createdAt)).limit(1);
  // A mesma pessoa chegando por outro endereço (`@lid` no lugar de `@c.us`): continua a conversa que já existe, em
  // vez de abrir outra e deixar a antiga parada. O endereço guardado não muda (é por ele que a Inbox responde).
  if (!existing && !isGroup && input.contact) {
    [existing] = await db.select().from(schema.conversationThreads).where(and(
      eq(schema.conversationThreads.organizationId, input.session.organizationId),
      eq(schema.conversationThreads.whatsappSessionId, input.session.id),
      eq(schema.conversationThreads.contactId, input.contact.id),
      sql`${schema.conversationThreads.kind} <> 'group'`,
    )).orderBy(asc(schema.conversationThreads.createdAt)).limit(1);
  }
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
    // Contato já vinculado a um cliente (pela Inbox): a conversa nova nasce no cliente.
    clientId: isGroup ? null : input.contact?.clientId ?? null,
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

/**
 * Conversa e contato de cada chat em memória por 5 min. O banco fica nos EUA
 * (~130 ms por ida a partir da VPS), e cada mensagem recebida resolvia os dois
 * de novo — metade do tempo entre o WhatsApp e a Inbox (medido: 2,4 s p50).
 * Só ids e o necessário para gravar; nome e foto se atualizam no sync.
 */
const HOT_TTL_MS = 5 * 60_000;
const hotThreads = new Map<string, { thread: Thread; contact: Contact | null; at: number }>();

function hotKey(session: Session, message: OpenwaMessage): string {
  return `${session.id}|${message.chatId}|${message.isGroup ? message.author ?? message.from ?? '' : ''}|${message.direction}`;
}

async function threadAndSender(session: Session, message: OpenwaMessage) {
  const key = hotKey(session, message);
  const hit = hotThreads.get(key);
  if (hit && Date.now() - hit.at < HOT_TTL_MS) return { thread: hit.thread, senderContact: hit.contact };
  const resolved = await resolveThreadAndSender(session, message);
  if (hotThreads.size > 5000) hotThreads.clear();
  hotThreads.set(key, { thread: resolved.thread, contact: resolved.senderContact, at: Date.now() });
  return resolved;
}

async function resolveThreadAndSender(session: Session, message: OpenwaMessage) {
  const isGroup = message.isGroup || message.kind === 'group' || message.chatId.endsWith('@g.us');
  const contactExternalId = isGroup ? message.author ?? message.from ?? 'desconhecido@lid' : message.chatId;
  const contact = isGroup && message.direction === 'outgoing'
    ? null
    : await ensureContact({
        session,
        externalId: contactExternalId,
        phone: isGroup ? await telefoneDoAutor(session, message) : await telefoneDoContatoIndividual(session, message),
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
    // Só falha passageira (rede, 429, 5xx) merece repetir o evento. Mídia que o
    // OpenWA não guardou (404 "No media stored", acima do limite) nunca vai
    // aparecer: repetir só deixava a mensagem — já gravada — marcada como erro.
    if (error instanceof OpenwaGatewayError && error.retryable) throw error;
    return false;
  }
}

/** Uma ida ao banco: a própria UPDATE decide se esta é a mensagem mais nova. */
async function touchThread(thread: Thread, message: OpenwaMessage, created: boolean, countUnread: boolean): Promise<void> {
  const at = occurredAt(message).toISOString();
  const newest = sql`(${schema.conversationThreads.lastMessageAt} is null or ${schema.conversationThreads.lastMessageAt} <= ${at}::timestamptz)`;
  await db.update(schema.conversationThreads).set({
    lastMessageAt: sql`case when ${newest} then ${at}::timestamptz else ${schema.conversationThreads.lastMessageAt} end`,
    lastMessagePreview: sql`case when ${newest} then ${preview(message)} else ${schema.conversationThreads.lastMessagePreview} end`,
    status: sql`case when ${newest} then ${message.direction === 'incoming' ? 'waiting_agency' : 'waiting_client'} else ${schema.conversationThreads.status} end`,
    ...(created && countUnread && message.direction === 'incoming' ? { unreadCount: sql`${schema.conversationThreads.unreadCount} + 1` } : {}),
  }).where(eq(schema.conversationThreads.id, thread.id));
}

// Função, não constante: lido no import, quebraria quem simula o schema sem esta tabela.
function messageConflictTarget() {
  return [schema.threadMessages.organizationId, schema.threadMessages.channel, schema.threadMessages.providerSessionKey, schema.threadMessages.externalMessageId];
}

function messageValues(session: Session, thread: Thread, senderContact: Contact | null, message: OpenwaMessage) {
  return {
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
  const values = messageValues(session, thread, senderContact, message);
  // Enviada pela Inbox e ainda sem id externo (a entrega roda em segundo
  // plano, ver apps/api/src/communications/openwa-send.ts): a confirmação do
  // WhatsApp preenche a pendente em vez de virar uma segunda bolha igual.
  if (message.direction === 'outgoing') {
    const [pending] = await db.update(schema.threadMessages).set({ externalMessageId: message.id, deliveryStatus: values.deliveryStatus }).where(and(
      eq(schema.threadMessages.threadId, thread.id),
      eq(schema.threadMessages.direction, 'outbound'),
      eq(schema.threadMessages.deliveryStatus, 'pending'),
      sql`${schema.threadMessages.externalMessageId} is null`,
      sql`${schema.threadMessages.createdAt} > now() - interval '10 minutes'`,
      message.body ? eq(schema.threadMessages.content, message.body) : sql`${schema.threadMessages.attachmentType} is not null`,
      sql`${schema.threadMessages.id} = (select m.id from thread_messages m where m.thread_id = ${thread.id} and m.direction = 'outbound' and m.delivery_status = 'pending' and m.external_message_id is null order by m.created_at limit 1)`,
    )).returning();
    if (pending) return { created: false, message: pending, mediaImported: false };
  }
  const [inserted] = await db.insert(schema.threadMessages).values(values).onConflictDoNothing({ target: messageConflictTarget() }).returning();
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

/**
 * Histórico de uma conversa gravado de uma vez: um INSERT para todas as
 * mensagens e um UPDATE na conversa, no lugar de 5–7 idas ao banco POR
 * mensagem do caminho do webhook. Conversa e contato já vêm resolvidos pelo
 * sync; em grupo, o remetente de cada mensagem passa pelo `senderCache` do job
 * para cada autor custar uma consulta só. Mensagem com mídia embutida segue o
 * caminho normal (precisa baixar e anexar).
 */
async function persistHistoryBatch(input: {
  session: Session;
  thread: Thread;
  contact: Contact | null;
  messages: OpenwaMessage[];
  senderCache: Map<string, Promise<Contact>>;
}): Promise<{ created: number; duplicates: number; mediaImported: number }> {
  const { session, thread } = input;
  const plain = input.messages.filter((message) => message.id && message.chatId && !message.media);
  let created = 0;
  let duplicates = 0;
  let mediaImported = 0;
  for (const message of input.messages.filter((m) => m.media)) {
    const result = await persistOpenwaMessage({ session, message, importMedia: true });
    if (result.created) created += 1; else duplicates += 1;
    if (result.mediaImported) mediaImported += 1;
  }
  if (plain.length === 0) return { created, duplicates, mediaImported };
  const isGroup = thread.kind === 'group';
  const rows = await Promise.all(plain.map(async (message) => {
    let sender: Contact | null = input.contact;
    if (isGroup) {
      if (message.direction === 'outgoing') sender = null;
      else {
        const externalId = message.author ?? message.from ?? 'desconhecido@lid';
        let pending = input.senderCache.get(externalId);
        if (!pending) {
          pending = telefoneDoAutor(session, message).then((phone) => ensureContact({ session, externalId, phone, name: message.contact?.name ?? message.contact?.pushName }));
          input.senderCache.set(externalId, pending);
        }
        sender = await pending;
      }
    }
    return messageValues(session, thread, sender, message);
  }));
  const inserted = await db.insert(schema.threadMessages).values(rows).onConflictDoNothing({ target: messageConflictTarget() }).returning({ id: schema.threadMessages.id });
  created += inserted.length;
  duplicates += plain.length - inserted.length;
  const newest = plain.reduce((a, b) => (occurredAt(b) >= occurredAt(a) ? b : a));
  const at = occurredAt(newest);
  await db.update(schema.conversationThreads).set({
    lastMessageAt: at,
    lastMessagePreview: preview(newest),
    status: newest.direction === 'incoming' ? 'waiting_agency' : 'waiting_client',
  }).where(and(
    eq(schema.conversationThreads.id, thread.id),
    sql`(${schema.conversationThreads.lastMessageAt} is null or ${schema.conversationThreads.lastMessageAt} <= ${at.toISOString()}::timestamptz)`,
  ));
  return { created, duplicates, mediaImported };
}

async function updateSyncJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  await db.update(schema.whatsappSyncJobs).set(patch).where(eq(schema.whatsappSyncJobs.id, jobId));
}

/**
 * Um sync por sessão de cada vez. Checar e inserir em passos separados deixava
 * o botão "Sincronizar agora" e a conferência de status criarem dois jobs no
 * mesmo instante (visto em produção: dois "running" idênticos, carga dobrada
 * no navegador do WhatsApp). A trava transacional por sessão serializa os dois.
 */
export async function createWhatsappSyncJob(session: Session, requestedByUserId: string | null): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`whatsapp-sync:${session.id}`}))`);
    const [existing] = await tx.select().from(schema.whatsappSyncJobs).where(and(
      eq(schema.whatsappSyncJobs.sessionId, session.id),
      sql`${schema.whatsappSyncJobs.status} in ('queued','running')`,
    )).orderBy(desc(schema.whatsappSyncJobs.createdAt)).limit(1);
    // Um sync que não anda há 10 min (worker reiniciado no meio, fila perdeu o
    // job) não pode prender a sessão: sem isso a tela ficava em "Sincronizando"
    // e o botão bloqueado para sempre. O próprio job, se voltar, se aposenta
    // ao ver este mais novo.
    const stale = existing && Date.now() - existing.updatedAt.getTime() > 10 * 60_000;
    if (existing && !stale) return { id: existing.id, created: false };
    if (existing) {
      await tx.update(schema.whatsappSyncJobs).set({ status: 'superseded', phase: 'superseded', error: 'Interrompido; substituído por um sync novo.', finishedAt: new Date() }).where(eq(schema.whatsappSyncJobs.id, existing.id));
    }
    const [job] = await tx.insert(schema.whatsappSyncJobs).values({
      organizationId: session.organizationId,
      sessionId: session.id,
      requestedByUserId,
      status: 'queued',
      phase: 'queued',
    }).returning();
    return { id: job!.id, created: true };
  });
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

/**
 * Conversas importadas em paralelo. O histórico é leitura ao vivo no navegador
 * do WhatsApp Web; com 4 em paralelo o Chrome passou de 2 GB e foi morto pelo
 * kernel no primeiro sync real (19/10/2026).
 */
const CHATS_EM_PARALELO = 2;
const CONTATOS_EM_PARALELO = 8;

/**
 * Só as conversas mais recentes abrem o histórico no navegador. Medido em
 * produção (19/10/2026): ler o histórico das 1000 conversas de uma conta
 * grande levou o Chrome dessa sessão sozinho a 2 GB e o kernel o matou mesmo
 * com 4 GB no container. As demais entram com nome, data e prévia da lista de
 * chats; mensagem nova em qualquer uma chega na hora pelo webhook.
 */
const CONVERSAS_COM_HISTORICO = 200;

/**
 * Ordem pensada no que a pessoa vê: primeiro as conversas (mais recentes
 * antes, já aparecendo na Inbox enquanto o resto chega), depois as fotos,
 * por último a agenda — que pode ter milhares de entradas e não bloqueia
 * mais a Inbox como bloqueava quando vinha primeiro.
 */
/**
 * Há outro sync mais novo para a mesma sessão? Então este se aposenta: dois
 * jobs martelando o mesmo navegador só dobram a carga (visto em produção: 3
 * syncs simultâneos da mesma sessão, criados antes da trava de criação). O
 * mais novo vence porque é ele que a tela mostra como "o sync".
 */
async function supersededBy(job: { id: string; sessionId: string; createdAt: Date }): Promise<boolean> {
  const [newer] = await db.select({ id: schema.whatsappSyncJobs.id }).from(schema.whatsappSyncJobs).where(and(
    eq(schema.whatsappSyncJobs.sessionId, job.sessionId),
    sql`${schema.whatsappSyncJobs.id} <> ${job.id}`,
    sql`${schema.whatsappSyncJobs.status} in ('queued','running')`,
    // Comparação no banco, com a precisão de microssegundos dele: dois jobs do
    // mesmo milissegundo (visto em produção) viravam "mais novo" um do outro
    // quando a data passava pelo Date do JS, e os dois se aposentavam.
    sql`(${schema.whatsappSyncJobs.createdAt}, ${schema.whatsappSyncJobs.id}) > (select j.created_at, j.id from whatsapp_sync_jobs j where j.id = ${job.id})`,
  )).limit(1);
  return Boolean(newer);
}

class SupersededSync extends Error {}

/** OpenWA ocupado/lento ou WhatsApp Web ainda carregando: vale esperar e tentar de novo. */
function transient(error: unknown): boolean {
  if (error instanceof OpenwaGatewayError) return error.retryable || error.status === 409 || error.status === 400;
  return false;
}

/**
 * `finalAttempt` vem do worker: enquanto houver nova tentativa agendada, a
 * falha passageira não aparece como "Erro de sincronização" na tela — o job
 * volta para a fila com uma explicação que a pessoa entende.
 */
export async function processOpenwaSyncJob(jobId: string, options: { finalAttempt?: boolean; onProgress?: (ownerUserId: string) => void } = {}): Promise<{ firstForSession: boolean; sessionId?: string }> {
  const [job] = await db.select().from(schema.whatsappSyncJobs).where(eq(schema.whatsappSyncJobs.id, jobId)).limit(1);
  if (!job || ['completed', 'completed_with_errors', 'superseded'].includes(job.status)) return { firstForSession: false };
  if (await supersededBy(job)) {
    await updateSyncJob(jobId, { status: 'superseded', phase: 'superseded', finishedAt: new Date() });
    return { firstForSession: false };
  }
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
    const senderCache = new Map<string, Promise<Contact>>();
    await updateSyncJob(jobId, { phase: 'messages' });
    await inParallel(chats, CHATS_EM_PARALELO, async (chat) => {
      try {
        const contact = chat.isGroup ? null : await ensureContact({ session, externalId: chat.id, phone: telefoneDoChat(chat.id) ?? await telefoneDoLid(session, chat.id), name: chat.name });
        if (contact) contactByChat.set(chat.id, contact.id);
        const thread = await ensureThread({ session, chatId: chat.id, kind: chat.kind, name: chat.name ?? contact?.name, contact: contact ?? undefined });
        // Data e prévia da lista de chats ANTES do histórico: se o histórico falhar
        // ou vier vazio, a conversa já entra na Inbox na posição certa.
        if (chat.timestamp) {
          const at = new Date(chat.timestamp * 1000).toISOString();
          await db.update(schema.conversationThreads).set({
            lastMessageAt: sql`greatest(${schema.conversationThreads.lastMessageAt}, ${at}::timestamptz)`,
            ...(chat.lastMessage ? { lastMessagePreview: sql`case when ${schema.conversationThreads.lastMessageAt} is null or ${schema.conversationThreads.lastMessageAt} <= ${at}::timestamptz then ${chat.lastMessage.slice(0, 500)} else ${schema.conversationThreads.lastMessagePreview} end` } : {}),
          }).where(eq(schema.conversationThreads.id, thread.id));
        }
        const recente = chats.indexOf(chat) < CONVERSAS_COM_HISTORICO;
        if (chat.isGroup && recente) {
          try {
            const details = await client.group(chat.id);
            await db.update(schema.whatsappGroups).set({ name: details.name || chat.name || 'Grupo WhatsApp', participants: details.participants }).where(and(eq(schema.whatsappGroups.sessionId, session.id), eq(schema.whatsappGroups.externalGroupId, chat.id)));
          } catch (error) {
            failures.push({ chatId: chat.id, message: `Participantes indisponíveis: ${reason(error)}` });
          }
        }
        const history = recente ? await client.history(chat.id, LIMITE_PADRAO_HISTORICO) : [];
        try {
          const result = await persistHistoryBatch({ session, thread, contact, messages: history, senderCache });
          processedMessages += result.created;
          duplicateMessages += result.duplicates;
          importedMedia += result.mediaImported;
        } catch (error) {
          failures.push({ chatId: chat.id, message: reason(error) });
        }
        await db.update(schema.conversationThreads).set({ unreadCount: chat.unreadCount, whatsappArchived: chat.archived, whatsappPinned: chat.pinned }).where(eq(schema.conversationThreads.id, thread.id));
      } catch (error) {
        const detail = error instanceof OpenwaGatewayError && error.status === 501 ? 'Histórico não disponível neste engine' : reason(error);
        failures.push({ chatId: chat.id, message: detail });
      }
      processedChats += 1;
      await updateSyncJob(jobId, progress());
      // A Inbox se monta enquanto o sync anda: aviso a cada 10 conversas.
      if (processedChats % 10 === 0) {
        options.onProgress?.(session.ownerUserId);
        if (await supersededBy(job)) throw new SupersededSync();
      }
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
    options.onProgress?.(session.ownerUserId);
    return { firstForSession: !session.lastSyncAt, sessionId: session.id };
  } catch (error) {
    if (error instanceof SupersededSync) {
      await updateSyncJob(jobId, { status: 'superseded', phase: 'superseded', ...progress(), finishedAt: new Date() });
      return { firstForSession: false };
    }
    if (transient(error) && options.finalAttempt === false) {
      await updateSyncJob(jobId, { status: 'queued', phase: 'queued', error: 'O WhatsApp ainda está carregando as conversas do celular. Tentando de novo em instantes.', failures });
    } else {
      await updateSyncJob(jobId, { status: 'failed', phase: 'failed', error: reason(error), failures, finishedAt: new Date() });
    }
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
}): Promise<{ id: string; created: boolean; ownerUserId: string } | null> {
  const session = await cachedWhatsappSession('external', input.externalSessionId);
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
  if (event) return { id: event.id, created: true, ownerUserId: session.ownerUserId };
  const [existing] = await db.select({ id: schema.whatsappWebhookEvents.id }).from(schema.whatsappWebhookEvents).where(eq(schema.whatsappWebhookEvents.dedupeKey, input.dedupeKey)).limit(1);
  return existing ? { id: existing.id, created: false, ownerUserId: session.ownerUserId } : null;
}

export async function processOpenwaWebhookEvent(eventId: string): Promise<{ syncSessionId?: string; ownerUserId?: string; threadId?: string; inboxChanged?: boolean }> {
  const [event] = await db.select().from(schema.whatsappWebhookEvents).where(eq(schema.whatsappWebhookEvents.id, eventId)).limit(1);
  if (!event || event.status === 'processed' || event.status === 'ignored') return {};
  const session = event.eventType.startsWith('message.') ? await cachedWhatsappSession('id', event.sessionId) : await whatsappSessionById(event.sessionId);
  if (!session) throw new Error('Sessão do evento não encontrada');
  await db.update(schema.whatsappWebhookEvents).set({ status: 'processing', attempts: event.attempts + 1, error: null }).where(eq(schema.whatsappWebhookEvents.id, eventId));
  try {
    const envelope = event.payload as { data?: unknown };
    const data = (envelope.data && typeof envelope.data === 'object' ? envelope.data : {}) as Record<string, unknown>;
    let syncSessionId: string | undefined;
    let threadId: string | undefined;
    // Toda mudança de mensagem avisa a Inbox em tempo real (ver worker).
    const inboxChanged = event.eventType.startsWith('message.');
    if (event.eventType === 'message.received' || event.eventType === 'message.sent') {
      const persisted = await persistOpenwaMessage({ session, message: normalizeOpenwaMessage(data), countUnread: true, importMedia: true });
      threadId = persisted.message.threadId;
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
    return { ...(syncSessionId ? { syncSessionId } : {}), ownerUserId: session.ownerUserId, ...(threadId ? { threadId } : {}), inboxChanged };
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
