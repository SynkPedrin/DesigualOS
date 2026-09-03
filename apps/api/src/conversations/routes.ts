import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { requireAuth } from '../auth/middleware';

export async function registerConversationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { agent?: string; client_id?: string } }>('/conversations', { preHandler: requireAuth }, async (request, reply) => {
    const agentFilter = request.query.agent;
    const clientFilter = request.query.client_id;
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

    // Chat é compartilhado por toda a equipe (pedido do usuário, 2026-09-03):
    // antes filtrava por `userId` do dono; agora qualquer autenticado lista
    // todas as conversas, só os filtros de agente/projeto (acima e abaixo)
    // restringem — é o que alimenta "ver histórico do projeto X" no chat.
    const rows = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          conversationIds ? inArray(schema.conversations.id, conversationIds) : undefined,
          clientFilter ? eq(schema.conversations.clientId, clientFilter) : undefined,
        ),
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(50);

    const conversations = await Promise.all(
      rows.map(async (row) => {
        const [lastMessage] = await db
          .select({ agent: schema.messages.agent, content: schema.messages.content })
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, row.id))
          .orderBy(desc(schema.messages.createdAt))
          .limit(1);

        return {
          id: row.id,
          client_id: row.clientId,
          title: row.title,
          status: row.status,
          last_agent: lastMessage?.agent ?? null,
          last_message_preview: lastMessage?.content?.slice(0, 120) ?? null,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        };
      }),
    );

    return { conversations };
  });

  app.get<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, request.params.id));
      if (!conversation) {
        reply.code(404);
        return { error: `Conversation '${request.params.id}' not found` };
      }
      // Chat compartilhado (mesma decisão do GET /conversations acima): não
      // é mais preciso ser o dono nem master para ler uma conversa.

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
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  );
}
