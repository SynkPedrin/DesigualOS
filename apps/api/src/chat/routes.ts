import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { buildContext, formatContextForPrompt } from '@desigual-os/context-engine';
import { route, type RouterDecision } from '@desigual-os/router';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { requireAuth } from '../auth/middleware';

const AGENT_HINTS = ['AUTO', ...AGENT_NAMES.map((agent) => agent.toUpperCase())] as [string, ...string[]];

const chatRequestSchema = z.object({
  message: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  agent_hint: z.enum(AGENT_HINTS).default('AUTO'),
});

function manualDecision(agent: AgentName): RouterDecision {
  return {
    intent: 'manual_override',
    primary_agent: agent,
    required_tools: [],
    context: [],
    estimated_complexity: 'medium',
    workflow: null,
    confidence: 1,
    source: 'manual',
  };
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', { preHandler: requireAuth }, async (request, reply) => {
    const body = chatRequestSchema.parse(request.body);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    // Conversation Context (seção 6.4): continua uma conversa existente ou
    // abre uma nova. User -> Conversation -> Execution (seção 6.3).
    let conversationId = body.conversation_id ?? null;
    if (conversationId) {
      const [existing] = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.id, conversationId));
      if (!existing) {
        reply.code(404);
        return { error: `Conversation '${conversationId}' not found` };
      }
      // Chat compartilhado (pedido do usuário, 2026-09-03): antes só o dono
      // (ou master) podia postar numa conversa existente; agora qualquer
      // colaborador autenticado pode continuar qualquer conversa.
    } else {
      const [conversation] = await db
        .insert(schema.conversations)
        .values({ userId: user.id, clientId: body.client_id ?? null, title: body.message.slice(0, 80) })
        .returning();
      conversationId = conversation?.id ?? null;
    }

    if (!conversationId) {
      // Só chega aqui se o insert da nova conversa acima não retornou
      // linha nenhuma (ex: constraint bloqueando); antes disso virava
      // `conversationId: ''` no insert de messages.conversationId, uma
      // coluna uuid NOT NULL, e o Postgres respondia com um 500 cru de
      // "invalid input syntax" em vez de um erro claro.
      reply.code(500);
      return { error: 'Failed to create conversation' };
    }

    const [userMessage] = await db
      .insert(schema.messages)
      .values({ conversationId, role: 'user', content: body.message })
      .returning();

    const decision =
      body.agent_hint === 'AUTO'
        ? await route(body.message, request.log)
        : manualDecision(body.agent_hint.toLowerCase() as AgentName);

    const context = await buildContext({ userId: user.id, clientId: body.client_id ?? null, conversationId });
    const contextBlock = formatContextForPrompt(context);
    const messageWithContext = contextBlock ? `${body.message}\n\n---\nContexto:\n${contextBlock}` : body.message;

    const result = await dispatchChatMessage({
      message: messageWithContext,
      userId: user.id,
      clientId: body.client_id ?? null,
      conversationId,
      decision,
    });

    if (result.status === 'unavailable') {
      reply.code(503);
      return { error: result.error };
    }

    request.log.info({ conversationId, messageId: userMessage?.id }, 'Chat message dispatched');

    reply.code(202);
    return { execution_id: result.executionId, status: result.status, agent: result.agent, conversation_id: conversationId };
  });
}
