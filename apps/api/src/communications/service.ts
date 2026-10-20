import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  ConnectorConfigError,
  gatewayForWhatsappSession,
  readWhatsappMedia,
  resolveCommunicationProvider,
  saveWhatsappMedia,
  senderForWhatsappSession,
  whatsappSessionById,
  WHATSAPP_MEDIA_MAX_BYTES,
} from '@desigual-os/tool-gateway';
import { recordOperationalEvent } from '@desigual-os/orchestrator';
import type { ConversationStatus } from '@desigual-os/types';

/**
 * communications/service.ts — domínio de comunicação externa (P1-A/C,
 * 06/10/2026). Sem lógica de HTTP aqui — rotas (routes.ts) e webhook
 * chamam estas funções; isto é o que faz "criar demanda manual" e "receber
 * webhook do WhatsApp" convergirem pro MESMO caminho de dado.
 */

type ThreadRow = typeof schema.conversationThreads.$inferSelect;
type MessageRow = typeof schema.threadMessages.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;

export interface ListThreadsFilter {
  organizationId: string;
  status?: ConversationStatus | undefined;
  /** `true` = só as atribuídas a `callerId`; `false` = só não atribuídas; ausente = todas visíveis. */
  assignedToSelf?: boolean | undefined;
  unassignedOnly?: boolean | undefined;
  /** 'archived' = só as arquivadas no WhatsApp; padrão = como a lista principal do celular, sem elas. */
  view?: 'active' | 'archived' | undefined;
  /** Busca no banco por nome, número ou prévia — não só no que a tela já carregou. */
  q?: string | undefined;
  callerId: string;
  limit: number;
  offset: number;
}

/**
 * Cada colaborador conecta o PRÓPRIO WhatsApp: conversa que veio por uma
 * sessão OpenWA só existe para o dono daquela sessão — nem master vê o
 * WhatsApp do colega pela Inbox. Conversas sem sessão (Evolution/W-API, da
 * empresa) continuam visíveis para a equipe, como antes.
 */
export function threadVisibleTo(viewerId: string) {
  return sql`(${schema.conversationThreads.whatsappSessionId} is null or exists (
    select 1 from ${schema.whatsappSessions}
    where ${schema.whatsappSessions.id} = ${schema.conversationThreads.whatsappSessionId}
      and ${schema.whatsappSessions.ownerUserId} = ${viewerId}
  ))`;
}

export async function listThreads(filter: ListThreadsFilter) {
  const condicoes = [eq(schema.conversationThreads.organizationId, filter.organizationId), threadVisibleTo(filter.callerId)];
  if (filter.status) condicoes.push(eq(schema.conversationThreads.status, filter.status));
  if (filter.assignedToSelf) condicoes.push(eq(schema.conversationThreads.assignedToUserId, filter.callerId));
  if (filter.unassignedOnly) condicoes.push(isNull(schema.conversationThreads.assignedToUserId));
  condicoes.push(eq(schema.conversationThreads.whatsappArchived, filter.view === 'archived'));
  if (filter.q) {
    const termo = `%${filter.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const digitos = filter.q.replace(/\D/g, '');
    condicoes.push(sql`(${schema.conversationThreads.title} ilike ${termo} or ${schema.contacts.name} ilike ${termo} or ${schema.whatsappGroups.name} ilike ${termo} or ${schema.conversationThreads.lastMessagePreview} ilike ${termo}${digitos.length >= 4 ? sql` or ${schema.contacts.phone} like ${`%${digitos}%`}` : sql``})`);
  }

  const linhas = await db
    .select({
      id: schema.conversationThreads.id,
      clientId: schema.conversationThreads.clientId,
      clientName: schema.clients.name,
      contactId: schema.conversationThreads.contactId,
      contactName: schema.contacts.name,
      contactPhone: schema.contacts.phone,
      contactMetadata: schema.contacts.metadata,
      whatsappSessionId: schema.conversationThreads.whatsappSessionId,
      groupId: schema.conversationThreads.groupId,
      externalChatId: schema.conversationThreads.externalChatId,
      kind: schema.conversationThreads.kind,
      title: schema.conversationThreads.title,
      unreadCount: schema.conversationThreads.unreadCount,
      lastMessagePreview: schema.conversationThreads.lastMessagePreview,
      groupName: schema.whatsappGroups.name,
      groupAvatarUrl: schema.whatsappGroups.avatarUrl,
      channel: schema.conversationThreads.channel,
      status: schema.conversationThreads.status,
      assignedToUserId: schema.conversationThreads.assignedToUserId,
      lastMessageAt: schema.conversationThreads.lastMessageAt,
      whatsappArchived: schema.conversationThreads.whatsappArchived,
      whatsappPinned: schema.conversationThreads.whatsappPinned,
    })
    .from(schema.conversationThreads)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.conversationThreads.contactId))
    .leftJoin(schema.whatsappGroups, eq(schema.whatsappGroups.id, schema.conversationThreads.groupId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.conversationThreads.clientId))
    .where(and(...condicoes))
    // Postgres põe NULL primeiro em DESC: conversa ainda sem data subia para o topo
    // e empurrava as de hoje para baixo.
    // Fixadas no topo, como no WhatsApp; dentro de cada grupo, a mais recente primeiro.
    .orderBy(desc(schema.conversationThreads.whatsappPinned), sql`${schema.conversationThreads.lastMessageAt} desc nulls last`, desc(schema.conversationThreads.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);

  return linhas;
}

export async function getThread(organizationId: string, threadId: string, viewerId?: string) {
  const [linha] = await db
    .select({
      id: schema.conversationThreads.id,
      organizationId: schema.conversationThreads.organizationId,
      clientId: schema.conversationThreads.clientId,
      clientName: schema.clients.name,
      contactId: schema.conversationThreads.contactId,
      contactName: schema.contacts.name,
      contactPhone: schema.contacts.phone,
      contactMetadata: schema.contacts.metadata,
      whatsappSessionId: schema.conversationThreads.whatsappSessionId,
      groupId: schema.conversationThreads.groupId,
      externalChatId: schema.conversationThreads.externalChatId,
      kind: schema.conversationThreads.kind,
      title: schema.conversationThreads.title,
      unreadCount: schema.conversationThreads.unreadCount,
      lastMessagePreview: schema.conversationThreads.lastMessagePreview,
      groupName: schema.whatsappGroups.name,
      groupAvatarUrl: schema.whatsappGroups.avatarUrl,
      channel: schema.conversationThreads.channel,
      status: schema.conversationThreads.status,
      assignedToUserId: schema.conversationThreads.assignedToUserId,
      lastMessageAt: schema.conversationThreads.lastMessageAt,
    })
    .from(schema.conversationThreads)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.conversationThreads.contactId))
    .leftJoin(schema.whatsappGroups, eq(schema.whatsappGroups.id, schema.conversationThreads.groupId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.conversationThreads.clientId))
    .where(and(
      eq(schema.conversationThreads.id, threadId),
      eq(schema.conversationThreads.organizationId, organizationId),
      ...(viewerId ? [threadVisibleTo(viewerId)] : []),
    ));
  return linha ?? null;
}

export async function listMessages(organizationId: string, threadId: string, limit: number, offset: number): Promise<MessageRow[]> {
  return db
    .select()
    .from(schema.threadMessages)
    .where(and(eq(schema.threadMessages.threadId, threadId), eq(schema.threadMessages.organizationId, organizationId)))
    .orderBy(asc(schema.threadMessages.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * As mensagens MAIS RECENTES de uma conversa visível para quem pede, numa
 * ida ao banco só (permissão e mensagens juntas; antes eram duas, ~125 ms cada
 * até us-east-1). Devolve null se a conversa não existe para essa pessoa.
 *
 * `offset` conta a partir da mais nova: 0 = a página atual, 50 = a anterior.
 * A versão antiga ordenava da mais velha e cortava em 50 — conversa com mais de
 * 50 mensagens abria sem as últimas.
 */
export async function listRecentMessagesVisible(organizationId: string, threadId: string, viewerId: string, limit: number, offset: number): Promise<MessageRow[] | null> {
  const rows = await db
    .select({ thread: schema.conversationThreads.id, message: schema.threadMessages })
    .from(schema.conversationThreads)
    .leftJoin(schema.threadMessages, sql`${schema.threadMessages.id} in (
      select m.id from thread_messages m
      where m.thread_id = ${schema.conversationThreads.id} and m.organization_id = ${organizationId}
      order by m.created_at desc limit ${limit} offset ${offset}
    )`)
    .where(and(
      eq(schema.conversationThreads.id, threadId),
      eq(schema.conversationThreads.organizationId, organizationId),
      threadVisibleTo(viewerId),
    ));
  if (rows.length === 0) return null;
  return rows.flatMap((row) => (row.message ? [row.message] : [])).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Vincula a conversa a um cliente (ou desvincula, com null). O CONTATO também
 * passa a ser do cliente, e as outras conversas dele vão junto: é a mesma
 * pessoa, e as próximas conversas dela já nascem vinculadas (ensureThread lê
 * contacts.client_id). Grupo não tem contato — só a conversa muda.
 * Quem chama garante que o cliente é da empresa (clientBelongsToTenant).
 */
export async function linkThreadToClient(organizationId: string, threadId: string, clientId: string | null): Promise<ThreadRow | null> {
  return db.transaction(async (tx) => {
    const [atualizada] = await tx.update(schema.conversationThreads).set({ clientId })
      .where(and(eq(schema.conversationThreads.id, threadId), eq(schema.conversationThreads.organizationId, organizationId)))
      .returning();
    if (!atualizada) return null;
    if (atualizada.contactId) {
      await tx.update(schema.contacts).set({ clientId }).where(and(eq(schema.contacts.id, atualizada.contactId), eq(schema.contacts.organizationId, organizationId)));
      await tx.update(schema.conversationThreads).set({ clientId }).where(and(
        eq(schema.conversationThreads.contactId, atualizada.contactId),
        eq(schema.conversationThreads.organizationId, organizationId),
      ));
    }
    return atualizada;
  });
}

export async function assignThread(organizationId: string, threadId: string, assignedToUserId: string | null): Promise<ThreadRow | null> {
  const [atualizado] = await db
    .update(schema.conversationThreads)
    .set({ assignedToUserId })
    .where(and(eq(schema.conversationThreads.id, threadId), eq(schema.conversationThreads.organizationId, organizationId)))
    .returning();
  return atualizado ?? null;
}

export type SendOutboundResult =
  | { ok: true; message: MessageRow }
  | { ok: false; reason: 'thread_not_found' }
  | { ok: false; reason: 'no_provider_configured' }
  | { ok: false; reason: 'provider_error'; detail: string };

/**
 * Envia uma mensagem de saída. A mensagem é SEMPRE gravada (rastro do que a
 * pessoa tentou mandar), mesmo quando o envio real falha — `deliveryStatus`
 * conta a história (`sent` vs `failed`), nunca um 500 que esconde o texto
 * digitado.
 */
export async function sendOutboundMessage(params: {
  organizationId: string;
  threadId: string;
  senderUserId: string;
  text: string;
}): Promise<SendOutboundResult> {
  const thread = await getThread(params.organizationId, params.threadId);
  if (!thread) return { ok: false, reason: 'thread_not_found' };

  let externalMessageId: string | null = null;
  let deliveryStatus: 'sent' | 'failed' = 'failed';
  let falha: SendOutboundResult | null = null;
  const providerSessionKey = thread.whatsappSessionId ?? 'legacy';

  try {
    if (thread.whatsappSessionId) {
      const session = await whatsappSessionById(thread.whatsappSessionId);
      if (!session || session.organizationId !== params.organizationId) throw new Error('Sessão WhatsApp da conversa não encontrada');
      const chatId = thread.externalChatId ?? `${thread.contactPhone ?? ''}@c.us`;
      const resultado = await senderForWhatsappSession(session).sendText({ chatId, text: params.text, idempotencyKey: randomUUID() });
      externalMessageId = resultado.messageId;
      deliveryStatus = 'sent';
    } else {
      const provider = await resolveCommunicationProvider(params.organizationId);
      if (!provider) {
        falha = { ok: false, reason: 'no_provider_configured' };
      } else {
        const resultado = await provider.sendMessage({ to: thread.contactPhone ?? '', text: params.text });
        externalMessageId = resultado.externalMessageId;
        deliveryStatus = 'sent';
      }
    }
  } catch (error) {
    const detail = error instanceof ConnectorConfigError ? error.message : error instanceof Error ? error.message : String(error);
    falha = { ok: false, reason: 'provider_error', detail };
  }

  const [inserida] = await db
    .insert(schema.threadMessages)
    .values({
      threadId: params.threadId,
      organizationId: params.organizationId,
      whatsappSessionId: thread.whatsappSessionId,
      providerSessionKey,
      channel: thread.channel,
      direction: 'outbound',
      senderUserId: params.senderUserId,
      content: params.text,
      externalMessageId,
      deliveryStatus,
    })
    .onConflictDoNothing({ target: [schema.threadMessages.organizationId, schema.threadMessages.channel, schema.threadMessages.providerSessionKey, schema.threadMessages.externalMessageId] })
    .returning();
  let mensagem = inserida;
  if (!mensagem && externalMessageId) {
    const [existente] = await db.select().from(schema.threadMessages).where(and(
      eq(schema.threadMessages.organizationId, params.organizationId),
      eq(schema.threadMessages.providerSessionKey, providerSessionKey),
      eq(schema.threadMessages.externalMessageId, externalMessageId),
    )).limit(1);
    mensagem = existente;
  }
  if (!mensagem) throw new Error('Falha ao persistir a mensagem enviada');

  await db
    .update(schema.conversationThreads)
    .set({ lastMessageAt: mensagem.createdAt, lastMessagePreview: params.text, status: 'waiting_client' })
    .where(eq(schema.conversationThreads.id, params.threadId));

  await recordOperationalEvent({
    source: 'system',
    type: deliveryStatus === 'sent' ? 'message.sent' : 'message.send_failed',
    organizationId: params.organizationId,
    userId: params.senderUserId,
    clientId: thread.clientId,
    entityType: 'conversation_thread',
    entityId: params.threadId,
    summary: deliveryStatus === 'sent' ? 'Enviou uma mensagem.' : 'Tentou enviar uma mensagem e falhou.',
  });

  if (falha && deliveryStatus === 'failed') return falha;
  return { ok: true, message: mensagem };
}

export async function sendOutboundMediaMessage(params: {
  organizationId: string;
  threadId: string;
  senderUserId: string;
  bytes: Buffer;
  mimetype: string;
  filename: string;
  caption?: string | undefined;
  voiceNote?: boolean | undefined;
}): Promise<SendOutboundResult> {
  const thread = await getThread(params.organizationId, params.threadId);
  if (!thread) return { ok: false, reason: 'thread_not_found' };
  if (!thread.whatsappSessionId) {
    return { ok: false, reason: 'provider_error', detail: 'Esta conversa não está vinculada a uma sessão OpenWA.' };
  }
  const session = await whatsappSessionById(thread.whatsappSessionId);
  if (!session || session.organizationId !== params.organizationId) {
    return { ok: false, reason: 'provider_error', detail: 'Sessão WhatsApp da conversa não encontrada.' };
  }

  let bytes = params.bytes;
  let mimetype = params.mimetype;
  if (params.voiceNote) {
    const converted = await gatewayForWhatsappSession(session).convertVoice(bytes.toString('base64'));
    bytes = Buffer.from(converted.base64, 'base64');
    mimetype = converted.mimetype;
  }
  const saved = await saveWhatsappMedia({
    organizationId: params.organizationId,
    sessionId: session.id,
    bytes,
    mimetype,
    filename: params.filename,
    maxBytes: WHATSAPP_MEDIA_MAX_BYTES,
  });
  const chatId = thread.externalChatId ?? `${thread.contactPhone ?? ''}@c.us`;
  const idempotencyKey = randomUUID();
  let externalMessageId: string | null = null;
  let deliveryStatus: 'sent' | 'failed' = 'failed';
  let falha: SendOutboundResult | null = null;
  try {
    const sender = senderForWhatsappSession(session);
    const input = { chatId, base64: bytes.toString('base64'), mimetype, filename: saved.filename, ...(params.caption ? { caption: params.caption } : {}), idempotencyKey };
    const result = mimetype.startsWith('image/')
      ? await sender.sendImage(input)
      : mimetype.startsWith('video/')
        ? await sender.sendVideo(input)
        : mimetype.startsWith('audio/')
          ? await sender.sendAudio({ ...input, ptt: params.voiceNote === true })
          : await sender.sendDocument(input);
    externalMessageId = result.messageId;
    deliveryStatus = 'sent';
  } catch (error) {
    falha = { ok: false, reason: 'provider_error', detail: error instanceof Error ? error.message : String(error) };
  }

  const [inserted] = await db.insert(schema.threadMessages).values({
    threadId: thread.id,
    organizationId: params.organizationId,
    whatsappSessionId: session.id,
    providerSessionKey: session.id,
    channel: thread.channel,
    direction: 'outbound',
    senderUserId: params.senderUserId,
    content: params.caption || null,
    attachmentType: mimetype,
    attachmentFilename: saved.filename,
    attachmentSizeBytes: saved.sizeBytes,
    metadata: { storageKey: saved.storageKey, voiceNote: params.voiceNote === true },
    externalMessageId,
    deliveryStatus,
  }).onConflictDoNothing({ target: [schema.threadMessages.organizationId, schema.threadMessages.channel, schema.threadMessages.providerSessionKey, schema.threadMessages.externalMessageId] }).returning();
  let message = inserted;
  if (!message && externalMessageId) {
    const [existing] = await db.select().from(schema.threadMessages).where(and(
      eq(schema.threadMessages.organizationId, params.organizationId),
      eq(schema.threadMessages.providerSessionKey, session.id),
      eq(schema.threadMessages.externalMessageId, externalMessageId),
    )).limit(1);
    message = existing;
  }
  if (!message) throw new Error('Falha ao persistir a mídia enviada');
  if (!message.attachmentUrl) {
    await db.update(schema.threadMessages).set({ attachmentUrl: `/inbox/messages/${message.id}/media` }).where(eq(schema.threadMessages.id, message.id));
    message = { ...message, attachmentUrl: `/inbox/messages/${message.id}/media` };
  }
  await db.update(schema.conversationThreads).set({
    lastMessageAt: message.createdAt,
    lastMessagePreview: params.caption || (params.voiceNote ? 'Áudio' : saved.filename),
    status: 'waiting_client',
  }).where(eq(schema.conversationThreads.id, thread.id));
  if (falha) return falha;
  return { ok: true, message };
}

/**
 * "Suas figurinhas": as que passaram pelas conversas do PRÓPRIO WhatsApp de
 * quem pede (enviadas ou recebidas), mais recentes primeiro, sem repetir. O
 * OpenWA não expõe as figurinhas favoritas da conta; estas são as que a pessoa
 * de fato usa. Repetição sai pelo tamanho do arquivo — a mesma figurinha chega
 * sempre com os mesmos bytes.
 */
export async function listRecentStickers(organizationId: string, viewerId: string, limit = 60) {
  const rows = await db.select({ id: schema.threadMessages.id, size: schema.threadMessages.attachmentSizeBytes, createdAt: schema.threadMessages.createdAt })
    .from(schema.threadMessages)
    .innerJoin(schema.whatsappSessions, eq(schema.whatsappSessions.id, schema.threadMessages.whatsappSessionId))
    .where(and(
      eq(schema.threadMessages.organizationId, organizationId),
      eq(schema.whatsappSessions.ownerUserId, viewerId),
      sql`${schema.threadMessages.metadata}->>'type' = 'sticker'`,
      sql`${schema.threadMessages.metadata} ? 'storageKey'`,
    ))
    .orderBy(desc(schema.threadMessages.createdAt))
    .limit(400);
  const seen = new Set<number | null>();
  return rows.filter((row) => (seen.has(row.size) ? false : (seen.add(row.size), true))).slice(0, limit);
}

export async function getMessageMedia(organizationId: string, messageId: string, viewerId: string) {
  const [message] = await db.select().from(schema.threadMessages).where(and(
    eq(schema.threadMessages.id, messageId),
    eq(schema.threadMessages.organizationId, organizationId),
  )).limit(1);
  if (!message) return null;
  if (!(await getThread(organizationId, message.threadId, viewerId))) return null;
  const storageKey = message.metadata.storageKey;
  if (typeof storageKey !== 'string') return null;
  const bytes = await readWhatsappMedia(storageKey);
  return { message, bytes };
}

export async function markThreadRead(organizationId: string, threadId: string): Promise<boolean> {
  const thread = await getThread(organizationId, threadId);
  if (!thread) return false;
  await db.update(schema.conversationThreads).set({ unreadCount: 0 }).where(and(
    eq(schema.conversationThreads.id, threadId),
    eq(schema.conversationThreads.organizationId, organizationId),
  ));
  // Avisar o WhatsApp (os dois risquinhos azuis) não segura a resposta: era
  // ~3 s esperando o OpenWA a cada conversa aberta (medido em 19/10/2026).
  if (thread.whatsappSessionId && thread.externalChatId) {
    const chatId = thread.externalChatId;
    void whatsappSessionById(thread.whatsappSessionId)
      .then((session) => (session ? gatewayForWhatsappSession(session).markRead(chatId) : undefined))
      .catch(() => undefined);
  }
  return true;
}

export async function updateThreadStatus(organizationId: string, threadId: string, status: ConversationStatus): Promise<ThreadRow | null> {
  const [updated] = await db.update(schema.conversationThreads).set({ status }).where(and(
    eq(schema.conversationThreads.id, threadId),
    eq(schema.conversationThreads.organizationId, organizationId),
  )).returning();
  return updated ?? null;
}

export async function findOrCreateContactByPhone(params: {
  organizationId: string;
  clientId: string | null;
  phone: string;
  name: string | null;
}): Promise<ContactRow> {
  const [existente] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.organizationId, params.organizationId), eq(schema.contacts.phone, params.phone)));
  if (existente) return existente;

  const [criado] = await db
    .insert(schema.contacts)
    .values({ organizationId: params.organizationId, clientId: params.clientId, phone: params.phone, name: params.name ?? params.phone })
    .returning();
  return criado!;
}

export async function findOrCreateOpenThread(params: {
  organizationId: string;
  contactId: string;
  clientId: string | null;
  channel: 'whatsapp';
}): Promise<ThreadRow> {
  const [existente] = await db
    .select()
    .from(schema.conversationThreads)
    .where(
      and(
        eq(schema.conversationThreads.organizationId, params.organizationId),
        eq(schema.conversationThreads.contactId, params.contactId),
        eq(schema.conversationThreads.channel, params.channel),
      ),
    )
    .orderBy(desc(schema.conversationThreads.createdAt))
    .limit(1);
  if (existente && existente.status !== 'archived') return existente;

  const [criada] = await db
    .insert(schema.conversationThreads)
    .values({ organizationId: params.organizationId, clientId: params.clientId, contactId: params.contactId, channel: params.channel, status: 'waiting_agency' })
    .returning();
  return criada!;
}

/**
 * Mensagem RECEBIDA (webhook). Idempotente pela unique (channel,
 * externalMessageId) — retry do provedor nunca duplica. `created: false`
 * quando já existia (não é erro, é a idempotência funcionando — mesmo
 * critério de `recordOperationalEvent`).
 */
export async function recordInboundMessage(params: {
  organizationId: string;
  threadId: string;
  clientId: string | null;
  contactId: string;
  channel: 'whatsapp';
  text: string | null;
  externalMessageId: string | null;
  occurredAt: Date;
}): Promise<{ created: boolean; message: MessageRow | null }> {
  if (params.externalMessageId) {
    const [existente] = await db
      .select()
      .from(schema.threadMessages)
      .where(and(
        eq(schema.threadMessages.organizationId, params.organizationId),
        eq(schema.threadMessages.channel, params.channel),
        eq(schema.threadMessages.providerSessionKey, 'legacy'),
        eq(schema.threadMessages.externalMessageId, params.externalMessageId),
      ));
    if (existente) return { created: false, message: existente };
  }

  const [mensagem] = await db
    .insert(schema.threadMessages)
    .values({
      threadId: params.threadId,
      organizationId: params.organizationId,
      providerSessionKey: 'legacy',
      channel: params.channel,
      direction: 'inbound',
      senderContactId: params.contactId,
      content: params.text,
      externalMessageId: params.externalMessageId,
      deliveryStatus: 'delivered',
      createdAt: params.occurredAt,
    })
    .onConflictDoNothing({ target: [schema.threadMessages.organizationId, schema.threadMessages.channel, schema.threadMessages.providerSessionKey, schema.threadMessages.externalMessageId] })
    .returning();

  await db
    .update(schema.conversationThreads)
    .set({ lastMessageAt: params.occurredAt, lastMessagePreview: params.text, status: 'waiting_agency', ...(mensagem ? { unreadCount: sql`${schema.conversationThreads.unreadCount} + 1` } : {}) })
    .where(eq(schema.conversationThreads.id, params.threadId));

  await recordOperationalEvent({
    source: 'whatsapp',
    type: 'message.received',
    externalId: params.externalMessageId,
    organizationId: params.organizationId,
    clientId: params.clientId,
    entityType: 'conversation_thread',
    entityId: params.threadId,
    summary: 'Recebeu uma mensagem.',
  });

  return { created: Boolean(mensagem), message: mensagem ?? null };
}

/**
 * Organização dona de uma instância Evolution — resolvida pelo `instance`
 * do conector, NUNCA por um organizationId que o webhook público mande
 * (§94 do prompt master: webhook nunca confia em organizationId do
 * cliente). Devolve também a `apiKey` gravada, pra o webhook verificar o
 * payload contra ELA (não contra o que o payload alega ser).
 */
export async function connectorForWhatsappInstance(instance: string): Promise<{ organizationId: string; apiKey: string } | null> {
  const linhas = await db
    .select({ organizationId: schema.organizationConnectors.organizationId, credentials: schema.organizationConnectors.credentials })
    .from(schema.organizationConnectors)
    .where(and(eq(schema.organizationConnectors.provider, 'whatsapp'), inArray(schema.organizationConnectors.status, ['ativa', 'active'])));

  for (const linha of linhas) {
    const creds = linha.credentials as { instance?: string; apiKey?: string } | null;
    if (creds?.instance === instance && typeof creds.apiKey === 'string') {
      return { organizationId: linha.organizationId, apiKey: creds.apiKey };
    }
  }
  return null;
}

