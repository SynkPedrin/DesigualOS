import { and, asc, desc, eq, inArray, isNull, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import { MAX_SUBTASK_DEPTH, type Db, type WorkContext } from './context';
import { conflict, invalid, notFound, WorkError } from './errors';

export const PRIORITIES = { none: 0, urgent: 1, high: 2, normal: 3, low: 4 } as const;
export type PriorityValue = (typeof PRIORITIES)[keyof typeof PRIORITIES];

export type WorkTaskRow = typeof schema.workTasks.$inferSelect;

export interface WorkTask {
  id: string;
  number: number;
  /** Identificador público legível. */
  key: string;
  listId: string;
  parentTaskId: string | null;
  depth: number;
  clientId: string | null;
  title: string;
  description: string | null;
  statusId: string;
  status: { id: string; name: string; color: string; category: string; isFinal: boolean } | null;
  priority: number;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  estimateMinutes: number | null;
  tags: string[];
  position: number;
  archivedAt: string | null;
  version: number;
  assigneeIds: string[];
  subtaskCount: number;
  subtaskDone: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
export const taskKey = (n: number): string => `DT-${n}`;

// ── Validação ────────────────────────────────────────────────────────────

function validateTitle(title: string | undefined): string {
  const t = (title ?? '').trim();
  if (t.length === 0) throw invalid('A tarefa precisa de um título.');
  if (t.length > 300) throw invalid('O título pode ter no máximo 300 caracteres.');
  return t;
}

function validatePriority(p: number | undefined): void {
  if (p !== undefined && ![0, 1, 2, 3, 4].includes(p)) throw invalid('Prioridade inválida (0 a 4).');
}

function validateDates(start: Date | null | undefined, due: Date | null | undefined): void {
  if (start && due && start.getTime() > due.getTime()) throw invalid('A data de início não pode ser depois do prazo.');
}

function validateTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (clean.length > 30 || clean.some((t) => t.length > 40)) throw invalid('No máximo 30 etiquetas de até 40 caracteres.');
  return clean;
}

// ── Auxiliares de leitura ────────────────────────────────────────────────

async function loadList(tx: Db, ctx: WorkContext, listId: string) {
  const [l] = await tx
    .select()
    .from(schema.workLists)
    .where(and(eq(schema.workLists.id, listId), eq(schema.workLists.organizationId, ctx.organizationId), isNull(schema.workLists.archivedAt)));
  if (!l) throw notFound('Lista');
  return l;
}

async function initialStatusOf(tx: Db, ctx: WorkContext, spaceId: string) {
  const [s] = await tx
    .select()
    .from(schema.workTaskStatuses)
    .where(and(eq(schema.workTaskStatuses.organizationId, ctx.organizationId), eq(schema.workTaskStatuses.spaceId, spaceId), eq(schema.workTaskStatuses.isInitial, true)));
  if (!s) throw conflict('O espaço não tem status inicial configurado.');
  return s;
}

async function statusInSpace(tx: Db, ctx: WorkContext, statusId: string, spaceId: string) {
  const [s] = await tx
    .select()
    .from(schema.workTaskStatuses)
    .where(and(eq(schema.workTaskStatuses.id, statusId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId), eq(schema.workTaskStatuses.spaceId, spaceId)));
  if (!s) throw invalid('O status precisa ser do mesmo espaço da lista.');
  return s;
}

/**
 * `statusInSpace` + `assertTransitionAllowed` numa consulta: o status do espaço e as regras de saída do status atual.
 * Sem regra cadastrada, qualquer mudança vale.
 */
async function statusPermitido(tx: Db, ctx: WorkContext, fromId: string, statusId: string, spaceId: string) {
  const [r] = await tx
    .select({ s: schema.workTaskStatuses, regras: sql<string[]>`(select coalesce(json_agg(${schema.workStatusTransitions.toStatusId}), '[]'::json) from ${schema.workStatusTransitions} where ${schema.workStatusTransitions.organizationId} = ${ctx.organizationId} and ${schema.workStatusTransitions.fromStatusId} = ${fromId})` })
    .from(schema.workTaskStatuses)
    .where(and(eq(schema.workTaskStatuses.id, statusId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId), eq(schema.workTaskStatuses.spaceId, spaceId)));
  if (!r) throw invalid('O status precisa ser do mesmo espaço da lista.');
  if (fromId !== r.s.id && r.regras.length > 0 && !r.regras.includes(r.s.id)) throw conflict('Esta mudança de status não é permitida pelo fluxo configurado.', { from: fromId, to: r.s.id });
  return r.s;
}

/** Só membros da empresa podem ser responsáveis. Devolve ids únicos validados. */
async function validateAssignees(tx: Db, ctx: WorkContext, ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return [];
  if (unique.length > 20) throw invalid('No máximo 20 responsáveis por tarefa.');
  const found = await tx
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), inArray(schema.organizationMembers.userId, unique)));
  if (found.length !== unique.length) throw invalid('Todo responsável precisa ser membro desta empresa.');
  return unique;
}

async function assertClient(tx: Db, ctx: WorkContext, clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  const [c] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, ctx.organizationId)));
  if (!c) throw invalid('Cliente não encontrado nesta empresa.');
}

async function nextNumber(tx: Db, ctx: WorkContext): Promise<number> {
  const rows = (await tx.execute(
    sql`insert into work_counters (organization_id, key, value) values (${ctx.organizationId}, 'task', 1)
        on conflict (organization_id, key) do update set value = work_counters.value + 1 returning value`,
  )) as unknown as Array<{ value: number }>;
  return Number(rows[0]!.value);
}

async function nextPosition(tx: Db, ctx: WorkContext, listId: string, parentTaskId: string | null): Promise<number> {
  const [r] = await tx
    .select({ m: sql<number>`coalesce(max(${schema.workTasks.position}), 0)` })
    .from(schema.workTasks)
    .where(and(eq(schema.workTasks.organizationId, ctx.organizationId), eq(schema.workTasks.listId, listId), parentTaskId ? eq(schema.workTasks.parentTaskId, parentTaskId) : isNull(schema.workTasks.parentTaskId)));
  return Number(r?.m ?? 0) + 1000;
}

// ── Serialização ─────────────────────────────────────────────────────────

async function hydrate(tx: Db, ctx: WorkContext, rows: WorkTaskRow[]): Promise<WorkTask[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const statusIds = [...new Set(rows.map((r) => r.statusId))];
  const [assignees, statuses, subs] = await Promise.all([
    tx.select({ taskId: schema.workTaskAssignees.taskId, userId: schema.workTaskAssignees.userId }).from(schema.workTaskAssignees).where(inArray(schema.workTaskAssignees.taskId, ids)),
    tx.select().from(schema.workTaskStatuses).where(and(eq(schema.workTaskStatuses.organizationId, ctx.organizationId), inArray(schema.workTaskStatuses.id, statusIds))),
    tx
      .select({ parentTaskId: schema.workTasks.parentTaskId, n: sql<number>`count(*)::int`, feitas: sql<number>`count(*) filter (where ${schema.workTasks.completedAt} is not null)::int` })
      .from(schema.workTasks)
      .where(and(eq(schema.workTasks.organizationId, ctx.organizationId), inArray(schema.workTasks.parentTaskId, ids), isNull(schema.workTasks.archivedAt)))
      .groupBy(schema.workTasks.parentTaskId),
  ]);
  const byTask = new Map<string, string[]>();
  for (const a of assignees) byTask.set(a.taskId, [...(byTask.get(a.taskId) ?? []), a.userId]);
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const subCount = new Map(subs.map((s) => [s.parentTaskId as string, s.n]));
  const subDone = new Map(subs.map((s) => [s.parentTaskId as string, s.feitas]));
  return rows.map((r) => {
    const st = statusById.get(r.statusId);
    return {
      id: r.id,
      number: r.number,
      key: taskKey(r.number),
      listId: r.listId,
      parentTaskId: r.parentTaskId,
      depth: r.depth,
      clientId: r.clientId,
      title: r.title,
      description: r.description,
      statusId: r.statusId,
      status: st ? { id: st.id, name: st.name, color: st.color, category: st.category, isFinal: st.isFinal } : null,
      priority: r.priority,
      startAt: iso(r.startAt),
      dueAt: iso(r.dueAt),
      completedAt: iso(r.completedAt),
      estimateMinutes: r.estimateMinutes,
      tags: r.tags,
      position: r.position,
      archivedAt: iso(r.archivedAt),
      version: r.version,
      assigneeIds: byTask.get(r.id) ?? [],
      subtaskCount: subCount.get(r.id) ?? 0,
      subtaskDone: subDone.get(r.id) ?? 0,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

// ── Criar ────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  listId: string;
  title: string;
  description?: string | null;
  statusId?: string;
  priority?: number;
  assigneeIds?: string[];
  startAt?: Date | null;
  dueAt?: Date | null;
  estimateMinutes?: number | null;
  clientId?: string | null;
  tags?: string[];
  parentTaskId?: string | null;
  /** Mesmo valor devolve a MESMA tarefa, nunca uma segunda (reenvio por timeout, duplo clique, retry de worker). */
  idempotencyKey?: string;
}

export async function createTask(ctx: WorkContext, input: CreateTaskInput): Promise<WorkTask> {
  const title = validateTitle(input.title);
  validatePriority(input.priority);
  validateDates(input.startAt, input.dueAt);
  const tags = validateTags(input.tags);
  if (input.estimateMinutes != null && (input.estimateMinutes < 0 || input.estimateMinutes > 60 * 24 * 365)) throw invalid('Estimativa inválida.');

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;

    if (input.idempotencyKey) {
      // Serializa criações com a MESMA chave (duplo clique, retry em paralelo): a segunda espera a primeira
      // terminar e então encontra a chave gravada, em vez de disputar o INSERT e falhar com violação de unicidade.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:${ctx.userId}:${input.idempotencyKey}`}, 0))`);
      const [seen] = await tx
        .select({ entityId: schema.workIdempotencyKeys.entityId })
        .from(schema.workIdempotencyKeys)
        .where(and(eq(schema.workIdempotencyKeys.organizationId, ctx.organizationId), eq(schema.workIdempotencyKeys.userId, ctx.userId), eq(schema.workIdempotencyKeys.key, input.idempotencyKey)));
      if (seen) {
        const [existing] = await tx.select().from(schema.workTasks).where(and(eq(schema.workTasks.id, seen.entityId), eq(schema.workTasks.organizationId, ctx.organizationId)));
        if (existing) return (await hydrate(tx, ctx, [existing]))[0]!;
      }
    }

    const list = await loadList(tx, ctx, input.listId);
    let depth = 0;
    let clientePai: string | null = null;
    if (input.parentTaskId) {
      const [parent] = await tx
        .select()
        .from(schema.workTasks)
        .where(and(eq(schema.workTasks.id, input.parentTaskId), eq(schema.workTasks.organizationId, ctx.organizationId), isNull(schema.workTasks.archivedAt)));
      if (!parent) throw invalid('Tarefa-mãe não encontrada.');
      if (parent.listId !== list.id) throw invalid('A subtarefa precisa ficar na mesma lista da tarefa-mãe.');
      clientePai = parent.clientId;
      depth = parent.depth + 1;
      if (depth > MAX_SUBTASK_DEPTH) throw conflict(`Profundidade máxima de subtarefas (${MAX_SUBTASK_DEPTH}) atingida.`);
    }

    const status = input.statusId ? await statusInSpace(tx, ctx, input.statusId, list.spaceId) : await initialStatusOf(tx, ctx, list.spaceId);
    // O cliente NÃO se pede de novo: vem de quem já o tem — a tarefa-mãe, ou a própria lista do cliente.
    const clienteFinal = input.clientId !== undefined ? input.clientId : (clientePai ?? list.clientId ?? null);
    await assertClient(tx, ctx, clienteFinal);
    const assignees = await validateAssignees(tx, ctx, input.assigneeIds);
    const number = await nextNumber(tx, ctx);
    const position = await nextPosition(tx, ctx, list.id, input.parentTaskId ?? null);

    const [row] = await tx
      .insert(schema.workTasks)
      .values({
        organizationId: ctx.organizationId,
        number,
        listId: list.id,
        parentTaskId: input.parentTaskId ?? null,
        depth,
        clientId: clienteFinal,
        title,
        description: input.description ?? null,
        statusId: status.id,
        priority: input.priority ?? 0,
        startAt: input.startAt ?? null,
        dueAt: input.dueAt ?? null,
        completedAt: status.isFinal ? new Date() : null,
        estimateMinutes: input.estimateMinutes ?? null,
        tags: tags ?? [],
        position,
        createdBy: ctx.userId,
      })
      .returning();

    if (assignees.length > 0) {
      await tx.insert(schema.workTaskAssignees).values(assignees.map((userId) => ({ taskId: row!.id, userId, organizationId: ctx.organizationId, assignedBy: ctx.userId })));
    }
    if (input.idempotencyKey) {
      await tx.insert(schema.workIdempotencyKeys).values({ organizationId: ctx.organizationId, userId: ctx.userId, key: input.idempotencyKey, entityType: 'task', entityId: row!.id });
    }
    await recordActivity(tx, ctx, { entityType: 'task', entityId: row!.id, taskId: row!.id, action: 'created', data: { key: taskKey(number), listId: list.id, parentTaskId: input.parentTaskId ?? null, assignees } });
    // Quem já nasce com responsável também é "atribuída": avisa a pessoa e dispara automações de atribuição.
    if (assignees.length) await recordActivity(tx, ctx, { entityType: 'task', entityId: row!.id, taskId: row!.id, action: 'assigned', data: { userIds: assignees } });
    return (await hydrate(tx, ctx, [row!]))[0]!;
  });
}

// ── Ler ──────────────────────────────────────────────────────────────────

export async function getTask(ctx: WorkContext, id: string): Promise<WorkTask> {
  const [row] = await db.select().from(schema.workTasks).where(and(eq(schema.workTasks.id, id), eq(schema.workTasks.organizationId, ctx.organizationId)));
  if (!row) throw notFound('Tarefa');
  return (await hydrate(db as unknown as Db, ctx, [row]))[0]!;
}

export async function getTaskByKey(ctx: WorkContext, key: string): Promise<WorkTask> {
  const m = /^DT-(\d+)$/i.exec(key.trim());
  if (!m) throw invalid('Identificador inválido (use DT-123).');
  const [row] = await db.select().from(schema.workTasks).where(and(eq(schema.workTasks.number, Number(m[1])), eq(schema.workTasks.organizationId, ctx.organizationId)));
  if (!row) throw notFound('Tarefa');
  return (await hydrate(db as unknown as Db, ctx, [row]))[0]!;
}

export interface TaskFilter {
  listId?: string;
  projectId?: string;
  spaceId?: string;
  clientId?: string;
  statusIds?: string[];
  assigneeId?: string;
  /** Quem criou a tarefa. */
  createdBy?: string;
  /** Tarefas que esta pessoa acompanha. */
  followerId?: string;
  tag?: string;
  /** Só as sem prazo / só as sem responsável. */
  dueNone?: boolean;
  unassigned?: boolean;
  priorities?: number[];
  dueFrom?: Date;
  dueTo?: Date;
  /** Texto no título (e na chave DT-n). */
  q?: string;
  /** `undefined`/false = só tarefas de nível raiz; true = todas, inclusive subtarefas. */
  includeSubtasks?: boolean;
  parentTaskId?: string;
  includeArchived?: boolean;
  /** Só abertas (status que não é final) ou só concluídas. */
  completed?: boolean;
  sort?: 'position' | 'due' | 'priority' | 'created' | 'updated' | 'number' | 'completed';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function listTasks(ctx: WorkContext, f: TaskFilter = {}): Promise<{ total: number; rows: WorkTask[] }> {
  const T = schema.workTasks;
  const where: SQL[] = [eq(T.organizationId, ctx.organizationId)];
  if (!f.includeArchived) where.push(isNull(T.archivedAt));
  // Lista arquivada esconde as tarefas dela, como no ClickUp (30/10/2026: 727 tarefas de "Clientes Importados operand",
  // lista arquivada lá, apareciam abertas aqui). Abrindo a própria lista (listId), ela mostra o que tem.
  if (!f.includeArchived && !f.listId && !f.parentTaskId) where.push(sql`${T.listId} not in (select id from work_lists where organization_id = ${ctx.organizationId} and archived_at is not null)`);
  if (f.parentTaskId) where.push(eq(T.parentTaskId, f.parentTaskId));
  else if (!f.includeSubtasks) where.push(isNull(T.parentTaskId));
  if (f.listId) where.push(eq(T.listId, f.listId));
  if (f.projectId) where.push(sql`${T.listId} in (select id from work_lists where project_id = ${f.projectId} and organization_id = ${ctx.organizationId})`);
  if (f.spaceId) where.push(sql`${T.listId} in (select id from work_lists where space_id = ${f.spaceId} and organization_id = ${ctx.organizationId})`);
  if (f.clientId) where.push(eq(T.clientId, f.clientId));
  if (f.statusIds?.length) where.push(inArray(T.statusId, f.statusIds));
  if (f.priorities?.length) where.push(inArray(T.priority, f.priorities));
  if (f.assigneeId) where.push(sql`exists (select 1 from work_task_assignees a where a.task_id = ${T.id} and a.user_id = ${f.assigneeId})`);
  if (f.createdBy) where.push(eq(T.createdBy, f.createdBy));
  if (f.followerId) where.push(sql`exists (select 1 from work_task_followers w where w.task_id = ${T.id} and w.user_id = ${f.followerId})`);
  if (f.tag) where.push(sql`${T.tags} @> ${JSON.stringify([f.tag])}::jsonb`);
  if (f.dueNone) where.push(isNull(T.dueAt));
  if (f.unassigned) where.push(sql`not exists (select 1 from work_task_assignees a where a.task_id = ${T.id})`);
  if (f.dueFrom) where.push(gte(T.dueAt, f.dueFrom));
  if (f.dueTo) where.push(lte(T.dueAt, f.dueTo));
  if (f.completed !== undefined) where.push(f.completed ? sql`${T.completedAt} is not null` : isNull(T.completedAt));
  if (f.q?.trim()) {
    // `_` e `%` são ESCAPADOS, não apagados: apagar fazia "Cosentino_Europa" virar "CosentinoEuropa" e não achar nada.
    // Os caracteres invisíveis que o ClickUp põe nos títulos ("Card 25/11 - Quarta Delas\u200b") saem dos dois lados.
    const invisiveis = /[\u200b-\u200f\ufeff]/g;
    const term = f.q.trim().replace(invisiveis, '');
    const m = /^DT-(\d+)$/i.exec(term);
    const padrao = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(m ? eq(T.number, Number(m[1])) : sql`regexp_replace(${T.title}, '[\u200b-\u200f\ufeff]', '', 'g') ilike ${padrao}`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 2000);
  const offset = Math.max(f.offset ?? 0, 0);
  const dir = f.dir === 'desc' ? desc : asc;
  const order =
    f.sort === 'due' ? [sql`${T.dueAt} ${f.dir === 'desc' ? sql`desc` : sql`asc`} nulls last`, asc(T.number)]
    : f.sort === 'priority' ? [sql`case when ${T.priority} = 0 then 9 else ${T.priority} end ${f.dir === 'desc' ? sql`desc` : sql`asc`}`, asc(T.number)]
    : f.sort === 'created' ? [dir(T.createdAt)]
    : f.sort === 'updated' ? [dir(T.updatedAt)]
    : f.sort === 'number' ? [dir(T.number)]
    : f.sort === 'completed' ? [sql`${T.completedAt} ${f.dir === 'asc' ? sql`asc` : sql`desc`} nulls last`, desc(T.number)] // histórico: a mais recente primeiro
    : [dir(T.position), asc(T.number)];

  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(T).where(and(...where));
  const rows = await db.select().from(T).where(and(...where)).orderBy(...order).limit(limit).offset(offset);
  return { total: n, rows: await hydrate(db as unknown as Db, ctx, rows) };
}

// ── Atualizar ────────────────────────────────────────────────────────────

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  statusId?: string;
  priority?: number;
  startAt?: Date | null;
  dueAt?: Date | null;
  estimateMinutes?: number | null;
  clientId?: string | null;
  tags?: string[];
  assigneeIds?: string[];
  position?: number;
}

/**
 * Atualiza uma tarefa. `expectedVersion` liga o controle otimista: se outra pessoa mexeu depois de quem
 * está enviando, devolve `conflict` com a versão atual em vez de sobrescrever em silêncio.
 */
export async function updateTask(ctx: WorkContext, id: string, patch: UpdateTaskInput, opts: { expectedVersion?: number } = {}): Promise<WorkTask> {
  const t = patch.title !== undefined ? validateTitle(patch.title) : undefined;
  validatePriority(patch.priority);
  const tags = validateTags(patch.tags);
  if (patch.estimateMinutes != null && (patch.estimateMinutes < 0 || patch.estimateMinutes > 60 * 24 * 365)) throw invalid('Estimativa inválida.');

  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    // Tarefa e espaço da lista numa ida só: cada consulta custa ~250 ms até o banco (30/10/2026, "tudo demora 10 s").
    const [linha] = await tx.select({ t: schema.workTasks, spaceId: schema.workLists.spaceId }).from(schema.workTasks)
      .innerJoin(schema.workLists, eq(schema.workLists.id, schema.workTasks.listId))
      .where(and(eq(schema.workTasks.id, id), eq(schema.workTasks.organizationId, ctx.organizationId))).for('update', { of: schema.workTasks });
    if (!linha) throw notFound('Tarefa');
    const cur = linha.t;
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== cur.version) {
      throw conflict('A tarefa foi alterada por outra pessoa. Recarregue antes de salvar.', { currentVersion: cur.version });
    }
    validateDates(patch.startAt === undefined ? cur.startAt : patch.startAt, patch.dueAt === undefined ? cur.dueAt : patch.dueAt);

    const set: Partial<typeof schema.workTasks.$inferInsert> = { updatedAt: new Date(), version: cur.version + 1 };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const note = (field: string, from: unknown, to: unknown) => { if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to }; };

    if (t !== undefined) { set.title = t; note('title', cur.title, t); }
    if (patch.description !== undefined) { set.description = patch.description; note('description', cur.description, patch.description); }
    if (patch.priority !== undefined) { set.priority = patch.priority; note('priority', cur.priority, patch.priority); }
    if (patch.startAt !== undefined) { set.startAt = patch.startAt; note('startAt', iso(cur.startAt), iso(patch.startAt)); }
    if (patch.dueAt !== undefined) { set.dueAt = patch.dueAt; note('dueAt', iso(cur.dueAt), iso(patch.dueAt)); }
    if (patch.estimateMinutes !== undefined) { set.estimateMinutes = patch.estimateMinutes; note('estimateMinutes', cur.estimateMinutes, patch.estimateMinutes); }
    if (patch.position !== undefined) set.position = patch.position;
    if (tags !== undefined) { set.tags = tags; note('tags', cur.tags, tags); }
    if (patch.clientId !== undefined) { await assertClient(tx, ctx, patch.clientId); set.clientId = patch.clientId; note('clientId', cur.clientId, patch.clientId); }

    let statusChange: { from: string; to: string } | null = null;
    if (patch.statusId !== undefined && patch.statusId !== cur.statusId) {
      const next = await statusPermitido(tx, ctx, cur.statusId, patch.statusId, linha.spaceId);
      set.statusId = next.id;
      // Entre dois status finais (pronto → encerrado) a data de conclusão original fica: só reabrir a apaga.
      set.completedAt = next.isFinal ? (cur.completedAt ?? new Date()) : null;
      statusChange = { from: cur.statusId, to: next.id };
    }

    const [row] = await tx.update(schema.workTasks).set(set).where(and(eq(schema.workTasks.id, id), eq(schema.workTasks.version, cur.version))).returning();
    if (!row) throw conflict('A tarefa foi alterada por outra pessoa. Recarregue antes de salvar.');
    // Trocar o cliente da tarefa troca o das subtarefas junto (uma tarefa e suas subtarefas são sempre do mesmo cliente).
    if (patch.clientId !== undefined && patch.clientId !== cur.clientId) {
      await tx.execute(sql`with recursive d as (
          select id from work_tasks where parent_task_id = ${id} and organization_id = ${ctx.organizationId}
          union select t.id from work_tasks t join d on t.parent_task_id = d.id where t.organization_id = ${ctx.organizationId})
        update work_tasks set client_id = ${patch.clientId}::uuid, updated_at = now() where id in (select id from d)`);
    }

    if (patch.assigneeIds !== undefined) {
      const next = await validateAssignees(tx, ctx, patch.assigneeIds);
      const now = await tx.select({ userId: schema.workTaskAssignees.userId }).from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, id));
      const had = new Set(now.map((r) => r.userId));
      const added = next.filter((u) => !had.has(u));
      const removed = [...had].filter((u) => !next.includes(u));
      if (removed.length) await tx.delete(schema.workTaskAssignees).where(and(eq(schema.workTaskAssignees.taskId, id), inArray(schema.workTaskAssignees.userId, removed)));
      if (added.length) await tx.insert(schema.workTaskAssignees).values(added.map((userId) => ({ taskId: id, userId, organizationId: ctx.organizationId, assignedBy: ctx.userId })));
      if (added.length) await recordActivity(tx, ctx, { entityType: 'task', entityId: id, taskId: id, action: 'assigned', data: { userIds: added } });
      if (removed.length) await recordActivity(tx, ctx, { entityType: 'task', entityId: id, taskId: id, action: 'unassigned', data: { userIds: removed } });
    }
    if (statusChange) await recordActivity(tx, ctx, { entityType: 'task', entityId: id, taskId: id, action: 'status_changed', data: statusChange });
    if (Object.keys(changes).length > 0) await recordActivity(tx, ctx, { entityType: 'task', entityId: id, taskId: id, action: 'updated', data: { changes } });
    return (await hydrate(tx, ctx, [row]))[0]!;
  });
}

// ── Mover / hierarquia ───────────────────────────────────────────────────

/** Move para outra lista (e/ou para outra tarefa-mãe), levando a subárvore junto. Impede ciclo e estouro de profundidade. */
export async function moveTask(ctx: WorkContext, id: string, to: { listId?: string; parentTaskId?: string | null; position?: number }): Promise<WorkTask> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [cur] = await tx.select().from(schema.workTasks).where(and(eq(schema.workTasks.id, id), eq(schema.workTasks.organizationId, ctx.organizationId))).for('update');
    if (!cur) throw notFound('Tarefa');

    const targetListId = to.listId ?? cur.listId;
    const newParent = to.parentTaskId === undefined ? cur.parentTaskId : to.parentTaskId;
    const [fromList] = await tx.select().from(schema.workLists).where(eq(schema.workLists.id, cur.listId));
    const list = await loadList(tx, ctx, targetListId);
    if (list.spaceId !== fromList!.spaceId) throw invalid('Mover entre espaços diferentes ainda não é suportado (os fluxos de status são distintos).');

    let depth = 0;
    if (newParent) {
      if (newParent === id) throw invalid('Uma tarefa não pode ser subtarefa dela mesma.');
      const [parent] = await tx.select().from(schema.workTasks).where(and(eq(schema.workTasks.id, newParent), eq(schema.workTasks.organizationId, ctx.organizationId)));
      if (!parent) throw invalid('Tarefa-mãe não encontrada.');
      if (parent.listId !== targetListId) throw invalid('A subtarefa precisa ficar na mesma lista da tarefa-mãe.');
      // CICLO: o novo pai não pode estar na subárvore desta tarefa.
      const cyc = (await tx.execute(sql`
        with recursive sub as (select id from work_tasks where id = ${id} and organization_id = ${ctx.organizationId}
          union all select t.id from work_tasks t join sub on t.parent_task_id = sub.id)
        select 1 as hit from sub where id = ${newParent} limit 1`)) as unknown as unknown[];
      if (cyc.length > 0) throw conflict('Isto criaria um ciclo: o destino é uma subtarefa desta tarefa.');
      depth = parent.depth + 1;
    }

    // Profundidade da subárvore inteira depois de mover.
    const sub = (await tx.execute(sql`
      with recursive sub as (select id, depth from work_tasks where id = ${id} and organization_id = ${ctx.organizationId}
        union all select t.id, t.depth from work_tasks t join sub on t.parent_task_id = sub.id)
      select id, depth from sub`)) as unknown as Array<{ id: string; depth: number }>;
    const delta = depth - cur.depth;
    const deepest = Math.max(...sub.map((s) => s.depth)) + delta;
    if (deepest > MAX_SUBTASK_DEPTH) throw conflict(`Isto passaria da profundidade máxima de subtarefas (${MAX_SUBTASK_DEPTH}).`);

    const position = to.position ?? (await nextPosition(tx, ctx, targetListId, newParent ?? null));
    const [row] = await tx
      .update(schema.workTasks)
      .set({ listId: targetListId, parentTaskId: newParent ?? null, depth, position, ...(cur.clientId === null && list.clientId ? { clientId: list.clientId } : {}), version: cur.version + 1, updatedAt: new Date() })
      .where(eq(schema.workTasks.id, id))
      .returning();
    const descendants = sub.filter((s) => s.id !== id).map((s) => s.id);
    if (descendants.length > 0) {
      await tx.update(schema.workTasks).set({ listId: targetListId, depth: sql`${schema.workTasks.depth} + ${delta}`, updatedAt: new Date() }).where(inArray(schema.workTasks.id, descendants));
    }
    await recordActivity(tx, ctx, { entityType: 'task', entityId: id, taskId: id, action: 'moved', data: { fromList: cur.listId, toList: targetListId, fromParent: cur.parentTaskId, toParent: newParent ?? null } });
    return (await hydrate(tx, ctx, [row!]))[0]!;
  });
}

// ── Arquivar ─────────────────────────────────────────────────────────────

export async function setTaskArchived(ctx: WorkContext, id: string, archived: boolean): Promise<void> {
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const ids = ((await tx.execute(sql`
      with recursive sub as (select id from work_tasks where id = ${id} and organization_id = ${ctx.organizationId}
        union all select t.id from work_tasks t join sub on t.parent_task_id = sub.id)
      select id from sub`)) as unknown as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) throw notFound('Tarefa');
    await tx.update(schema.workTasks).set({ archivedAt: archived ? new Date() : null, version: sql`${schema.workTasks.version} + 1`, updatedAt: new Date() }).where(inArray(schema.workTasks.id, ids));
    await recordActivity(tx, ctx, { entityType: 'task', entityId: id, taskId: id, action: archived ? 'archived' : 'restored', data: { withSubtasks: ids.length - 1 } });
  });
}

// ── Lote ─────────────────────────────────────────────────────────────────

export interface BulkResult { id: string; ok: boolean; error?: { code: string; message: string } }

/** Aplica o mesmo patch a várias tarefas. NUNCA tudo-ou-nada em silêncio: devolve o resultado de cada uma. */
export async function bulkUpdateTasks(ctx: WorkContext, ids: string[], patch: UpdateTaskInput): Promise<BulkResult[]> {
  if (ids.length === 0) throw invalid('Selecione ao menos uma tarefa.');
  if (ids.length > 200) throw invalid('No máximo 200 tarefas por operação em lote.');
  const results: BulkResult[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      await updateTask(ctx, id, patch);
      results.push({ id, ok: true });
    } catch (e) {
      if (e instanceof WorkError) results.push({ id, ok: false, error: { code: e.code, message: e.message } });
      else throw e;
    }
  }
  return results;
}

// ── Histórico ────────────────────────────────────────────────────────────

export async function getTaskActivity(ctx: WorkContext, taskId: string, limit = 100) {
  await getTask(ctx, taskId);
  return db
    .select()
    .from(schema.workActivityEvents)
    .where(and(eq(schema.workActivityEvents.organizationId, ctx.organizationId), eq(schema.workActivityEvents.taskId, taskId)))
    .orderBy(desc(schema.workActivityEvents.createdAt))
    .limit(Math.min(limit, 500));
}
