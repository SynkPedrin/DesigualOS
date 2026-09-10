import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  createAttributedTask,
  createTaskComment,
  deleteTask,
  getTaskComments,
  getTaskListId,
  getTeamMembers,
  parseTaskChangedEvent,
  parseTaskCommentPostedEvent,
  recordToolResult,
  replyToComment,
  requestToolCall,
  verifyClickUpSignature,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { getRedisConnection, publishWsEvent, recordLearning, recordOperationalEvent } from '@desigual-os/orchestrator';
import { stripBlockMarkers, stripEmDashes } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { resolveClickUpAccess } from '../integrations/access';
import { hasClientAccess } from '../lib/access';
import { respondAsBento } from '../lib/bento-mention';
import { detectMentionedAgent, respondAsAgent, respondAsOtto } from '../lib/agent-mention';

const logger = createLogger({ service: 'clickup-webhook' });

/**
 * Assinatura das respostas que NÓS postamos (o prefixo "🧠 X responde:" vem
 * do serviço do agente). Sem essa guarda o webhook dispara de novo no nosso
 * próprio comentário: a resposta do Bento contém "marcando @Bento" no texto
 * dele, o regex de menção casa, e vira loop infinito (aconteceu de verdade
 * em 04/09/2026: 15 respostas em cadeia na task de teste).
 */
const BOT_REPLY_MARKER = /^🧠\s*(Bento|Jarbas|Suzy)\s+responde/im;

/** TTL do registro de comentário respondido (7 dias) — cobre retries do ClickUp. */
const MENTION_DEDUP_TTL_S = 7 * 24 * 60 * 60;

function mentionDedupKey(commentId: string): string {
  return `clickup:mention-answered:${commentId}`;
}

const createTaskSchema = z.object({
  list_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const createCommentSchema = z.object({
  comment_text: z.string().min(1).max(4000),
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
 * Task criada/editada/apagada no ClickUp (pedido do usuário, 09/09/2026:
 * "se eu criar uma nova task agora em um cliente dentro clickup ele vai
 * atualizar dentro do sistema automatico") - publica um evento leve no WS só
 * com o `client_id` (nunca o conteúdo da task) pro front invalidar a lista
 * de tarefas daquele cliente e refazer o GET /clients/:id/clickup/tasks
 * (fonte real, já existente). `list_id` às vezes não vem no payload (webhook
 * inscrito no escopo do Space inteiro em vez de por lista, ver
 * parseTaskChangedEvent) - nesse caso busca a lista da task na API antes de
 * descartar o evento como "não é de nenhum cliente conhecido".
 */
async function handleTaskChanged(
  changed: { event: string; taskId: string; listId: string | null },
  raw?: Record<string, unknown>,
): Promise<void> {
  const config = getClickUpConfig();
  if (!config) return;

  let listId = changed.listId;
  if (!listId) {
    try {
      listId = await getTaskListId(config, changed.taskId);
    } catch (error) {
      logger.warn({ error, taskId: changed.taskId }, 'ClickUp webhook: não achei a lista da task alterada');
      return;
    }
  }

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
  if (!client) return;

  // EVENT STORE (10/09/2026): antes disto o evento era usado pra invalidar a UI e
  // descartado. Nada ficava, então "o que mudou desde ontem?" era irrespondível. Agora
  // fica gravado de forma idempotente (índice único source+external_id, porque o ClickUp
  // reentrega evento em retry) e vira material de contexto e de proatividade.
  const stored = await recordOperationalEvent({
    source: 'clickup',
    // 'taskCreated' -> 'task.created'
    type: changed.event.replace(/^task/, 'task.').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
    externalId: `${changed.event}:${changed.taskId}:${(raw?.['webhook_id'] as string | undefined) ?? ''}`,
    clientId: client.id,
    entityType: 'task',
    entityId: changed.taskId,
    payload: { list_id: listId, event: changed.event },
    ...(raw ? { raw } : {}),
    occurredAt: new Date(),
  });
  if (stored.status === 'duplicate') {
    logger.debug({ taskId: changed.taskId }, 'Evento reentregue pelo ClickUp, ignorado (idempotencia)');
  }

  await publishWsEvent({
    type: 'clickup.task_changed',
    payload: { client_id: client.id, task_id: changed.taskId, event: changed.event },
  });
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

  // Comentários da tarefa lidos do ClickUp na hora (o "chat" da tarefa).
  // Mesmo acesso da listagem de tarefas (apps/api/src/clients/routes.ts):
  // OAuth pessoal com fallback pra chave compartilhada.
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

  // Postar comentário de verdade na tarefa (composer da aba Conversas do
  // workspace do cliente). Antes de escrever, confirma que a tarefa pertence
  // à lista de um cliente cadastrado e que o usuário tem acesso a ele: sem
  // isso, qualquer autenticado escreveria em qualquer tarefa do workspace
  // do ClickUp só adivinhando o id.
  app.post('/clickup/tasks/:id/comments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    // O parser application/json deste plugin entrega string crua (exigência
    // do webhook com HMAC, mais abaixo), então o parse é manual aqui.
    const rawBody = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const body = createCommentSchema.parse(rawBody);

    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }

    const config = { apiKey: access.token, teamId: access.teamId };

    let listId: string;
    try {
      listId = await getTaskListId(config, params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao localizar a tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }

    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'Task does not belong to any client list known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    try {
      const comment = await createTaskComment(config, params.id, body.comment_text);
      reply.code(201);
      return { comment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao postar comentário na tarefa do ClickUp');
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

    const taskChanged = parseTaskChangedEvent(parsedBody);
    if (taskChanged) {
      await handleTaskChanged(taskChanged, parsedBody as Record<string, unknown>);
      return;
    }

    const event = parseTaskCommentPostedEvent(parsedBody);
    if (!event) {
      logger.debug({ body: parsedBody }, 'ClickUp webhook: evento ignorado ou payload não reconhecido');
      return;
    }

    // Menção a agente (@Bento/@Jarbas/@Suzy/@Otto, variação de caixa) dentro do
    // texto plano do comentário. Formato exato de menção (@user) dentro da
    // estrutura interna do ClickUp não é documentado publicamente; isso é o
    // que dá pra confirmar sem inventar, com o texto plano que a doc garante
    // existir (text_content). Ajustar se um teste real mostrar outro formato.
    const mentionedAgent = detectMentionedAgent(event.textContent);
    if (!mentionedAgent) {
      return;
    }

    // Nunca responder à nossa própria resposta (ver BOT_REPLY_MARKER acima).
    if (BOT_REPLY_MARKER.test(event.textContent)) {
      return;
    }

    // Dedup por commentId: o ClickUp reentrega eventos e cada resposta nossa
    // gera um comentário novo (que também dispara o webhook). O NX garante
    // que cada comentário é respondido no máximo uma vez; o id da resposta é
    // registrado logo depois de postar, antes do evento dela chegar.
    // Se o Redis estiver fora, segue sem dedup: o BOT_REPLY_MARKER acima já
    // impede o loop, e o pior caso é resposta duplicada num retry do ClickUp.
    let redis: ReturnType<typeof getRedisConnection> | null = null;
    try {
      redis = getRedisConnection();
      const claimed = await redis.set(mentionDedupKey(event.commentId), '1', 'EX', MENTION_DEDUP_TTL_S, 'NX');
      if (claimed === null) {
        logger.debug({ commentId: event.commentId }, 'Comentário já respondido (ou resposta nossa), ignorando');
        return;
      }
    } catch (error) {
      redis = null;
      logger.warn({ error, commentId: event.commentId }, 'Redis indisponível, respondendo sem dedup de menção');
    }

    logger.info({ taskId: event.taskId, commentId: event.commentId, agent: mentionedAgent }, 'Menção a agente detectada, disparando resposta');

    try {
      const answer =
        mentionedAgent === 'bento'
          ? await respondAsBento({ taskId: event.taskId, commentId: event.commentId })
          : mentionedAgent === 'otto'
            ? await respondAsOtto({ taskId: event.taskId, commentId: event.commentId })
            : await respondAsAgent(mentionedAgent, { taskId: event.taskId, commentId: event.commentId });
      const config = getClickUpConfig();
      if (config && answer) {
        // Regra de ouro de craft: nunca travessão, nem no ClickUp. Os
        // marcadores [FIM_BLOCO]/[AGUARDA_APROVACAO]/[HANDOFF] dos prompts de
        // personalidade viram parágrafo/texto limpo antes de postar.
        const replyId = await replyToComment(config, event.taskId, event.commentId, stripBlockMarkers(stripEmDashes(answer)));
        await redis?.set(mentionDedupKey(replyId), '1', 'EX', MENTION_DEDUP_TTL_S).catch((error: unknown) => {
          logger.warn({ error, replyId }, 'Falha ao registrar resposta no dedup de menção');
        });
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
