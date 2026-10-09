import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONVERSATION_STATUSES } from '@desigual-os/types';
import { parseEvolutionWebhookEvent, phoneFromRemoteJid } from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import * as svc from './service';

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
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

const sendMessageSchema = z.object({ text: z.string().trim().min(1).max(4000) });
const assignSchema = z.object({ userId: z.string().uuid().nullable() });

interface PresentableThread {
  id: string;
  clientId: string | null;
  clientName: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  channel: string;
  status: string;
  assignedToUserId: string | null;
  lastMessageAt: Date | null;
}

function presentThread(t: PresentableThread | null) {
  if (!t) return null;
  return {
    id: t.id,
    client_id: t.clientId,
    client_name: t.clientName,
    contact_id: t.contactId,
    contact_name: t.contactName,
    contact_phone: t.contactPhone,
    channel: t.channel,
    status: t.status,
    assigned_to_user_id: t.assignedToUserId,
    last_message_at: t.lastMessageAt?.toISOString() ?? null,
  };
}

function presentMessage(m: { id: string; direction: string; senderContactId: string | null; senderUserId: string | null; content: string | null; attachmentUrl: string | null; deliveryStatus: string; createdAt: Date }) {
  return {
    id: m.id,
    direction: m.direction,
    sender_contact_id: m.senderContactId,
    sender_user_id: m.senderUserId,
    content: m.content,
    attachment_url: m.attachmentUrl,
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
        limit: q.limit,
        offset: q.offset,
      });
      return { threads: linhas.map(presentThread) };
    });

    authed.get<{ Params: { id: string } }>('/inbox/threads/:id', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id);
      if (!thread) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      return presentThread(thread);
    });

    authed.get<{ Params: { id: string } }>('/inbox/threads/:id/messages', { preHandler: requirePermission('communications', 'read') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id);
      if (!thread) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
      const mensagens = await svc.listMessages(request.tenantContext!.organizationId, request.params.id, q.limit, q.offset);
      return { messages: mensagens.map(presentMessage) };
    });

    authed.post<{ Params: { id: string } }>('/inbox/threads/:id/messages', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
      const thread = await svc.getThread(request.tenantContext!.organizationId, request.params.id);
      if (!thread) {
        reply.code(404);
        return { error: `Thread '${request.params.id}' not found` };
      }
      const body = sendMessageSchema.parse(request.body);
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

    authed.patch<{ Params: { id: string } }>('/inbox/threads/:id/assign', { preHandler: requirePermission('communications', 'write') }, async (request, reply) => {
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
