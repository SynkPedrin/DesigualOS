import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  createAttributedTask,
  createTaskComment,
  deleteTask,
  findMemberByEmail,
  getTaskComments,
  getTaskListId,
  getTeamMembers,
  parseTaskChangedEvent,
  parseTaskCommentPostedEvent,
  queryOperationTasks,
  recordToolResult,
  replyToComment,
  requestToolCall,
  updateTask,
  uploadTaskAttachment,
  verifyClickUpSignature,
  type OperationTask,
} from '@desigual-os/tool-gateway';
import { precisaResincronizar, sincronizarCampanhasDoCliente } from '@desigual-os/context-engine';
import { createLogger } from '@desigual-os/logging';
import { getRedisConnection, publishWsEvent, recordLearning, recordOperationalEvent } from '@desigual-os/orchestrator';
import { stripBlockMarkers, stripEmDashes } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { resolveClickUpAccess } from '../integrations/access';
import { hasClientAccess } from '../lib/access';
import { claimIdempotency, fulfillIdempotency, idempotencyKey, releaseIdempotency } from '../lib/idempotency';
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
  // BL-15: criação completa (prioridade 1-4 na escala do ClickUp, prazo em
  // epoch ms, tags por nome).
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  due_date: z.number().int().positive().optional(),
  tags: z.array(z.string().min(1)).max(10).optional(),
});

const updateTaskSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.string().min(1).optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    due_date: z.number().int().positive().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field to update is required',
  });

const createCommentSchema = z.object({
  comment_text: z.string().min(1).max(4000),
});

const attachmentSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(200),
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
 * Mapa lista-do-ClickUp -> cliente (id/nome), base de autorização de toda
 * consulta "agência inteira": `queryOperationTasks` SEMPRE recebe só as
 * listas daqui como `listIds` - nunca vazio/omitido nessas rotas, porque
 * omitir o filtro significa "todo o workspace do ClickUp", não "todos os
 * clientes cadastrados no Desigual OS" (ver nota de autorização no topo de
 * clickup-operation.ts). Cliente sem `clickup_list_id` fica de fora, o que é
 * o comportamento certo (nada pra buscar por ele ainda).
 */
async function clientsByClickUpListId(): Promise<Map<string, { id: string; name: string }>> {
  const rows = await db
    .select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
    .from(schema.clients);
  const map = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    if (row.clickupListId) map.set(row.clickupListId, { id: row.id, name: row.name });
  }
  return map;
}

function wireOperationTask(task: OperationTask, clientByListId: Map<string, { id: string; name: string }>) {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    status_type: task.statusType,
    priority: task.priority,
    url: task.url,
    due_date: task.dueDate,
    start_date: task.startDate,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    assignees: task.assignees,
    tags: task.tags,
    list_name: task.listName,
    client: task.listId ? (clientByListId.get(task.listId) ?? null) : null,
  };
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

  // SYNC INCREMENTAL do registro de campanhas. O evento do ClickUp já chegava
  // aqui e só invalidava UI; agora ele mantém o conhecimento do agente vivo:
  // task nova/alterada re-deriva as campanhas daquele cliente. `precisaResincronizar`
  // segura a frequência (janela de 5 min por cliente), senão uma conta movimentada
  // como a D. Carvalho dispararia releitura de 900+ tasks a cada clique.
  if (await precisaResincronizar(client.id).catch(() => false)) {
    void sincronizarCampanhasDoCliente(client.id, listId, async (lista) => {
      const page = await queryOperationTasks(config, { listIds: [lista], includeClosed: true, subtasks: true }).catch(() => null);
      return (page?.tasks ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        status: t.status,
        closed: t.statusType === 'closed' || t.statusType === 'done',
        updatedAt: t.updatedAt ? new Date(t.updatedAt) : null,
      }));
    }).catch((error: unknown) => {
      logger.warn({ error, clientId: client.id }, 'Sync incremental de campanhas falhou');
    });
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

    // Autorização de escopo (auditoria pré-deploy 14/09/2026): antes desta
    // checagem, qualquer autenticado com clickup:write criava tarefa em
    // QUALQUER lista do workspace do ClickUp, bastava adivinhar o list_id.
    // Mesmo padrão do POST /clickup/tasks/:id/comments abaixo: a lista precisa
    // pertencer a um cliente cadastrado e o usuário precisa de acesso a ele.
    // Vem antes da idempotência pra não consumir a janela de dedup com
    // chamada que nunca seria autorizada.
    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, body.list_id));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'List does not belong to any client known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    // Idempotência de intenção (auditoria 11/09/2026: double submit criou 2
    // tasks reais no ClickUp, ids 86bbz5h7q/86bbz5h7v). Janela curta contra
    // clique duplo e retry de rede; criar duas tasks com o mesmo nome de
    // propósito segue possível após os 15s da janela.
    const idemKey = idempotencyKey('clickup-task', [request.authUser?.id, body.list_id, body.name]);
    const existing = await claimIdempotency(idemKey);
    if (existing !== null) {
      if (existing !== 'pending') {
        try {
          const replay = JSON.parse(existing) as { id: string; url: string; assigned: boolean };
          reply.code(201);
          return { ...replay, deduplicated: true };
        } catch {
          // valor corrompido: cai no 409 abaixo
        }
      }
      reply.code(409);
      return { error: 'Uma tarefa idêntica já está sendo criada. Aguarde um instante.' };
    }

    try {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.authUser?.id ?? ''));

    const result = await createAttributedTask(config, {
      listId: body.list_id,
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      requesterName: user?.name ?? request.authUser?.email ?? 'desconhecido',
      requesterClickUpEmail: user?.clickupEmail ?? null,
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.due_date !== undefined ? { dueDate: body.due_date } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
    });

    await db.insert(schema.auditLogs).values({
      userId: request.authUser?.id ?? null,
      action: 'clickup.task_created',
      result: 'completed',
      metadata: { list_id: body.list_id, task_id: result.id, assigned: result.assigned },
    });

    await fulfillIdempotency(idemKey, JSON.stringify({ id: result.id, url: result.url, assigned: result.assigned }));

    reply.code(201);
    return { id: result.id, url: result.url, assigned: result.assigned };
    } catch (error) {
      await releaseIdempotency(idemKey);
      throw error;
    }
  });

  // Deletar tarefa é a ação crítica citada na seção 6.6 (Tool Gateway):
  // passa pela fila de aprovação humana em vez de executar na hora (ver
  // packages/tool-gateway/src/gateway.ts e apps/api/src/tool-calls/routes.ts).
  // Antes da fila, a mesma checagem de dono do comentário/anexo (auditoria
  // pré-deploy 14/09/2026): sem ela, qualquer autenticado enfileirava a
  // deleção de qualquer task do workspace só adivinhando o id.
  app.delete<{ Params: { id: string } }>('/clickup/tasks/:id', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    let listId: string;
    try {
      listId = await getTaskListId(config, request.params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: request.params.id }, 'Falha ao localizar a tarefa no ClickUp');
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

  /**
   * BL-01 (auditoria forense 12/09/2026): editar task não existia. Segue o
   * mesmo padrão do DELETE: passa pela fila de aprovação humana do Tool
   * Gateway (clickup.update_task). A executor mora em tool-calls/routes.ts.
   * Mesma checagem de dono do DELETE antes de enfileirar (auditoria
   * pré-deploy 14/09/2026).
   */
  app.patch<{ Params: { id: string } }>('/clickup/tasks/:id', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const body = updateTaskSchema.parse(request.body);
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    let listId: string;
    try {
      listId = await getTaskListId(config, request.params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: request.params.id }, 'Falha ao localizar a tarefa no ClickUp');
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

    const outcome = await requestToolCall({
      agent: 'bento',
      tool: 'clickup.update_task',
      input: { task_id: request.params.id, fields: body },
    });

    if (outcome.status === 'denied') {
      reply.code(403);
      return { error: 'Agent has no access to clickup.update_task', tool_call_id: outcome.toolCallId };
    }

    if (outcome.status === 'pending_approval') {
      reply.code(202);
      return { status: 'pending_approval', tool_call_id: outcome.toolCallId };
    }

    try {
      await updateTask(config, request.params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.due_date !== undefined ? { dueDate: body.due_date } : {}),
      });
      await recordToolResult(outcome.toolCallId, 'completed', { task_id: request.params.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordToolResult(outcome.toolCallId, 'failed', null, message);
      reply.code(502);
      return { error: message };
    }

    await db.insert(schema.auditLogs).values({
      userId: request.authUser?.id ?? null,
      action: 'clickup.task_updated',
      result: 'completed',
      metadata: { task_id: request.params.id, fields: Object.keys(body) },
    });

    return { status: 'completed', tool_call_id: outcome.toolCallId };
  });

  /**
   * BL-05: anexo real numa task do ClickUp. O arquivo já está no nosso
   * Storage (upload do chat via POST /uploads); baixamos e reenviamos como
   * multipart. Mesma proteção do comentário: a task precisa pertencer à
   * lista de um cliente cadastrado e o usuário precisa de acesso a ele.
   */
  app.post<{ Params: { id: string } }>('/clickup/tasks/:id/attachments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = attachmentSchema.parse(request.body);

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
      const attached = await uploadTaskAttachment(config, params.id, body.url, body.filename);
      reply.code(201);
      return { status: 'attached', task_id: params.id, filename: body.filename, attachment_id: attached.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao anexar arquivo na tarefa do ClickUp');
      reply.code(502);
      return { error: message };
    }
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

  /**
   * "Central de Tasks" (pedido do usuário, 10/09/2026): todas as tarefas de
   * TODOS os clientes com lista vinculada no ClickUp, numa view só - antes só
   * existia por cliente (GET /clients/:id/clickup/tasks). Reusa
   * `queryOperationTasks` (GET /team/{id}/task, já existia só pro contexto de
   * chat dos agentes) - esta é a primeira rota que expõe isso pro navegador.
   */
  app.get('/clickup/tasks/agency', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }

    const clientByListId = await clientsByClickUpListId();
    if (clientByListId.size === 0) {
      return { tasks: [], truncated: false };
    }

    try {
      const { tasks, truncated } = await queryOperationTasks(
        { apiKey: access.token, teamId: access.teamId },
        { listIds: [...clientByListId.keys()] },
      );
      return { tasks: tasks.map((task) => wireOperationTask(task, clientByListId)), truncated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error }, 'Falha ao buscar tarefas da agência no ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  /**
   * Só as tarefas atribuídas ao usuário logado, resolvido por
   * `users.clickup_email` -> id numérico do ClickUp (`findMemberByEmail`).
   * 409 quando ainda não vinculou e-mail nenhum, ou quando o e-mail vinculado
   * não bate com nenhum membro do workspace - mesmo padrão de "cliente sem
   * lista" já usado no resto deste arquivo: estado esperado, não erro de
   * sistema (a UI mostra um convite pra vincular, não uma tela de erro).
   */
  app.get('/clickup/tasks/me', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.authUser?.id ?? ''));
    if (!user?.clickupEmail) {
      reply.code(409);
      return { error: 'No ClickUp email linked for this user yet' };
    }

    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }
    const config = { apiKey: access.token, teamId: access.teamId };

    const member = await findMemberByEmail(config, user.clickupEmail);
    if (!member) {
      reply.code(409);
      return { error: 'Linked ClickUp email does not match any member of the workspace' };
    }

    const clientByListId = await clientsByClickUpListId();
    if (clientByListId.size === 0) {
      return { tasks: [], truncated: false };
    }

    try {
      const { tasks, truncated } = await queryOperationTasks(config, {
        listIds: [...clientByListId.keys()],
        assigneeIds: [member.id],
      });
      return { tasks: tasks.map((task) => wireOperationTask(task, clientByListId)), truncated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, userId: request.authUser?.id }, 'Falha ao buscar tarefas do usuário no ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  // Comentários da tarefa lidos do ClickUp na hora (o "chat" da tarefa).
  // Mesmo acesso da listagem de tarefas (apps/api/src/clients/routes.ts):
  // OAuth pessoal com fallback pra chave compartilhada. Leitura também é
  // escopada (auditoria pré-deploy 14/09/2026): antes desta checagem,
  // qualquer autenticado lia os comentários de qualquer tarefa do workspace
  // só adivinhando o id - mesma proteção do POST de comentário abaixo.
  app.get('/clickup/tasks/:id/comments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);

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
      const comments = await getTaskComments(config, params.id);
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
    const body = createCommentSchema.parse(request.body);

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
  // reparseado pelo parser padrão do Fastify. O parser de string crua fica
  // encapsulado NUM ESCOPO SÓ DO WEBHOOK: registrado no plugin inteiro, ele
  // quebrava o parse JSON de POST /clickup/tasks e /clickup/tasks/:id/comments
  // (achado real da auditoria de 11/09/2026: criação de task retornava 400
  // "Expected object, received string" em 100% das chamadas).
  await app.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

    // Única rota pública de verdade do Orchestrator (todo o resto só existe
    // na rede Tailscale): o ClickUp não está na malha, então precisa de um
    // endereço público pra avisar sobre eventos. A assinatura verificada é o
    // que torna isso seguro mesmo exposto (decisão registrada no vault,
    // "webhook público").
    webhook.post('/clickup/webhook', async (request, reply) => {
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
  });
}
