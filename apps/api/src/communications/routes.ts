import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONVERSATION_STATUSES } from '@desigual-os/types';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  abrirConversaComNumero,
  createMicrosoftCalendarEvent,
  listMicrosoftCalendars,
  OpenwaError,
  parseEvolutionWebhookEvent,
  phoneFromRemoteJid,
  resolveMicrosoftCalendarAccess,
  senderForWhatsappSession,
  WHATSAPP_MEDIA_MAX_BYTES,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { clientBelongsToTenant, requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import * as svc from './service';
import { pessoasMarcaveis, sendMediaFast, sendTextFast } from './openwa-send';
import { numeroParaWhatsapp } from './numero';

/**
 * communications/routes.ts — Inbox (P1-A/C, 06/10/2026).
 *
 * Rota `/inbox/*`, não `/conversations/*`: aquele path já existe e é o chat
 * INTERNO com Bento (`apps/api/src/conversations/routes.ts`) — nomes
 * diferentes de propósito, pra não colidir.
 *
 * Webhook é rota PÚBLICA, fora do hook de auth — verificado pelo próprio
 * mecanismo (ver `registerWebhook` abaixo), nunca por sessão de usuário.
 */

const listQuerySchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  assigned: z.enum(['me', 'unassigned']).optional(),
  view: z.enum(['active', 'archived']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

// `mentions`: só id individual do WhatsApp (o motor recusa o resto com um 500 sem explicação).
const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string().regex(/^\d{5,20}(:\d+)?@(c\.us|lid|s\.whatsapp\.net)$/)).max(100).optional(),
});
const assignSchema = z.object({ userId: z.string().uuid().nullable() });
const linkClientSchema = z.object({ clientId: z.string().uuid().nullable() });
const statusSchema = z.object({ status: z.enum(CONVERSATION_STATUSES) });
const novaConversaSchema = z.object({ phone: z.string().trim().min(1).max(40) });
const DURACAO_DA_CHAMADA_MS = 30 * 60_000;

interface PresentableThread {
  id: string;
  clientId: string | null;
  clientName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactMetadata: Record<string, unknown> | null;
  whatsappSessionId: string | null;
  groupId: string | null;
  externalChatId: string | null;
  kind: string;
  title: string | null;
  unreadCount: number;
  lastMessagePreview: string | null;
  groupName: string | null;
  groupAvatarUrl: string | null;
  channel: string;
  status: string;
  assignedToUserId: string | null;
  lastMessageAt: Date | null;
  whatsappArchived?: boolean;
  whatsappPinned?: boolean;
}

function presentThread(t: PresentableThread | null) {
  if (!t) return null;
  const avatar = t.groupAvatarUrl ?? (typeof t.contactMetadata?.profilePicUrl === 'string' ? t.contactMetadata.profilePicUrl : null);
  return {
    id: t.id,
    client_id: t.clientId,
    client_name: t.clientName,
    contact_id: t.contactId,
    contact_name: t.kind === 'group' ? t.groupName ?? t.title ?? 'Grupo WhatsApp' : t.contactName ?? t.title ?? 'Contato WhatsApp',
    contact_phone: t.kind === 'group' ? null : t.contactPhone,
    contact_avatar_url: avatar,
    whatsapp_session_id: t.whatsappSessionId,
    group_id: t.groupId,
    external_chat_id: t.externalChatId,
    kind: t.kind,
    unread_count: t.unreadCount,
    last_message_preview: t.lastMessagePreview,
    human_service_status: t.status === 'archived' ? 'ended' : t.assignedToUserId ? 'active' : 'unassigned',
    channel: t.channel,
    status: t.status,
    assigned_to_user_id: t.assignedToUserId,
    last_message_at: t.lastMessageAt?.toISOString() ?? null,
    whatsapp_archived: t.whatsappArchived ?? false,
    whatsapp_pinned: t.whatsappPinned ?? false,
  };
}

function presentMessage(m: { id: string; direction: string; senderContactId: string | null; senderUserId: string | null; senderName: string | null; content: string | null; attachmentUrl: string | null; attachmentType: string | null; attachmentFilename: string | null; attachmentSizeBytes: number | null; externalMessageId: string | null; deliveryStatus: string; createdAt: Date }) {
  return {
    id: m.id,
    direction: m.direction,
    sender_contact_id: m.senderContactId,
    sender_user_id: m.senderUserId,
    sender_name: m.senderName,
    content: m.content,
    attachment_url: m.attachmentUrl,
    attachment_type: m.attachmentType,
    attachment_filename: m.attachmentFilename,
    attachment_size_bytes: m.attachmentSizeBytes,
    external_message_id: m.externalMessageId,
    delivery_status: m.deliveryStatus,
    created_at: m.createdAt.toISOString(),
  };
}

export async function registerCommunicationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (authed) => {
    authed.addHook('preHandler', async (request, reply) => {
      await requireAuth(request, reply);
      if (reply.sent) return;
      await requireTenant(request, reply);
      if (reply.sent) return;
      // Workspace Builder (§79): esconder o item de navegação não basta —
      // nunca se aplica ao webhook público, que fica FORA deste bloco `authed`.
      await requireModule('inbox')(request, reply);
    });

    authed.get('/inbox/threads', { preHandler: requirePermission('communications', 'read') }, async (request) => {
      const q = listQuerySchema.parse(request.query);
      const user = request.authUser!;
      const linhas = await svc.listThreads({
        organizationId: request.tenantContext!.organizationId,
        callerId: user.id,
        status: q.status,
        assignedToSelf: q.assigned === 'me',
        unassignedOnly: q.assigned === 'unassigned',
        view: q.view,
        q: q.q,
        limit: q.limit,
        offset: q.offset,
      });
      return { threads: linhas.map(presentThread) };
    });

    // "Nova conversa": abre a conversa com um número pelo WhatsApp de quem pediu. Não envia nada — a primeira mensagem
    // sai pelo campo de sempre. Se já existe conversa com o número, devolve ela.
    authed.post('/inbox/threads', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const organizationId = request.tenantContext!.organizationId;
      const userId = request.authUser!.id;
      const numero = numeroParaWhatsapp(novaConversaSchema.parse(request.body).phone);
      if (!numero) { reply.code(400); return { error: 'Número inválido. Digite com DDD, ou com + e o código do país.' }; }
      const [session] = await db.select().from(schema.whatsappSessions).where(and(
        eq(schema.whatsappSessions.organizationId, organizationId),
        eq(schema.whatsappSessions.ownerUserId, userId),
        eq(schema.whatsappSessions.status, 'ready'),
      )).limit(1);
      if (!session) { reply.code(409); return { error: 'Seu WhatsApp não está conectado. Conecte em Configurações para começar conversas.' }; }
      let chatId = `${numero}@c.us`;
      try {
        const consulta = await senderForWhatsappSession(session).checkNumber(numero);
        if (!consulta.exists) { reply.code(404); return { error: `O número +${numero} não tem WhatsApp.` }; }
        if (consulta.whatsappId) chatId = consulta.whatsappId;
      } catch (error) {
        // 404 é o motor sem a consulta (versão anterior): segue pelo número, e o próprio envio confere. O resto é o
        // WhatsApp sem responder agora, e isso não diz nada sobre o número.
        if (!(error instanceof OpenwaError && error.status === 404)) {
          logger.warn({ error, sessionId: session.id }, 'Consulta de número no WhatsApp falhou');
          reply.code(503);
          return { error: 'O WhatsApp não respondeu agora. Tente de novo em instantes.' };
        }
      }
      const thread = await abrirConversaComNumero(session, { chatId, phone: numero });
      await auditarAcao(request, { action: 'conversation.started', resourceType: 'conversation_thread', resourceId: thread.id, metadata: { phone: numero } });
      reply.code(201);
      return presentThread(await svc.getThread(organizationId, thread.id, userId));
    });

    // Chamada de vídeo: reunião do Teams agora, na agenda Microsoft de quem pediu. Devolve o link para a pessoa mandar
    // na conversa — quem decide enviar é ela.
    authed.post<{ Params: { id: string } }>('/inbox/threads/:id/video-call', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const userId = request.authUser!.id;
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id, userId);
      if (!thread) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      const access = await resolveMicrosoftCalendarAccess(userId).catch(() => null);
      if (!access) { reply.code(409); return { error: 'Conecte sua agenda Microsoft em Configurações para criar chamadas de vídeo.' }; }
      const nome = thread.clientName ?? thread.contactName ?? thread.title ?? 'contato do WhatsApp';
      try {
        const agendas = await listMicrosoftCalendars(access.accessToken);
        const agenda = agendas.find((a) => a.isDefault && a.canEdit) ?? agendas.find((a) => a.canEdit);
        if (!agenda) { reply.code(409); return { error: 'Sua conta Microsoft não tem agenda onde criar a chamada.' }; }
        const inicio = new Date();
        const evento = await createMicrosoftCalendarEvent(access.accessToken, agenda.id, {
          subject: `Chamada com ${nome}`,
          description: 'Criada pela Inbox do Desigual OS.',
          startIso: inicio.toISOString().slice(0, 19),
          endIso: new Date(inicio.getTime() + DURACAO_DA_CHAMADA_MS).toISOString().slice(0, 19),
          timezone: 'UTC',
          requestTeamsMeeting: true,
        });
        await auditarAcao(request, { action: 'conversation.video_call_created', resourceType: 'conversation_thread', resourceId: thread.id, metadata: { teams: Boolean(evento.meetingUrl) } });
        if (!evento.meetingUrl) {
          reply.code(502);
          return { error: 'O evento entrou na sua agenda, mas a conta Microsoft não gerou link do Teams (conta sem Teams).', web_link: evento.webLink };
        }
        reply.code(201);
        return { join_url: evento.meetingUrl, web_link: evento.webLink };
      } catch (error) {
        logger.warn({ error, threadId: thread.id }, 'Falha ao criar a chamada de vídeo no Microsoft');
        reply.code(502);
        return { error: 'A Microsoft não criou a chamada agora. Tente de novo em instantes.' };
      }
    });

    authed.get<{ Params: { id: string } }>('/inbox/threads/:id', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id);
      if (!thread) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      return presentThread(thread);
    });

    authed.get<{ Params: { id: string } }>('/inbox/threads/:id/messages', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
      const mensagens = await svc.listRecentMessagesVisible(request.tenantContext!.organizationId, request.params.id, request.authUser!.id, q.limit, q.offset);
      if (!mensagens) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      return { messages: mensagens.map(presentMessage) };
    });

    // Quem dá para marcar com @ nesta conversa (participantes do grupo). Falha do WhatsApp vira lista vazia: sem a
    // sugestão, a mensagem continua indo.
    authed.get<{ Params: { id: string } }>('/inbox/threads/:id/mentionables', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id);
      if (!thread) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      const pessoas = await pessoasMarcaveis(request.tenantContext!.organizationId, thread).catch((error: unknown) => {
        logger.warn({ error, threadId: thread.id }, 'Participantes do grupo indisponíveis para marcar');
        return [];
      });
      return { people: pessoas };
    });

    authed.post<{ Params: { id: string } }>('/inbox/threads/:id/messages', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id);
      if (!thread) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      const body = sendMessageSchema.parse(request.body);
      if (thread.whatsappSessionId) {
        const rapido = await sendTextFast({ organizationId: request.tenantContext!.organizationId, thread, senderUserId: request.authUser!.id, text: body.text, mentions: body.mentions });
        if (!rapido.ok) { reply.code(409); return { error: rapido.detail }; }
        reply.code(201);
        return presentMessage(rapido.message);
      }
      const resultado = await svc.sendOutboundMessage({
        organizationId: request.tenantContext!.organizationId,
        threadId: request.params.id,
        senderUserId: request.authUser!.id,
        text: body.text,
      });

      if (!resultado.ok) {
        const mensagemPorMotivo: Record<string, string> = {
          thread_not_found: 'Conversa não encontrada.',
          no_provider_configured: 'WhatsApp ainda não está conectado para esta empresa.',
          provider_error: 'detail' in resultado ? resultado.detail : 'Falha ao enviar.',
        };
        reply.code(resultado.reason === 'no_provider_configured' ? 409 : 502);
        return { error: mensagemPorMotivo[resultado.reason] };
      }

      reply.code(201);
      return presentMessage(resultado.message);
    });

    authed.post<{ Params: { id: string } }>('/inbox/threads/:id/messages/media', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id);
      if (!thread) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      // Limite próprio da Inbox (o global do servidor segue 25 MB para as outras rotas).
      const file = await request.file({ limits: { fileSize: WHATSAPP_MEDIA_MAX_BYTES } });
      if (!file) { reply.code(400); return { error: 'Nenhum arquivo enviado.' }; }
      const fields = file.fields as Record<string, { value?: unknown }>;
      const caption = typeof fields.caption?.value === 'string' ? fields.caption.value.slice(0, 1024) : undefined;
      const voiceNote = fields.voiceNote?.value === 'true' || fields.voiceNote?.value === true;
      const asSticker = fields.sticker?.value === 'true' || fields.sticker?.value === true;
      try {
        if (thread.whatsappSessionId) {
          const rapido = await sendMediaFast({
            organizationId: request.tenantContext!.organizationId,
            thread,
            senderUserId: request.authUser!.id,
            bytes: await file.toBuffer(),
            mimetype: file.mimetype,
            filename: file.filename,
            caption,
            voiceNote,
            asSticker,
          });
          if (!rapido.ok) { reply.code(409); return { error: rapido.detail }; }
          reply.code(201);
          return presentMessage(rapido.message);
        }
        const resultado = await svc.sendOutboundMediaMessage({
          organizationId: request.tenantContext!.organizationId,
          threadId: thread.id,
          senderUserId: request.authUser!.id,
          bytes: await file.toBuffer(),
          mimetype: file.mimetype,
          filename: file.filename,
          caption,
          voiceNote,
        });
        if (!resultado.ok) {
          reply.code(resultado.reason === 'no_provider_configured' ? 409 : 502);
          return { error: 'detail' in resultado ? resultado.detail : 'Falha ao enviar mídia.' };
        }
        reply.code(201);
        return presentMessage(resultado.message);
      } catch (error) {
        reply.code(400);
        return { error: error instanceof Error ? error.message : 'Arquivo inválido.' };
      }
    });

    authed.get('/inbox/stickers', { preHandler: requirePermission('communications', 'read') }, async (request) => {
      const stickers = await svc.listRecentStickers(request.tenantContext!.organizationId, request.authUser!.id);
      return { stickers: stickers.map((s) => ({ message_id: s.id, url: `/inbox/messages/${s.id}/media` })) };
    });

    // Reenvia uma figurinha de "Suas figurinhas" sem o navegador baixar e subir o arquivo de novo.
    authed.post<{ Params: { id: string } }>('/inbox/threads/:id/messages/sticker', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id);
      if (!thread?.whatsappSessionId) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      const body = z.object({ messageId: z.string().uuid() }).parse(request.body);
      const media = await svc.getMessageMedia(request.tenantContext!.organizationId, body.messageId, request.authUser!.id);
      if (!media) { reply.code(404); return { error: 'Figurinha não encontrada.' }; }
      const rapido = await sendMediaFast({
        organizationId: request.tenantContext!.organizationId,
        thread,
        senderUserId: request.authUser!.id,
        bytes: media.bytes,
        mimetype: media.message.attachmentType ?? 'image/webp',
        filename: media.message.attachmentFilename ?? 'figurinha.webp',
        asSticker: true,
      });
      if (!rapido.ok) { reply.code(409); return { error: rapido.detail }; }
      reply.code(201);
      return presentMessage(rapido.message);
    });

    authed.get<{ Params: { id: string } }>('/inbox/messages/:id/media', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const media = await svc.getMessageMedia(request.tenantContext!.organizationId, request.params.id, request.authUser!.id);
      if (!media) { reply.code(404); return { error: 'Mídia não encontrada.' }; }
      const filename = (media.message.attachmentFilename ?? 'arquivo').replace(/["\r\n]/g, '_');
      const inline = /^(image|audio|video)\//.test(media.message.attachmentType ?? '');
      reply.header('Content-Type', media.message.attachmentType ?? 'application/octet-stream');
      reply.header('Content-Length', media.bytes.byteLength);
      reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(media.bytes);
    });

    authed.post<{ Params: { id: string } }>('/inbox/threads/:id/read', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      if (!(await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id))) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      const updated = await svc.markThreadRead(request.tenantContext!.organizationId, request.params.id);
      if (!updated) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      return { ok: true };
    });

    authed.patch<{ Params: { id: string } }>('/inbox/threads/:id/status', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      if (!(await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id))) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      const body = statusSchema.parse(request.body);
      const updated = await svc.updateThreadStatus(request.tenantContext!.organizationId, request.params.id, body.status);
      if (!updated) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      await auditarAcao(request, {
        action: 'conversation.status_changed',
        resourceType: 'conversation_thread',
        resourceId: request.params.id,
        newValue: { status: body.status },
      });
      return { id: updated.id, status: updated.status };
    });

    authed.patch<{ Params: { id: string } }>('/inbox/threads/:id/client', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const organizationId = request.tenantContext!.organizationId;
      if (!(await svc.getThread(organizationId, request.params.id, request.authUser!.id))) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      const body = linkClientSchema.parse(request.body);
      // Cliente de outra empresa não existe para esta: 404, nunca vínculo cruzado.
      if (body.clientId && !(await clientBelongsToTenant(body.clientId, organizationId))) { reply.code(404); return { error: 'Cliente não encontrado.' }; }
      const atualizada = await svc.linkThreadToClient(organizationId, request.params.id, body.clientId);
      if (!atualizada) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      await auditarAcao(request, {
        action: 'conversation.client_linked',
        resourceType: 'conversation_thread',
        resourceId: request.params.id,
        newValue: { clientId: body.clientId, contactId: atualizada.contactId },
      });
      return presentThread(await svc.getThread(organizationId, request.params.id, request.authUser!.id));
    });

    authed.patch<{ Params: { id: string } }>('/inbox/threads/:id/assign', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      if (!(await svc.getThread(request.tenantContext!.organizationId, request.params.id, request.authUser!.id))) { reply.code(404); return { error: 'Conversa não encontrada.' }; }
      const body = assignSchema.parse(request.body);
      const atualizado = await svc.assignThread(request.tenantContext!.organizationId, request.params.id, body.userId);
      if (!atualizado) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }

      await auditarAcao(request, {
        action: 'conversation.assigned',
        resourceType: 'conversation_thread',
        resourceId: request.params.id,
        newValue: { assignedToUserId: body.userId },
      });

      return { id: atualizado.id, assigned_to_user_id: atualizado.assignedToUserId };
    });
  });

  await registerWhatsappWebhook(app);
}

const logger = createLogger({ service: 'communications-webhook' });

/**
 * Webhook da Evolution API. BLOCKED_EXTERNAL: endpoint existe e processa o
 * contrato documentado (ver evolution-client.ts), mas nunca foi testado
 * contra uma instância real nesta sessão (sem credencial disponível).
 *
 * Verificação: Evolution API inclui `apikey` no PRÓPRIO corpo do payload
 * (confirmado na documentação pública consultada em 06/10/2026 — ver
 * progress doc). Comparamos contra a apiKey gravada no conector da empresa
 * dona da instância. Isto é mais fraco que uma assinatura HMAC dedicada;
 * registrado aqui como ponto a revisitar quando houver acesso a uma
 * instância real pra confirmar se existe mecanismo melhor (header
 * próprio, por exemplo).
 */
async function registerWhatsappWebhook(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/whatsapp', async (request, reply) => {
    const evento = parseEvolutionWebhookEvent(request.body);
    if (!evento) {
      // Evento que não interessa ao Inbox (connection.update etc.) — 200
      // pra não fazer o provedor reentregar, só ignorado.
      reply.code(200);
      return { ignored: true };
    }

    const conector = await svc.connectorForWhatsappInstance(evento.instance);
    if (!conector) {
      logger.warn({ instance: evento.instance }, 'Webhook do WhatsApp de instância sem empresa dona conhecida');
      reply.code(200); // 200 mesmo assim: não é erro do provedor, é config nossa.
      return { ignored: true };
    }
    const { organizationId } = conector;

    const apikeyRecebida = (request.body as Record<string, unknown> | null)?.['apikey'];
    if (apikeyRecebida !== conector.apiKey) {
      logger.warn({ organizationId, instance: evento.instance }, 'Webhook do WhatsApp com apikey que não confere com o conector gravado, descartado');
      reply.code(200); // não confirma ao remetente se a causa foi auth ou payload — evita oráculo pra quem está testando o endpoint
      return { ignored: true };
    }

    if (evento.data.key.fromMe) {
      // Mensagem que o PRÓPRIO WhatsApp conectado mandou (ex.: via celular
      // do atendente, fora do Desigual) — não é inbound de cliente.
      reply.code(200);
      return { ignored: true };
    }

    const phone = phoneFromRemoteJid(evento.data.key.remoteJid);
    const contato = await svc.findOrCreateContactByPhone({ organizationId, clientId: null, phone, name: evento.data.pushName ?? null });
    const thread = await svc.findOrCreateOpenThread({ organizationId, contactId: contato.id, clientId: contato.clientId, channel: 'whatsapp' });
    await svc.recordInboundMessage({
      organizationId,
      threadId: thread.id,
      clientId: contato.clientId,
      contactId: contato.id,
      channel: 'whatsapp',
      text: evento.data.message?.conversation ?? null,
      externalMessageId: evento.data.key.id,
      occurredAt: evento.data.messageTimestamp ? new Date(evento.data.messageTimestamp * 1000) : new Date(),
    });

    reply.code(200);
    return { ok: true };
  });
}
