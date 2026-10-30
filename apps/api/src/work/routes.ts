import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { gravarAnexo, abrirAnexo, apagarAnexo, copiarAnexo, tipoParaServir, politicaDeAnexos, AnexoRecusado } from '../internal-chat/arquivos';
import { anexoAcessivel } from '../internal-chat/service';
import { copiarAnexosDoClickUp } from './anexos-externos';
import { z } from 'zod';
import { sincroniaDoDailyLigada, sincronizarTarefaNoDaily, tamanhoDaFilaDeFundo, ultimasSincronias, varrerAlteracoesDoClickUp } from '../clickup/sincronia-daily';
import { empurrarEventosDaEmpresa, escritaNoClickUpLigada, ultimasEscritas } from '../clickup/escrita-daily';
import { db, schema } from '@desigual-os/database';
import {
  HTTP_STATUS,
  addAttachmentLink,
  listTaskApprovals,
  requestTaskApproval,
  resolveTaskApproval,
  addDependency,
  addManualEntry,
  followTask,
  getPreferences,
  getTaskHistory,
  setPreferences,
  unfollowTask,
  deleteAttachment,
  deleteChecklist,
  deleteChecklistItem,
  deleteComment,
  deleteContainerPermanently,
  deleteTaskPermanently,
  editChecklistItem,
  editComment,
  listInboxUnified,
  markInboxReadAll,
  removeDependency,
  renameChecklist,
  renameFolder,
  testAutomation,
  clientWorkSummary,
  createTaskFromSource,
  findTasksBySource,
  automationTick,
  createAutomation,
  createCustomField,
  createRecurrence,
  createSavedView,
  createTemplateFromTask,
  deleteAutomation,
  deleteSavedView,
  deleteTemplate,
  duplicateTask,
  inboxUnreadCount,
  instantiateTemplate,
  listAutomationRuns,
  listAutomations,
  listCustomFields,
  listInbox,
  listRecurrences,
  listSavedViews,
  listTemplates,
  listTimeEntries,
  markInboxRead,
  runningTimer,
  setCustomFieldValue,
  setRecurrenceActive,
  startTimer,
  stopTimer,
  updateAutomation,
  workOverview,
  workReport,
  addChecklistItem,
  addComment,
  createChecklist,
  getTaskDetail,
  setChecklistItemDone,
  WorkError,
  bulkUpdateTasks,
  createFolder,
  createList,
  createProject,
  createSpace,
  createStatus,
  createTask,
  deleteStatus,
  getFlag,
  getTask,
  getTaskActivity,
  getTaskByKey,
  getTree,
  listStatuses,
  listTasks,
  listTransitions,
  moveTask,
  renameList,
  resolveDailyTasksAccess,
  setArchived,
  recuarCursorDaSaida,
  setFlag,
  setTaskArchived,
  setTransitionsFrom,
  updateProject,
  updateSpace,
  updateStatus,
  updateTask,
} from '@desigual-os/work-engine';
import { requireAuth } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import { requireDailyTasks, workContext } from './guard';
import { ehEmailDePessoaDoClickUp } from '../clickup/pessoas-do-clickup';

/**
 * Daily Tasks — API do motor nativo de trabalho (Beta, só administradores autorizados).
 *
 * Camada FINA: valida o payload, aplica a guarda de acesso e traduz o erro do motor em HTTP. Nenhuma regra
 * de negócio mora aqui (ela vive em packages/work-engine). A empresa SEMPRE vem do tenant resolvido pelo
 * servidor, nunca do corpo ou de um id citado: um id de outra empresa responde 404, igual a um que não existe.
 */

const uuid = z.string().uuid();
const date = z.union([z.string().datetime({ offset: true }), z.null()]).transform((v) => (v === null ? null : new Date(v)));
const optDate = z.union([z.string().datetime({ offset: true }), z.null()]).optional().transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof WorkError) {
    reply.code(HTTP_STATUS[error.code]);
    return { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) };
  }
  throw error;
}

const taskBody = z.object({
  listId: uuid,
  title: z.string(),
  description: z.string().max(50_000).nullable().optional(),
  statusId: uuid.optional(),
  priority: z.number().int().min(0).max(4).optional(),
  assigneeIds: z.array(uuid).max(20).optional(),
  startAt: optDate,
  dueAt: optDate,
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  clientId: uuid.nullable().optional(),
  tags: z.array(z.string()).max(30).optional(),
  parentTaskId: uuid.nullable().optional(),
});

const patchBody = z.object({
  title: z.string().optional(),
  description: z.string().max(50_000).nullable().optional(),
  statusId: uuid.optional(),
  priority: z.number().int().min(0).max(4).optional(),
  startAt: optDate,
  dueAt: optDate,
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  clientId: uuid.nullable().optional(),
  tags: z.array(z.string()).max(30).optional(),
  assigneeIds: z.array(uuid).max(20).optional(),
  position: z.number().optional(),
  expectedVersion: z.number().int().optional(),
});

/** zod produz `undefined` explícito em chaves ausentes; o motor distingue "ausente" de "nulo", então removo as ausentes. */
function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

export async function registerWorkRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: requireDailyTasks };

  // ── Acesso ─────────────────────────────────────────────────────────────
  /** O front pergunta isto para decidir se mostra o item de menu. Responde só "sim/não", sem detalhes de configuração. */
  app.get('/work/access', { preHandler: [requireAuth, requireTenant] }, async (request) => {
    const d = await resolveDailyTasksAccess({ organizationId: request.tenantContext!.organizationId, userId: request.authUser!.id, platformRoles: request.authUser!.roles });
    return { allowed: d.allowed, userId: request.authUser!.id };
  });

  /** Liga/desliga e escolhe quem entra. SÓ administrador de plataforma (`master`), e fora da própria flag (senão ninguém ligaria). */
  const adminOnly = async (request: Parameters<typeof requireAuth>[0], reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireTenant(request, reply);
    if (reply.sent) return;
    if (!request.authUser!.roles.includes('master')) reply.code(403).send({ error: 'Só o administrador da plataforma configura o Daily Tasks.' });
  };
  // Copia os anexos que vieram do ClickUp como link para o armazenamento próprio. Em lotes, repetível, só master.
  app.post('/work/admin/copy-clickup-attachments', { preHandler: adminOnly }, async (request, reply) => {
    const b = z.object({ limit: z.number().int().min(1).max(100).optional(), dryRun: z.boolean().optional() }).safeParse(request.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'Dados inválidos.' });
    const organizationId = request.tenantContext!.organizationId;
    const r = await copiarAnexosDoClickUp({ organizationId, ...(b.data.limit ? { limite: b.data.limit } : {}), ...(b.data.dryRun ? { simular: true } : {}) });
    await auditarAcao(request, { action: 'work.attachments.copied', organizationId, metadata: { copiados: r.copiados, recusados: r.recusados.length, falhas: r.falhas.length, dryRun: Boolean(b.data.dryRun) } });
    return r;
  });
  app.get('/work/admin/flag', { preHandler: adminOnly }, async (request) => getFlag(request.tenantContext!.organizationId));
  app.put('/work/admin/flag', { preHandler: adminOnly }, async (request, reply) => {
    const body = z.object({ enabled: z.boolean(), allowedUserIds: z.array(uuid).max(100) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join(' ') });
    try {
      await setFlag({ organizationId: request.tenantContext!.organizationId, enabled: body.data.enabled, allowedUserIds: body.data.allowedUserIds, updatedBy: request.authUser!.id });
    } catch (e) {
      return fail(reply, e);
    }
    await auditarAcao(request, { action: 'work.flag.changed', organizationId: request.tenantContext!.organizationId, metadata: { enabled: body.data.enabled, allowed: body.data.allowedUserIds.length } });
    return getFlag(request.tenantContext!.organizationId);
  });

  // ── Sincronia ClickUp → Daily (ver clickup/sincronia-daily.ts). Só administrador da plataforma. ─────────
  app.get('/work/admin/clickup-sync', { preHandler: adminOnly }, async () => ({
    entrada: { ligada: sincroniaDoDailyLigada(), ultimas: ultimasSincronias(), filaDeFundo: tamanhoDaFilaDeFundo() },
    saida: { ligada: escritaNoClickUpLigada(), ultimas: ultimasEscritas() },
  }));
  app.post('/work/admin/clickup-sync/empurrar', { preHandler: adminOnly }, async (request, reply) => {
    if (!escritaNoClickUpLigada()) return reply.code(409).send({ error: 'A escrita para o ClickUp está desligada (DAILY_SYNC_CLICKUP_ESCRITA).' });
    try {
      return await empurrarEventosDaEmpresa(request.tenantContext!.organizationId);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Falha ao empurrar para o ClickUp.' });
    }
  });
  // Reenvia ao ClickUp o que foi feito no Daily desde `desde` (no máximo 48 h atrás). Para recuperar edições que a
  // saída pulou (cerca de teste, ClickUp fora por mais que o ciclo aguenta). Reenviar não duplica.
  app.post('/work/admin/clickup-sync/reenviar', { preHandler: adminOnly }, async (request, reply) => {
    if (!escritaNoClickUpLigada()) return reply.code(409).send({ error: 'A escrita para o ClickUp está desligada (DAILY_SYNC_CLICKUP_ESCRITA).' });
    const body = z.object({ desde: z.string().datetime() }).safeParse(request.body);
    if (!body.success) return bad(reply);
    const desde = new Date(body.data.desde);
    if (desde.getTime() > Date.now() || Date.now() - desde.getTime() > 48 * 3_600_000) return reply.code(400).send({ error: 'O instante precisa estar nas últimas 48 horas.' });
    const organizationId = request.tenantContext!.organizationId;
    if (!(await recuarCursorDaSaida(organizationId, desde))) return reply.code(409).send({ error: 'A saída ainda não começou nesta empresa.' });
    await auditarAcao(request, { action: 'work.clickup_sync.resend', organizationId, metadata: { desde: desde.toISOString() } });
    return { ok: true, desde: desde.toISOString() };
  });
  app.post('/work/admin/clickup-sync/varrer', { preHandler: adminOnly }, async (request, reply) => {
    if (!sincroniaDoDailyLigada()) return reply.code(409).send({ error: 'A sincronia está desligada (DAILY_SYNC_CLICKUP).' });
    try {
      const v = await varrerAlteracoesDoClickUp();
      await auditarAcao(request, { action: 'work.clickup_sync.sweep', organizationId: request.tenantContext!.organizationId, metadata: { lidas: v.lidas } });
      return { lidas: v.lidas, resultados: v.resultados };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Falha ao varrer o ClickUp.' });
    }
  });
  app.post('/work/admin/clickup-sync/tarefa', { preHandler: adminOnly }, async (request, reply) => {
    const body = z.object({ taskId: z.string().min(1).max(40) }).safeParse(request.body);
    if (!body.success) return bad(reply);
    if (!sincroniaDoDailyLigada()) return reply.code(409).send({ error: 'A sincronia está desligada (DAILY_SYNC_CLICKUP).' });
    try {
      return await sincronizarTarefaNoDaily(body.data.taskId);
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Falha ao sincronizar a tarefa.' });
    }
  });

  // ── Hierarquia ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { include_archived?: string } }>('/work/tree', guard, async (request) => ({ spaces: await getTree(workContext(request), { includeArchived: request.query.include_archived === 'true' }) }));

  app.post('/work/spaces', guard, async (request, reply) => {
    const b = z.object({ name: z.string(), color: z.string().max(20).optional(), icon: z.string().max(40).optional(), description: z.string().max(2000).optional() }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join(' ') });
    try { return await createSpace(workContext(request), defined(b.data) as { name: string }); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/spaces/:id', guard, async (request, reply) => {
    const b = z.object({ name: z.string().optional(), color: z.string().max(20).nullable().optional(), icon: z.string().max(40).nullable().optional(), description: z.string().max(2000).nullable().optional(), position: z.number().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await updateSpace(workContext(request), request.params.id, defined(b.data)); } catch (e) { return fail(reply, e); }
  });

  app.post('/work/folders', guard, async (request, reply) => {
    const b = z.object({ spaceId: uuid, name: z.string() }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join(' ') });
    try { return await createFolder(workContext(request), b.data); } catch (e) { return fail(reply, e); }
  });

  app.post('/work/projects', guard, async (request, reply) => {
    const b = z.object({ spaceId: uuid, folderId: uuid.nullable().optional(), clientId: uuid.nullable().optional(), name: z.string(), description: z.string().max(5000).nullable().optional(), status: z.enum(['active', 'paused', 'done']).optional(), color: z.string().max(20).nullable().optional(), startDate: optDate, dueDate: optDate }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join(' ') });
    try { return await createProject(workContext(request), defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/projects/:id', guard, async (request, reply) => {
    const b = z.object({ folderId: uuid.nullable().optional(), clientId: uuid.nullable().optional(), name: z.string().optional(), description: z.string().max(5000).nullable().optional(), status: z.enum(['active', 'paused', 'done']).optional(), color: z.string().max(20).nullable().optional(), startDate: optDate, dueDate: optDate, position: z.number().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await updateProject(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });

  app.post('/work/lists', guard, async (request, reply) => {
    const b = z.object({ spaceId: uuid, folderId: uuid.nullable().optional(), projectId: uuid.nullable().optional(), clientId: uuid.nullable().optional(), name: z.string(), description: z.string().max(5000).nullable().optional() }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join(' ') });
    try { return await createList(workContext(request), defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/lists/:id', guard, async (request, reply) => {
    const b = z.object({ name: z.string().optional(), description: z.string().max(5000).nullable().optional(), position: z.number().optional(), clientId: uuid.nullable().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await renameList(workContext(request), request.params.id, defined(b.data)); } catch (e) { return fail(reply, e); }
  });

  for (const action of ['archive', 'restore'] as const) {
    app.post<{ Params: { kind: string; id: string } }>(`/work/:kind/:id/${action}`, guard, async (request, reply) => {
      const kind = ({ spaces: 'space', folders: 'folder', projects: 'project', lists: 'list' } as const)[request.params.kind as 'spaces'];
      if (!kind || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
      try { await setArchived(workContext(request), kind, request.params.id, action === 'archive'); return { ok: true }; } catch (e) { return fail(reply, e); }
    });
  }

  // ── Status e fluxo ─────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/work/spaces/:id/statuses', guard, async (request, reply) => {
    if (!uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Id inválido.' });
    const ctx = workContext(request);
    return { statuses: await listStatuses(ctx, request.params.id), transitions: await listTransitions(ctx, request.params.id) };
  });
  app.post<{ Params: { id: string } }>('/work/spaces/:id/statuses', guard, async (request, reply) => {
    const b = z.object({ name: z.string(), color: z.string().optional(), category: z.enum(['todo', 'active', 'review', 'blocked', 'done', 'cancelled']).optional(), isInitial: z.boolean().optional(), isFinal: z.boolean().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await createStatus(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/statuses/:id', guard, async (request, reply) => {
    const b = z.object({ name: z.string().optional(), color: z.string().optional(), category: z.enum(['todo', 'active', 'review', 'blocked', 'done', 'cancelled']).optional(), isInitial: z.boolean().optional(), isFinal: z.boolean().optional(), position: z.number().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await updateStatus(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string }; Querystring: { migrate_to?: string } }>('/work/statuses/:id', guard, async (request, reply) => {
    if (!uuid.safeParse(request.params.id).success || (request.query.migrate_to && !uuid.safeParse(request.query.migrate_to).success)) return reply.code(400).send({ error: 'Id inválido.' });
    try { return await deleteStatus(workContext(request), request.params.id, request.query.migrate_to ? { migrateToStatusId: request.query.migrate_to } : {}); } catch (e) { return fail(reply, e); }
  });
  app.put<{ Params: { id: string } }>('/work/statuses/:id/transitions', guard, async (request, reply) => {
    const b = z.object({ to: z.array(uuid).max(50) }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { await setTransitionsFrom(workContext(request), request.params.id, b.data.to); return { ok: true }; } catch (e) { return fail(reply, e); }
  });

  // ── Tarefas ────────────────────────────────────────────────────────────
  const listQuery = z.object({
    list_id: uuid.optional(), project_id: uuid.optional(), space_id: uuid.optional(), client_id: uuid.optional(),
    status_ids: z.string().optional(), assignee_id: uuid.optional(), created_by: uuid.optional(), follower_id: uuid.optional(), tag: z.string().max(60).optional(), due_none: z.enum(['true', 'false']).optional(), unassigned: z.enum(['true', 'false']).optional(), priorities: z.string().optional(),
    due_from: z.string().datetime({ offset: true }).optional(), due_to: z.string().datetime({ offset: true }).optional(),
    q: z.string().max(100).optional(), include_subtasks: z.enum(['true', 'false']).optional(), parent_task_id: uuid.optional(),
    include_archived: z.enum(['true', 'false']).optional(), completed: z.enum(['true', 'false']).optional(),
    sort: z.enum(['position', 'due', 'priority', 'created', 'updated', 'number', 'completed']).optional(), dir: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(2000).optional(), offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  });
  app.get('/work/tasks', guard, async (request, reply) => {
    const q = listQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: q.error.issues.map((i) => i.message).join(' ') });
    const csv = (v?: string) => (v ? v.split(',').filter(Boolean) : undefined);
    const ids = csv(q.data.status_ids);
    if (ids?.some((i) => !uuid.safeParse(i).success)) return reply.code(400).send({ error: 'status_ids inválido.' });
    const pr = csv(q.data.priorities)?.map(Number);
    if (pr?.some((n) => !Number.isInteger(n) || n < 0 || n > 4)) return reply.code(400).send({ error: 'priorities inválido.' });
    return listTasks(workContext(request), defined({
      listId: q.data.list_id, projectId: q.data.project_id, spaceId: q.data.space_id, clientId: q.data.client_id, statusIds: ids, assigneeId: q.data.assignee_id, createdBy: q.data.created_by, followerId: q.data.follower_id, tag: q.data.tag, dueNone: q.data.due_none === 'true' ? true : undefined, unassigned: q.data.unassigned === 'true' ? true : undefined, priorities: pr,
      dueFrom: q.data.due_from ? new Date(q.data.due_from) : undefined, dueTo: q.data.due_to ? new Date(q.data.due_to) : undefined, q: q.data.q,
      includeSubtasks: q.data.include_subtasks === 'true' ? true : undefined, parentTaskId: q.data.parent_task_id, includeArchived: q.data.include_archived === 'true' ? true : undefined,
      completed: q.data.completed === undefined ? undefined : q.data.completed === 'true', sort: q.data.sort, dir: q.data.dir, limit: q.data.limit, offset: q.data.offset,
    }));
  });

  app.post('/work/tasks', guard, async (request, reply) => {
    const b = taskBody.safeParse(request.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join(' ') });
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || key.length < 8 || key.length > 100)) return reply.code(400).send({ error: 'Idempotency-Key inválida (8 a 100 caracteres).' });
    try { return await createTask(workContext(request), { ...defined(b.data), ...(typeof key === 'string' ? { idempotencyKey: key } : {}) } as never); } catch (e) { return fail(reply, e); }
  });

  /** Aceita o UUID ou a chave legível (DT-123). */
  app.get<{ Params: { ref: string } }>('/work/tasks/:ref', guard, async (request, reply) => {
    try { return /^DT-\d+$/i.test(request.params.ref) ? await getTaskByKey(workContext(request), request.params.ref) : uuid.safeParse(request.params.ref).success ? await getTask(workContext(request), request.params.ref) : reply.code(400).send({ error: 'Referência inválida.' }); } catch (e) { return fail(reply, e); }
  });

  app.patch<{ Params: { id: string } }>('/work/tasks/:id', guard, async (request, reply) => {
    const b = patchBody.safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: b.success ? 'Id inválido.' : b.error.issues.map((i) => i.message).join(' ') });
    const { expectedVersion, ...patch } = b.data;
    try { return await updateTask(workContext(request), request.params.id, defined(patch) as never, expectedVersion !== undefined ? { expectedVersion } : {}); } catch (e) { return fail(reply, e); }
  });

  app.post<{ Params: { id: string } }>('/work/tasks/:id/move', guard, async (request, reply) => {
    const b = z.object({ listId: uuid.optional(), parentTaskId: uuid.nullable().optional(), position: z.number().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await moveTask(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });

  for (const action of ['archive', 'restore'] as const) {
    app.post<{ Params: { id: string } }>(`/work/tasks/:id/${action}`, guard, async (request, reply) => {
      if (!uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Id inválido.' });
      try { await setTaskArchived(workContext(request), request.params.id, action === 'archive'); return { ok: true }; } catch (e) { return fail(reply, e); }
    });
  }

  app.post('/work/tasks/bulk', guard, async (request, reply) => {
    const b = z.object({ ids: z.array(uuid).min(1).max(200), patch: patchBody.omit({ expectedVersion: true, position: true, title: true }) }).safeParse(request.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join(' ') });
    try {
      const results = await bulkUpdateTasks(workContext(request), b.data.ids, defined(b.data.patch) as never);
      return { results, okCount: results.filter((r) => r.ok).length, failedCount: results.filter((r) => !r.ok).length };
    } catch (e) { return fail(reply, e); }
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/work/tasks/:id/activity', guard, async (request, reply) => {
    if (!uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Id inválido.' });
    try { return { events: await getTaskActivity(workContext(request), request.params.id, Number(request.query.limit) || 100) }; } catch (e) { return fail(reply, e); }
  });

  // ── Pessoas (seletor de responsável) ───────────────────────────────────
  // ── Colaboração (gaveta da tarefa)
  app.get<{ Params: { id: string } }>('/work/tasks/:id/detail', guard, async (request, reply) => {
    if (!uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Id inválido.' });
    try { return await getTaskDetail(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/comments', guard, async (request, reply) => {
    const b = z.object({ body: z.string().min(1).max(20000), parentCommentId: uuid.nullable().optional() }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await addComment(workContext(request), request.params.id, b.data.body, b.data.parentCommentId); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/checklists', guard, async (request, reply) => {
    const b = z.object({ name: z.string().min(1).max(200) }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await createChecklist(workContext(request), request.params.id, b.data.name); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/checklists/:id/items', guard, async (request, reply) => {
    const b = z.object({ text: z.string().min(1).max(500) }).safeParse(request.body);
    if (!b.success || !uuid.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Dados inválidos.' });
    try { return await addChecklistItem(workContext(request), request.params.id, b.data.text); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/checklist-items/:id', guard, async (request, reply) => {
    const b = z.object({ done: z.boolean().optional(), text: z.string().min(1).max(500).optional(), assigneeId: uuid.nullable().optional() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await editChecklistItem(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });

  // ── Produtividade: caixa de entrada, cronômetro, campos, visões
  const idOk = (id: string) => uuid.safeParse(id).success;
  const bad = (reply: FastifyReply, m = 'Dados inválidos.') => reply.code(400).send({ error: m });
  app.get('/work/inbox', guard, async (request) => {
    const r = await listInboxUnified(workContext(request));
    return { items: r.items, assigned: r.assigned, unreadByKind: r.unread, unread: r.unread.task + r.unread.communication + r.unread.system };
  });
  app.post('/work/inbox/read', guard, async (request) => markInboxReadAll(workContext(request)));

  app.get('/work/timer', guard, async (request) => ({ running: await runningTimer(workContext(request)) }));
  app.post('/work/timer/stop', guard, async (request, reply) => { try { return await stopTimer(workContext(request)); } catch (e) { return fail(reply, e); } });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/timer/start', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await startTimer(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.get<{ Params: { id: string } }>('/work/tasks/:id/time', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await listTimeEntries(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/time', guard, async (request, reply) => {
    const b = z.object({ minutes: z.number().positive().max(1440), note: z.string().max(500).nullable().optional(), billable: z.boolean().optional() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await addManualEntry(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });

  app.get<{ Params: { id: string } }>('/work/spaces/:id/custom-fields', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    return { fields: await listCustomFields(workContext(request), request.params.id) };
  });
  app.post<{ Params: { id: string } }>('/work/spaces/:id/custom-fields', guard, async (request, reply) => {
    const b = z.object({ name: z.string().min(1).max(100), fieldType: z.string(), options: z.array(z.string().max(100)).max(50).optional() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await createCustomField(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.put<{ Params: { id: string; fieldId: string } }>('/work/tasks/:id/custom-fields/:fieldId', guard, async (request, reply) => {
    const b = z.object({ value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]) }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id) || !idOk(request.params.fieldId)) return bad(reply);
    try { return await setCustomFieldValue(workContext(request), request.params.id, request.params.fieldId, b.data.value); } catch (e) { return fail(reply, e); }
  });

  app.get('/work/views', guard, async (request) => ({ views: await listSavedViews(workContext(request)) }));
  app.post('/work/views', guard, async (request, reply) => {
    const b = z.object({ name: z.string().min(1).max(100), config: z.record(z.unknown()), shared: z.boolean().optional() }).safeParse(request.body);
    if (!b.success) return bad(reply);
    try { return await createSavedView(workContext(request), defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/views/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteSavedView(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });

  // ── Modelos, duplicar, recorrência
  app.get('/work/templates', guard, async (request) => ({ templates: await listTemplates(workContext(request)) }));
  app.post('/work/templates', guard, async (request, reply) => {
    const b = z.object({ taskId: uuid, name: z.string().min(1).max(150) }).safeParse(request.body);
    if (!b.success) return bad(reply);
    try { return await createTemplateFromTask(workContext(request), b.data.taskId, b.data.name); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/templates/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteTemplate(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/templates/:id/use', guard, async (request, reply) => {
    const b = z.object({ listId: uuid, title: z.string().max(500).optional(), dueAt: optDate }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await instantiateTemplate(workContext(request), request.params.id, b.data.listId, defined({ title: b.data.title, dueAt: b.data.dueAt }) as never); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/duplicate', guard, async (request, reply) => {
    const b = z.object({ listId: uuid.optional() }).safeParse(request.body ?? {});
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await duplicateTask(workContext(request), request.params.id, b.data.listId); } catch (e) { return fail(reply, e); }
  });
  app.get('/work/recurrences', guard, async (request) => ({ recurrences: await listRecurrences(workContext(request)) }));
  app.post<{ Params: { id: string } }>('/work/tasks/:id/recurrence', guard, async (request, reply) => {
    const b = z.object({ freq: z.enum(['daily', 'weekly', 'monthly']), interval: z.number().int().min(1).max(52).optional(), firstRunAt: optDate }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await createRecurrence(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/recurrences/:id', guard, async (request, reply) => {
    const b = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await setRecurrenceActive(workContext(request), request.params.id, b.data.active); } catch (e) { return fail(reply, e); }
  });

  // ── Automações
  const autoBody = z.object({
    name: z.string().min(1).max(150), enabled: z.boolean().optional(), spaceId: uuid.nullable().optional(), listId: uuid.nullable().optional(),
    trigger: z.object({ type: z.string(), config: z.record(z.unknown()).optional() }),
    conditions: z.array(z.object({ field: z.string(), op: z.string(), value: z.unknown().optional() })).max(10).optional(),
    actions: z.array(z.object({ type: z.string(), config: z.record(z.unknown()).optional() })).min(1).max(10),
  });
  app.get('/work/automations', guard, async (request) => ({ automations: await listAutomations(workContext(request)) }));
  app.post('/work/automations', guard, async (request, reply) => {
    const b = autoBody.safeParse(request.body);
    if (!b.success) return bad(reply, b.error.issues.map((i) => i.message).join(' '));
    try { return await createAutomation(workContext(request), defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/automations/:id', guard, async (request, reply) => {
    const b = autoBody.partial().safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await updateAutomation(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/automations/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteAutomation(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.get<{ Params: { id: string } }>('/work/automations/:id/runs', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return { runs: await listAutomationRuns(workContext(request), request.params.id) }; } catch (e) { return fail(reply, e); }
  });
  /** Roda um ciclo do motor agora (útil para ver o efeito sem esperar o relógio). Só administrador da plataforma. */
  app.post('/work/admin/automations/tick', { preHandler: adminOnly }, async () => automationTick());

  // ── Histórico, seguidores e preferências individuais
  app.get<{ Params: { id: string } }>('/work/tasks/:id/history', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return { events: await getTaskHistory(workContext(request), request.params.id) }; } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/follow', guard, async (request, reply) => {
    const b = z.object({ userId: uuid.optional() }).safeParse(request.body ?? {});
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await followTask(workContext(request), request.params.id, b.data.userId); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string }; Querystring: { user_id?: string } }>('/work/tasks/:id/follow', guard, async (request, reply) => {
    const q = z.object({ user_id: uuid.optional() }).safeParse(request.query);
    if (!q.success || !idOk(request.params.id)) return bad(reply);
    try { return await unfollowTask(workContext(request), request.params.id, q.data.user_id); } catch (e) { return fail(reply, e); }
  });
  app.get('/work/preferences', guard, async (request) => getPreferences(workContext(request)));
  app.put('/work/preferences', guard, async (request, reply) => {
    const b = z.object({
      colunas: z.array(z.string()).max(10).optional(), densidade: z.enum(['compacta', 'confortavel']).optional(), agrupar: z.boolean().optional(),
      visaoPadrao: z.enum(['lista', 'quadro', 'calendario', 'tabela', 'gantt']).optional(), mostrarConcluidas: z.boolean().optional(), subtarefasAbertas: z.boolean().optional(),
    }).safeParse(request.body);
    if (!b.success) return bad(reply);
    try { return await setPreferences(workContext(request), defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });

  // ── Painel do topo (cartões + lateral)
  app.get<{ Querystring: { space_id?: string; list_id?: string; client_id?: string } }>('/work/overview', guard, async (request, reply) => {
    const q = z.object({ space_id: uuid.optional(), list_id: uuid.optional(), client_id: uuid.optional() }).safeParse(request.query);
    if (!q.success) return bad(reply);
    return workOverview(workContext(request), defined({ spaceId: q.data.space_id, listId: q.data.list_id, clientId: q.data.client_id }) as never);
  });

  // ── Relatórios
  app.get<{ Querystring: { space_id?: string; weeks?: string } }>('/work/reports', guard, async (request, reply) => {
    const q = z.object({ space_id: uuid.optional(), weeks: z.coerce.number().int().min(1).max(26).optional() }).safeParse(request.query);
    if (!q.success) return bad(reply);
    return workReport(workContext(request), defined({ spaceId: q.data.space_id, weeks: q.data.weeks }) as never);
  });

  // ── Integrações: tarefa nascida de outra parte do sistema (idempotente por origem) e resumo por cliente
  app.post('/work/tasks/from-source', guard, async (request, reply) => {
    const b = z.object({ provider: z.string(), externalType: z.string().min(1).max(60), externalId: z.string().min(1).max(200), listId: uuid, title: z.string().min(1).max(500), description: z.string().max(50_000).nullable().optional(), clientId: uuid.nullable().optional(), priority: z.number().int().min(0).max(4).optional(), assigneeIds: z.array(uuid).max(20).optional(), dueAt: optDate, meta: z.record(z.unknown()).optional(), chatAttachmentIds: z.array(uuid).max(10).optional() }).safeParse(request.body);
    if (!b.success) return bad(reply, b.error.issues.map((i) => i.message).join(' '));
    try {
      const ctx = workContext(request);
      const { chatAttachmentIds, ...origem } = b.data;
      const r = await createTaskFromSource(ctx, defined(origem) as never);
      // Arquivos da mensagem viajam junto: cópia para a tarefa, só dos que a pessoa PODE ver na Comunicação.
      if (r.created && chatAttachmentIds?.length) {
        for (const id of chatAttachmentIds) {
          try {
            const anexo = await anexoAcessivel(ctx.organizationId, ctx.userId, id);
            const chave = await copiarAnexo(anexo.storageKey, ctx.organizationId, `tarefa-${r.task.id}`);
            await db.insert(schema.workAttachments).values({ organizationId: ctx.organizationId, taskId: r.task.id, fileName: anexo.filename, mimeType: tipoParaServir(chave), sizeBytes: anexo.sizeBytes, url: `storage:${chave}`, storage: 'storage', uploadedBy: ctx.userId });
          } catch { /* arquivo inacessível ou sumido: a tarefa já existe, só não leva esse anexo */ }
        }
      }
      return r;
    } catch (e) { return fail(reply, e); }
  });
  app.get<{ Querystring: { provider?: string; type?: string; id?: string } }>('/work/tasks/by-source', guard, async (request, reply) => {
    const q = z.object({ provider: z.string().min(1), type: z.string().min(1), id: z.string().min(1) }).safeParse(request.query);
    if (!q.success) return bad(reply);
    try { return { tasks: await findTasksBySource(workContext(request), q.data.provider, q.data.type, q.data.id) }; } catch (e) { return fail(reply, e); }
  });
  app.get<{ Params: { id: string } }>('/work/clients/:id/summary', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await clientWorkSummary(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });

  // ── Editar e excluir (comentário, checklist, anexo, dependência, tarefa/contêiner arquivado)
  app.patch<{ Params: { id: string } }>('/work/comments/:id', guard, async (request, reply) => {
    const b = z.object({ body: z.string().min(1).max(20000) }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await editComment(workContext(request), request.params.id, b.data.body); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/comments/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteComment(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/checklists/:id', guard, async (request, reply) => {
    const b = z.object({ name: z.string().min(1).max(200) }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await renameChecklist(workContext(request), request.params.id, b.data.name); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/checklists/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteChecklist(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/checklist-items/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteChecklistItem(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/attachments', guard, async (request, reply) => {
    const b = z.object({ url: z.string().url().max(2000), fileName: z.string().max(300).optional() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await addAttachmentLink(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  // Arquivo de verdade na tarefa: mesmo armazenamento privado e mesma validação (extensão, tipo e assinatura) da Comunicação.
  app.post<{ Params: { id: string } }>('/work/tasks/:id/attachments/upload', { ...guard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    const ctx = workContext(request);
    try {
      await getTask(ctx, request.params.id);
      const [uso] = await db.select({ total: sql<string>`coalesce(sum(${schema.workAttachments.sizeBytes}), 0)` }).from(schema.workAttachments).where(and(eq(schema.workAttachments.organizationId, ctx.organizationId), eq(schema.workAttachments.storage, 'storage')));
      const politica = politicaDeAnexos();
      const file = await request.file({ limits: { fileSize: Math.max(...Object.values(politica.limites)) + 1 } });
      if (!file) return bad(reply, 'Nenhum arquivo enviado.');
      const g = await gravarAnexo({ organizationId: ctx.organizationId, conversationId: `tarefa-${request.params.id}`, filename: file.filename, mimetype: file.mimetype, stream: file.file, usadoPelaOrganizacao: Number(uso?.total ?? 0) });
      if (file.file.truncated) { await apagarAnexo(g.storageKey); throw new AnexoRecusado('Arquivo acima do limite.', 413); }
      const [a] = await db.insert(schema.workAttachments).values({ organizationId: ctx.organizationId, taskId: request.params.id, fileName: g.filename, mimeType: g.servirComo, sizeBytes: g.sizeBytes, url: `storage:${g.storageKey}`, storage: 'storage', uploadedBy: ctx.userId }).returning();
      reply.code(201);
      return { id: a!.id, fileName: a!.fileName, mimeType: a!.mimeType, sizeBytes: a!.sizeBytes, storage: 'storage', url: `/work/attachments/${a!.id}/file` };
    } catch (e) {
      if (e instanceof AnexoRecusado) return reply.code(e.status).send({ error: e.message });
      return fail(reply, e);
    }
  });
  app.get<{ Params: { id: string } }>('/work/attachments/:id/file', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    const ctx = workContext(request);
    const [a] = await db.select().from(schema.workAttachments).where(and(eq(schema.workAttachments.id, request.params.id), eq(schema.workAttachments.organizationId, ctx.organizationId)));
    if (!a || a.storage !== 'storage' || !a.url.startsWith('storage:')) return reply.code(404).send({ error: 'Arquivo não encontrado.' });
    const chave = a.url.slice('storage:'.length);
    try {
      const aberto = await abrirAnexo(chave, request.headers.range);
      const tipo = tipoParaServir(chave);
      const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime|webm)|application\/pdf)$/.test(tipo) && (request.query as { download?: string }).download !== '1';
      reply.header('Content-Type', tipo).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'").header('Cache-Control', 'private, max-age=3600').header('Accept-Ranges', 'bytes')
        .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
      if (aberto.status === 416) return reply.code(416).header('Content-Range', `bytes */${aberto.size}`).send();
      if (aberto.status === 206) reply.code(206).header('Content-Range', `bytes ${aberto.inicio}-${aberto.fim}/${aberto.size}`).header('Content-Length', aberto.fim - aberto.inicio + 1);
      else reply.header('Content-Length', aberto.size);
      return reply.send(aberto.stream);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ error: 'Arquivo não encontrado.' });
      throw e;
    }
  });
  app.get<{ Params: { id: string } }>('/work/tasks/:id/approvals', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return { approvals: await listTaskApprovals(workContext(request), request.params.id) }; } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/approvals', guard, async (request, reply) => {
    const b = z.object({ approverId: uuid.nullable().optional(), note: z.string().max(1000).nullable().optional() }).safeParse(request.body ?? {});
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { const r = await requestTaskApproval(workContext(request), request.params.id, defined(b.data) as never); reply.code(r.created ? 201 : 200); return r; } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/approvals/:id', guard, async (request, reply) => {
    const b = z.object({ status: z.enum(['approved', 'rejected', 'changes_requested']), comment: z.string().max(2000).nullable().optional() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await resolveTaskApproval(workContext(request), request.params.id, defined(b.data) as never); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/attachments/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try {
      const ctx = workContext(request);
      const [a] = await db.select({ url: schema.workAttachments.url, storage: schema.workAttachments.storage }).from(schema.workAttachments).where(and(eq(schema.workAttachments.id, request.params.id), eq(schema.workAttachments.organizationId, ctx.organizationId)));
      const r = await deleteAttachment(ctx, request.params.id);
      if (a?.storage === 'storage' && a.url.startsWith('storage:')) await apagarAnexo(a.url.slice('storage:'.length)).catch(() => undefined);
      return r;
    } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/tasks/:id/dependencies', guard, async (request, reply) => {
    const b = z.object({ dependsOnId: uuid, kind: z.enum(['blocking', 'related']).optional() }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await addDependency(workContext(request), request.params.id, b.data.dependsOnId, b.data.kind); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string; other: string } }>('/work/tasks/:id/dependencies/:other', guard, async (request, reply) => {
    if (!idOk(request.params.id) || !idOk(request.params.other)) return bad(reply);
    try { return await removeDependency(workContext(request), request.params.id, request.params.other); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { id: string } }>('/work/tasks/:id', guard, async (request, reply) => {
    if (!idOk(request.params.id)) return bad(reply);
    try { return await deleteTaskPermanently(workContext(request), request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.delete<{ Params: { kind: string; id: string } }>('/work/:kind/:id', guard, async (request, reply) => {
    const k = z.enum(['space', 'folder', 'project', 'list']).safeParse(request.params.kind.replace(/s$/, ''));
    if (!k.success || !idOk(request.params.id)) return bad(reply);
    try { return await deleteContainerPermanently(workContext(request), k.data, request.params.id); } catch (e) { return fail(reply, e); }
  });
  app.patch<{ Params: { id: string } }>('/work/folders/:id', guard, async (request, reply) => {
    const b = z.object({ name: z.string().min(1).max(150) }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await renameFolder(workContext(request), request.params.id, b.data.name); } catch (e) { return fail(reply, e); }
  });
  app.post<{ Params: { id: string } }>('/work/automations/:id/test', guard, async (request, reply) => {
    const b = z.object({ taskId: uuid }).safeParse(request.body);
    if (!b.success || !idOk(request.params.id)) return bad(reply);
    try { return await testAutomation(workContext(request), request.params.id, b.data.taskId); } catch (e) { return fail(reply, e); }
  });

  app.get('/work/members', guard, async (request) => {
    const rows = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, clickupEmail: schema.users.clickupEmail, avatarUrl: schema.users.avatarUrl, role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.organizationId, request.tenantContext!.organizationId));
    // Pessoa só do ClickUp (sem login aqui): atribuível igual às outras, mas com o e-mail real e a marca para a tela.
    return {
      members: rows.map(({ clickupEmail, ...m }) => (ehEmailDePessoaDoClickUp(m.email) ? { ...m, email: clickupEmail ?? '', soNoClickUp: true } : m)),
    };
  });
}
