import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { AGENT_NAMES, CONVERSATION_VISIBILITIES, type AgentName } from '@desigual-os/types';
import { requireAuth, type AuthenticatedUser } from '../auth/middleware';
import { canReadConversationInOrg, tenantSharingScope } from '../lib/access';

type ConversationRow = typeof schema.conversations.$inferSelect;

/**
 * Regra privado/publico (2026-09-04): colaborador lê conversas públicas + as
 * próprias privadas; master lê tudo. Escrita (renomear, mover, excluir) é só
 * do dono ou do master.
 */
export function canReadConversation(user: AuthenticatedUser, conversation: ConversationRow): boolean {
  return conversation.visibility === 'public' || canWriteConversation(user, conversation);
}

export function canWriteConversation(user: AuthenticatedUser, conversation: ConversationRow): boolean {
  return conversation.userId === user.id || user.roles.includes('master');
}

const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(CONVERSATION_VISIBILITIES).optional(),
});

export async function registerConversationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { agent?: string; client_id?: string; project_id?: string } }>('/conversations', { preHandler: requireAuth }, async (request, reply) => {
    const agentFilter = request.query.agent;
    const clientFilter = request.query.client_id;
    // project_id=none lista só as conversas soltas (fora de qualquer projeto),
    // que é a seção "Conversas" da sidebar; um uuid filtra por aquele projeto.
    const projectFilter = request.query.project_id;
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    if (agentFilter && !AGENT_NAMES.includes(agentFilter as AgentName)) {
      reply.code(400);
      return { error: `Unknown agent '${agentFilter}'` };
    }

    let conversationIds: string[] | null = null;
    if (agentFilter) {
      // Uma conversa "pertence" a um agente se ele já respondeu nela ao
      // menos uma vez (é o que o clique num card de agente na tela de
      // Agentes precisa: histórico daquele agente especificamente).
      const rows = await db
        .selectDistinct({ conversationId: schema.messages.conversationId })
        .from(schema.messages)
        .where(and(eq(schema.messages.role, 'assistant'), eq(schema.messages.agent, agentFilter as AgentName)));
      conversationIds = rows.map((row) => row.conversationId);
      if (conversationIds.length === 0) {
        return { conversations: [] };
      }
    }

    const isMaster = user.roles.includes('master');
    // P0-02 (22/09/2026): "público" era global entre organizações — um
    // colaborador de qualquer org lia conversa pública de QUALQUER outra.
    // Escopa "compartilhado" pra DENTRO da própria organização: cliente
    // precisa estar na organização de quem pede; sem cliente, o dono
    // precisa compartilhar organização com quem pede. Master mantém o
    // alcance amplo que já tinha (suporte cross-tenant, decisão existente
    // — não ampliada nem revogada aqui).
    const scope = isMaster ? null : await tenantSharingScope(user.id);
    const publicInScope =
      scope === null
        ? eq(schema.conversations.visibility, 'public')
        : and(
            eq(schema.conversations.visibility, 'public'),
            or(
              scope.allowedClientIds.length > 0 ? inArray(schema.conversations.clientId, scope.allowedClientIds) : undefined,
              and(isNull(schema.conversations.clientId), inArray(schema.conversations.userId, scope.teammateUserIds)),
            ),
          );
    const rows = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          conversationIds ? inArray(schema.conversations.id, conversationIds) : undefined,
          clientFilter ? eq(schema.conversations.clientId, clientFilter) : undefined,
          projectFilter === 'none'
            ? isNull(schema.conversations.projectId)
            : projectFilter
              ? eq(schema.conversations.projectId, projectFilter)
              : undefined,
          isMaster ? undefined : or(publicInScope, eq(schema.conversations.userId, user.id)),
        ),
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(50);

    // A última mensagem de cada conversa era buscada numa query POR conversa
    // (até 50 idas e vindas; com RTT de ~130ms pro Supabase, 5-7s ao vivo).
    // DISTINCT ON resolve numa ida só: a linha mais recente de cada
    // conversation_id, sem mudar nada do que volta pro cliente.
    type LastMessage = Pick<typeof schema.messages.$inferSelect, 'conversationId' | 'agent' | 'content'>;
    const lastMessageByConversation = new Map<string, LastMessage>();
    if (rows.length > 0) {
      const lastMessages = await db
        .selectDistinctOn([schema.messages.conversationId], {
          conversationId: schema.messages.conversationId,
          agent: schema.messages.agent,
          content: schema.messages.content,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.conversationId, rows.map((row) => row.id)))
        .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt));
      for (const message of lastMessages) {
        lastMessageByConversation.set(message.conversationId, message);
      }
    }

    // Agentes por conversa numa query agrupada só (DISTINCT ON
    // conversation+agent, restrita às 50 listadas). Sem isto, a sidebar de
    // /messages disparava GET /conversations?agent=X uma vez POR agente (4
    // scans completos em messages + 4 HTTP) só pra achar a conversa mais
    // recente de cada um (medido na auditoria de performance, 12/09/2026).
    // Campo aditivo: clients antigos simplesmente ignoram `agents`.
    const agentsByConversation = new Map<string, AgentName[]>();
    if (rows.length > 0) {
      const agentRows = await db
        .selectDistinctOn([schema.messages.conversationId, schema.messages.agent], {
          conversationId: schema.messages.conversationId,
          agent: schema.messages.agent,
        })
        .from(schema.messages)
        .where(and(inArray(schema.messages.conversationId, rows.map((row) => row.id)), eq(schema.messages.role, 'assistant')));
      for (const row of agentRows) {
        const list = agentsByConversation.get(row.conversationId) ?? [];
        if (row.agent && !list.includes(row.agent)) list.push(row.agent);
        agentsByConversation.set(row.conversationId, list);
      }
    }

    const conversations = rows.map((row) => {
      const lastMessage = lastMessageByConversation.get(row.id);
      return {
        id: row.id,
        client_id: row.clientId,
        project_id: row.projectId,
        user_id: row.userId,
        title: row.title,
        status: row.status,
        visibility: row.visibility,
        last_agent: lastMessage?.agent ?? null,
        last_message_preview: lastMessage?.content?.slice(0, 120) ?? null,
        agents: agentsByConversation.get(row.id) ?? [],
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      };
    });

    return { conversations };
  });

  app.get<{ Params: { id: string } }>('/conversations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, request.params.id));
    if (!conversation) {
      reply.code(404);
      return { error: `Conversation '${request.params.id}' not found` };
    }
    if (!(await canReadConversationInOrg(user, conversation))) {
      reply.code(403);
      return { error: 'This conversation is private' };
    }
    return {
      id: conversation.id,
      client_id: conversation.clientId,
      project_id: conversation.projectId,
      user_id: conversation.userId,
      title: conversation.title,
      status: conversation.status,
      visibility: conversation.visibility,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
    };
  });

  app.get<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, request.params.id));
      if (!conversation) {
        reply.code(404);
        return { error: `Conversation '${request.params.id}' not found` };
      }
      if (!(await canReadConversationInOrg(user, conversation))) {
        reply.code(403);
        return { error: 'This conversation is private' };
      }

      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, request.params.id))
        .orderBy(asc(schema.messages.createdAt));

      return {
        conversation_id: conversation.id,
        messages: rows.map((row) => ({
          id: row.id,
          role: row.role,
          agent: row.agent,
          content: row.content,
          attachment_url: row.attachmentUrl,
          attachment_type: row.attachmentType,
          attachment_filename: row.attachmentFilename,
          // Lista completa (2026-09): colunas acima seguem só com o primeiro
          // anexo por compatibilidade; o histórico de fato lê daqui.
          attachments: Array.isArray((row.metadata as { attachments?: unknown })?.attachments)
            ? (row.metadata as { attachments: Array<{ url: string; filename: string; contentType: string }> })
                .attachments
            : [],
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  );

  app.patch<{ Params: { id: string } }>('/conversations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const body = updateConversationSchema.parse(request.body);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, request.params.id));
    if (!conversation) {
      reply.code(404);
      return { error: `Conversation '${request.params.id}' not found` };
    }
    if (!canWriteConversation(user, conversation)) {
      reply.code(403);
      return { error: 'Only the owner or a master can change this conversation' };
    }

    if (body.project_id) {
      const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, body.project_id));
      if (!project) {
        reply.code(404);
        return { error: `Project '${body.project_id}' not found` };
      }
    }

    const [updated] = await db
      .update(schema.conversations)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.project_id !== undefined ? { projectId: body.project_id } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.conversations.id, request.params.id))
      .returning();

    return {
      id: updated!.id,
      client_id: updated!.clientId,
      project_id: updated!.projectId,
      user_id: updated!.userId,
      title: updated!.title,
      status: updated!.status,
      visibility: updated!.visibility,
      created_at: updated!.createdAt.toISOString(),
      updated_at: updated!.updatedAt.toISOString(),
    };
  });

  // Delete real (não soft): a FK de messages tem onDelete cascade, então as
  // mensagens morrem junto - é o que "Excluir conversa" promete na UI.
  app.delete<{ Params: { id: string } }>('/conversations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, request.params.id));
    if (!conversation) {
      reply.code(404);
      return { error: `Conversation '${request.params.id}' not found` };
    }
    if (!canWriteConversation(user, conversation)) {
      reply.code(403);
      return { error: 'Only the owner or a master can delete this conversation' };
    }
    await db.delete(schema.conversations).where(eq(schema.conversations.id, request.params.id));
    reply.code(204);
    return null;
  });
}
