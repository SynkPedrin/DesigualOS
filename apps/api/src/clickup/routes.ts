import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  createAttributedTask,
  deleteTask,
  getTaskComments,
  getTeamMembers,
  parseTaskCommentPostedEvent,
  recordToolResult,
  replyToComment,
  requestToolCall,
  verifyClickUpSignature,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { recordLearning } from '@desigual-os/orchestrator';
import { requireAuth, requirePermission } from '../auth/middleware';
import { resolveClickUpAccess } from '../integrations/access';
import { respondAsBento } from '../lib/bento-mention';
import { detectMentionedAgent, respondAsAgent } from '../lib/agent-mention';

const logger = createLogger({ service: 'clickup-webhook' });

const createTaskSchema = z.object({
  list_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const taskParamsSchema = z.object({
  id: z.string().min(1),
});

function getClickUpConfig(): { apiKey: string; teamId: string } | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Uma única chave de API do ClickUp compartilhada (decisão do usuário, mais
 * simples que OAuth por colaborador). Atribuição de tarefa por e-mail
 * (users.clickup_email), ver packages/tool-gateway. NÃO TESTADO CONTRA A
 * API REAL ainda: aguardando o usuário gerar e enviar CLICKUP_API_KEY e
 * CLICKUP_TEAM_ID.
 */
export async function registerClickUpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/clickup/tasks', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.authUser?.id ?? ''));

    const result = await createAttributedTask(config, {
      listId: body.list_id,
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      requesterName: user?.name ?? request.authUser?.email ?? 'desconhecido',
      requesterClickUpEmail: user?.clickupEmail ?? null,
    });

    await db.insert(schema.auditLogs).values({
      userId: request.authUser?.id ?? null,
      action: 'clickup.task_created',
      result: 'completed',
      metadata: { list_id: body.list_id, task_id: result.id, assigned: result.assigned },
    });

    reply.code(201);
    return { id: result.id, url: result.url, assigned: result.assigned };
  });

  // Deletar tarefa é a ação crítica citada na seção 6.6 (Tool Gateway):
  // passa pela fila de aprovação humana em vez de executar na hora (ver
  // packages/tool-gateway/src/gateway.ts e apps/api/src/tool-calls/routes.ts).
  app.delete<{ Params: { id: string } }>('/clickup/tasks/:id', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    const outcome = await requestToolCall({
      agent: 'bento',
      tool: 'clickup.delete_task',
      input: { task_id: request.params.id },
    });

    if (outcome.status === 'denied') {
      reply.code(403);
      return { error: 'Agent has no access to clickup.delete_task', tool_call_id: outcome.toolCallId };
    }

    if (outcome.status === 'pending_approval') {
      reply.code(202);
      return { status: 'pending_approval', tool_call_id: outcome.toolCallId };
    }

    try {
      await deleteTask(config, request.params.id);
      await recordToolResult(outcome.toolCallId, 'completed', { task_id: request.params.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordToolResult(outcome.toolCallId, 'failed', null, message);
      reply.code(502);
      return { error: message };
    }

    return { status: 'completed', tool_call_id: outcome.toolCallId };
  });

  app.get('/clickup/members', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (_request, reply) => {
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    const members = await getTeamMembers(config);
    return { members: members.map((member) => ({ id: member.id, email: member.email, username: member.username })) };
  });

  // Comentários da tarefa lidos do ClickUp na hora (o "chat" da tarefa que a
  // aba Conversas do workspace do cliente mostra). Mesmo acesso da listagem
  // de tarefas (apps/api/src/clients/routes.ts): OAuth pessoal com fallback
  // pra chave compartilhada. Só leitura: postar comentário passa pelo fluxo
  // de menção a agente no webhook, não por aqui.
  app.get('/clickup/tasks/:id/comments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);

    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }

    try {
      const comments = await getTaskComments({ apiKey: access.token, teamId: access.teamId }, params.id);
      return {
        comments: comments.map((comment) => ({
          id: comment.id,
          text: comment.text,
          user_id: comment.userId,
          username: comment.username,
          date: comment.date,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao buscar comentários da tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  // Assinatura HMAC precisa do corpo EXATO que o ClickUp mandou (confirmado
  // na doc oficial: "stringify sem espaço extra"), não do objeto já
  // reparseado pelo parser padrão do Fastify. Esse content-type parser só
  // vale dentro deste plugin (encapsulamento do Fastify), não afeta as
  // outras rotas registradas em server.ts.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  // Única rota pública de verdade do Orchestrator (todo o resto só existe
  // na rede Tailscale): o ClickUp não está na malha, então precisa de um
  // endereço público pra avisar sobre eventos. A assinatura verificada é o
  // que torna isso seguro mesmo exposto (decisão registrada no vault,
  // "webhook público").
  app.post('/clickup/webhook', async (request, reply) => {
    const secret = process.env.CLICKUP_WEBHOOK_SECRET;
    if (!secret) {
      reply.code(500);
      return { error: 'CLICKUP_WEBHOOK_SECRET not configured on the Orchestrator' };
    }

    const rawBody = request.body as string;
    const signature = request.headers['x-signature'];
    if (!verifyClickUpSignature(rawBody, typeof signature === 'string' ? signature : undefined, secret)) {
      reply.code(401);
      return { error: 'Invalid signature' };
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      reply.code(400);
      return { error: 'Invalid JSON' };
    }

    // Responde rápido (mesmo padrão do listener real do Jarbas): o
    // processamento de verdade acontece depois, o ClickUp só precisa de um
    // 200 confirmando que recebemos.
    reply.code(200).send({ ok: true });

    const event = parseTaskCommentPostedEvent(parsedBody);
    if (!event) {
      logger.debug({ body: parsedBody }, 'ClickUp webhook: evento ignorado ou payload não reconhecido');
      return;
    }

    // Menção a agente (@Bento/@Jarbas/@Suzy, variação de caixa) dentro do
    // texto plano do comentário. Formato exato de menção (@user) dentro da
    // estrutura interna do ClickUp não é documentado publicamente; isso é o
    // que dá pra confirmar sem inventar, com o texto plano que a doc garante
    // existir (text_content). Ajustar se um teste real mostrar outro formato.
    const mentionedAgent = detectMentionedAgent(event.textContent);
    if (!mentionedAgent) {
      return;
    }

    logger.info({ taskId: event.taskId, commentId: event.commentId, agent: mentionedAgent }, 'Menção a agente detectada, disparando resposta');

    try {
      const answer =
        mentionedAgent === 'bento'
          ? await respondAsBento({ taskId: event.taskId, commentId: event.commentId })
          : await respondAsAgent(mentionedAgent, { taskId: event.taskId, commentId: event.commentId });
      const config = getClickUpConfig();
      if (config && answer) {
        await replyToComment(config, event.taskId, event.commentId, answer);
        await recordLearning({
          kind: 'clickup.mention_answered',
          agent: mentionedAgent,
          content: `${mentionedAgent} respondeu uma menção na tarefa ${event.taskId} do ClickUp. Pergunta: "${event.textContent.slice(0, 200)}".`,
          metadata: { task_id: event.taskId, comment_id: event.commentId },
        });
      }
    } catch (error) {
      logger.error({ error, taskId: event.taskId, commentId: event.commentId, agent: mentionedAgent }, 'Falha ao responder menção de agente');
    }
  });
}
