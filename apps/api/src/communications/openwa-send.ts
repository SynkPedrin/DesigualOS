import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  gatewayForWhatsappSession,
  saveWhatsappMedia,
  senderForWhatsappSession,
  whatsappSessionById,
  WHATSAPP_MEDIA_MAX_BYTES,
  type WhatsappSessionRow,
} from '@desigual-os/tool-gateway';
import { publishWsEvent, recordOperationalEvent } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';

/**
 * Envio pela Inbox sem esperar o WhatsApp (19/10/2026).
 *
 * Medido em produção: o POST esperava o OpenWA confirmar o envio — 5,7 s e
 * 6,8 s, com o navegador do WhatsApp ocupado e ~10 idas ao banco nos EUA. A
 * pessoa ficava olhando a bolha não aparecer. Agora a mensagem é gravada como
 * `pending` e volta na hora; a entrega roda em segundo plano e o status
 * (`sent` / `failed`) chega à tela pelo evento `inbox.updated`.
 *
 * O OpenWA também avisa o envio pelo webhook (`message.sent`), às vezes antes
 * de esta rotina saber o id externo. Os dois lados conciliam pela mesma linha:
 * aqui, se a do webhook já existe, a pendente sai; lá (`persistOpenwaMessage`),
 * uma pendente compatível recebe o id em vez de nascer uma segunda.
 */

const logger = createLogger({ service: 'inbox-openwa-send' });

type MessageRow = typeof schema.threadMessages.$inferSelect;

interface ThreadRef {
  id: string;
  clientId: string | null;
  channel: string;
  whatsappSessionId: string | null;
  externalChatId: string | null;
  contactPhone: string | null;
}

export type FastSendResult = { ok: true; message: MessageRow } | { ok: false; detail: string };

function notify(session: WhatsappSessionRow, threadId: string): void {
  void publishWsEvent({ type: 'inbox.updated', payload: { owner_user_id: session.ownerUserId, thread_id: threadId } }).catch(() => undefined);
}

// Credenciais e dono da sessão quase nunca mudam; uma ida ao banco nos EUA a
// menos por envio (~130 ms) vale os 60 s de memória.
const sessionCache = new Map<string, { row: WhatsappSessionRow; at: number }>();

async function loadSession(organizationId: string, sessionId: string): Promise<WhatsappSessionRow | null> {
  const hit = sessionCache.get(sessionId);
  const session = hit && Date.now() - hit.at < 60_000 ? hit.row : await whatsappSessionById(sessionId);
  if (session && !hit) sessionCache.set(sessionId, { row: session, at: Date.now() });
  return session && session.organizationId === organizationId ? session : null;
}

/** Grava o id externo na pendente — ou, se o webhook chegou antes, fica com a dele. */
async function reconcile(pending: MessageRow, externalMessageId: string, senderUserId: string): Promise<void> {
  const [existing] = await db.select({ id: schema.threadMessages.id }).from(schema.threadMessages).where(and(
    eq(schema.threadMessages.organizationId, pending.organizationId),
    eq(schema.threadMessages.providerSessionKey, pending.providerSessionKey),
    eq(schema.threadMessages.externalMessageId, externalMessageId),
  )).limit(1);
  if (existing && existing.id !== pending.id) {
    await db.update(schema.threadMessages).set({ senderUserId }).where(eq(schema.threadMessages.id, existing.id));
    await db.delete(schema.threadMessages).where(eq(schema.threadMessages.id, pending.id));
    return;
  }
  await db.update(schema.threadMessages).set({ externalMessageId, deliveryStatus: 'sent' }).where(and(
    eq(schema.threadMessages.id, pending.id),
    isNull(schema.threadMessages.externalMessageId),
  ));
}

async function deliver(input: {
  session: WhatsappSessionRow;
  thread: ThreadRef;
  pending: MessageRow;
  senderUserId: string;
  summary: string;
  send: () => Promise<{ messageId: string }>;
}): Promise<void> {
  const { session, thread, pending } = input;
  let ok = false;
  try {
    const result = await input.send();
    await reconcile(pending, result.messageId, input.senderUserId);
    ok = true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn({ threadId: thread.id, detail }, 'Envio pelo OpenWA falhou');
    await db.update(schema.threadMessages).set({
      deliveryStatus: 'failed',
      metadata: { ...pending.metadata, sendError: detail },
    }).where(eq(schema.threadMessages.id, pending.id)).catch(() => undefined);
  }
  notify(session, thread.id);
  await recordOperationalEvent({
    source: 'system',
    type: ok ? 'message.sent' : 'message.send_failed',
    organizationId: pending.organizationId,
    userId: input.senderUserId,
    clientId: thread.clientId,
    entityType: 'conversation_thread',
    entityId: thread.id,
    summary: ok ? input.summary : 'Tentou enviar uma mensagem e falhou.',
  }).catch(() => undefined);
}

async function touchThread(threadId: string, at: Date, preview: string): Promise<void> {
  await db.update(schema.conversationThreads).set({ lastMessageAt: at, lastMessagePreview: preview.slice(0, 500), status: 'waiting_client' })
    .where(eq(schema.conversationThreads.id, threadId));
}

// ── marcação com @ (pedido do Pedro, 29/10/2026) ─────────────────────────────────────────────────────────────

export interface PessoaMarcavel {
  /** Id no WhatsApp (`5518...@c.us` ou `...@lid`): vai em `mentions`. */
  id: string;
  /** O que vai no texto depois do @ para o WhatsApp desenhar a marcação: a parte do id antes do @. */
  token: string;
  nome: string;
}

const tokenDoId = (id: string) => id.split('@')[0]!.split(':')[0]!;
const marcaveisEmCache = new Map<string, { em: number; pessoas: PessoaMarcavel[] }>();

/**
 * Quem pode ser marcado na conversa: os participantes do grupo, com o nome do contato quando a gente conhece a pessoa
 * (senão o nome que o WhatsApp informa, senão o número). Conversa individual não tem a quem marcar.
 */
export async function pessoasMarcaveis(organizationId: string, thread: ThreadRef): Promise<PessoaMarcavel[]> {
  if (!thread.externalChatId?.endsWith('@g.us') || !thread.whatsappSessionId) return [];
  const hit = marcaveisEmCache.get(thread.id);
  if (hit && Date.now() - hit.em < 5 * 60_000) return hit.pessoas;
  const session = await loadSession(organizationId, thread.whatsappSessionId);
  if (!session) return [];
  const participantes = await senderForWhatsappSession(session).groupParticipants(thread.externalChatId);
  const contatos = await db.select({ name: schema.contacts.name, phone: schema.contacts.phone, externalIds: schema.contacts.externalIds })
    .from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId));
  const nomePorChave = new Map<string, string>();
  for (const c of contatos) {
    const digitos = (c.phone ?? '').replace(/\D/g, '');
    if (digitos) nomePorChave.set(digitos, c.name);
    for (const v of Object.values(c.externalIds ?? {})) if (typeof v === 'string' && v) nomePorChave.set(tokenDoId(v), c.name);
  }
  const proprio = tokenDoId(session.phoneNumber ?? '');
  const pessoas = participantes
    .filter((p) => p.id && tokenDoId(p.id) !== proprio && (p.number || '').replace(/\D/g, '') !== proprio)
    .map((p) => {
      const token = tokenDoId(p.id);
      const numero = (p.number || '').replace(/\D/g, '');
      const nome = nomePorChave.get(numero) ?? nomePorChave.get(token) ?? p.name?.trim() ?? (numero ? `+${numero}` : token);
      return { id: p.id, token, nome };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  marcaveisEmCache.set(thread.id, { em: Date.now(), pessoas });
  return pessoas;
}

export async function sendTextFast(params: { organizationId: string; thread: ThreadRef; senderUserId: string; text: string; mentions?: string[] | undefined }): Promise<FastSendResult> {
  const { thread } = params;
  const session = thread.whatsappSessionId ? await loadSession(params.organizationId, thread.whatsappSessionId) : null;
  if (!session) return { ok: false, detail: 'Sessão WhatsApp da conversa não encontrada.' };
  const [pending] = await db.insert(schema.threadMessages).values({
    threadId: thread.id,
    organizationId: params.organizationId,
    whatsappSessionId: session.id,
    providerSessionKey: session.id,
    channel: thread.channel as 'whatsapp',
    direction: 'outbound',
    senderUserId: params.senderUserId,
    content: params.text,
    deliveryStatus: 'pending',
  }).returning();
  const chatId = thread.externalChatId ?? `${thread.contactPhone ?? ''}@c.us`;
  void (async () => {
    await touchThread(thread.id, pending!.createdAt, params.text).catch(() => undefined);
    await deliver({
      session, thread, pending: pending!, senderUserId: params.senderUserId, summary: 'Enviou uma mensagem.',
      send: () => senderForWhatsappSession(session).sendText({ chatId, text: params.text, ...(params.mentions?.length ? { mentions: params.mentions } : {}), idempotencyKey: randomUUID() }),
    });
  })();
  return { ok: true, message: pending! };
}

export async function sendMediaFast(params: {
  organizationId: string;
  thread: ThreadRef;
  senderUserId: string;
  bytes: Buffer;
  mimetype: string;
  filename: string;
  caption?: string | undefined;
  voiceNote?: boolean | undefined;
  /** Enviar como figurinha (a imagem vira sticker no WhatsApp). */
  asSticker?: boolean | undefined;
}): Promise<FastSendResult> {
  const { thread } = params;
  const session = thread.whatsappSessionId ? await loadSession(params.organizationId, thread.whatsappSessionId) : null;
  if (!session) return { ok: false, detail: 'Esta conversa não está vinculada a uma sessão OpenWA.' };
  const saved = await saveWhatsappMedia({
    organizationId: params.organizationId,
    sessionId: session.id,
    bytes: params.bytes,
    mimetype: params.mimetype,
    filename: params.filename,
    maxBytes: WHATSAPP_MEDIA_MAX_BYTES,
  });
  const [inserted] = await db.insert(schema.threadMessages).values({
    threadId: thread.id,
    organizationId: params.organizationId,
    whatsappSessionId: session.id,
    providerSessionKey: session.id,
    channel: thread.channel as 'whatsapp',
    direction: 'outbound',
    senderUserId: params.senderUserId,
    content: params.caption || null,
    attachmentType: params.mimetype,
    attachmentFilename: saved.filename,
    attachmentSizeBytes: saved.sizeBytes,
    metadata: { storageKey: saved.storageKey, voiceNote: params.voiceNote === true, ...(params.asSticker ? { type: 'sticker' } : {}) },
    deliveryStatus: 'pending',
  }).returning();
  const [pending] = await db.update(schema.threadMessages).set({ attachmentUrl: `/inbox/messages/${inserted!.id}/media` })
    .where(eq(schema.threadMessages.id, inserted!.id)).returning();
  const chatId = thread.externalChatId ?? `${thread.contactPhone ?? ''}@c.us`;
  const labels: Record<string, string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio' };
  const kind = params.mimetype.split('/')[0] ?? '';
  void (async () => {
    await touchThread(thread.id, pending!.createdAt, params.asSticker ? 'Figurinha' : params.caption || labels[kind] || 'Documento').catch(() => undefined);
    await deliver({
      session, thread, pending: pending!, senderUserId: params.senderUserId, summary: 'Enviou uma mídia.',
      send: async () => {
        let bytes = params.bytes;
        let mimetype = params.mimetype;
        // Nota de voz do navegador vem em webm; o WhatsApp só toca como "áudio de voz" em ogg/opus.
        if (params.voiceNote) {
          const converted = await gatewayForWhatsappSession(session).convertVoice(bytes.toString('base64'));
          bytes = Buffer.from(converted.base64, 'base64');
          mimetype = converted.mimetype;
        }
        const sender = senderForWhatsappSession(session);
        if (params.asSticker) return sender.sendSticker({ chatId, base64: bytes.toString('base64'), mimetype, filename: saved.filename, idempotencyKey: randomUUID() });
        const input = { chatId, base64: bytes.toString('base64'), mimetype, filename: saved.filename, ...(params.caption ? { caption: params.caption } : {}), idempotencyKey: randomUUID() };
        if (mimetype.startsWith('image/')) return sender.sendImage(input);
        if (mimetype.startsWith('video/')) return sender.sendVideo(input);
        if (mimetype.startsWith('audio/')) return sender.sendAudio({ ...input, ptt: params.voiceNote === true });
        return sender.sendDocument(input);
      },
    });
  })();
  return { ok: true, message: pending! };
}
