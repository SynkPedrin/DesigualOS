import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { Db, WorkContext } from './context';
import { conflict, invalid, notFound } from './errors';

export const STATUS_CATEGORIES = ['todo', 'active', 'review', 'blocked', 'done', 'cancelled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** Workflow padrão que todo espaço novo recebe. Depois disso é configurável: nada no front depende destes nomes. */
export const DEFAULT_WORKFLOW: ReadonlyArray<{ name: string; color: string; category: StatusCategory; isInitial?: boolean; isFinal?: boolean }> = [
  { name: 'A fazer', color: '#6b7280', category: 'todo', isInitial: true },
  { name: 'Em andamento', color: '#3b82f6', category: 'active' },
  { name: 'Revisão', color: '#a855f7', category: 'review' },
  { name: 'Aguardando aprovação', color: '#f59e0b', category: 'review' },
  { name: 'Concluído', color: '#22c55e', category: 'done', isFinal: true },
];

export async function seedDefaultWorkflow(tx: Db, ctx: WorkContext, spaceId: string): Promise<void> {
  await tx.insert(schema.workTaskStatuses).values(
    DEFAULT_WORKFLOW.map((s, i) => ({
      organizationId: ctx.organizationId,
      spaceId,
      name: s.name,
      color: s.color,
      category: s.category,
      position: (i + 1) * 1000,
      isInitial: s.isInitial ?? false,
      isFinal: s.isFinal ?? false,
    })),
  );
}

export type WorkStatus = typeof schema.workTaskStatuses.$inferSelect;

export async function listStatuses(ctx: WorkContext, spaceId: string): Promise<WorkStatus[]> {
  return db
    .select()
    .from(schema.workTaskStatuses)
    .where(and(eq(schema.workTaskStatuses.organizationId, ctx.organizationId), eq(schema.workTaskStatuses.spaceId, spaceId)))
    .orderBy(asc(schema.workTaskStatuses.position));
}

async function assertSpace(tx: Db, ctx: WorkContext, spaceId: string): Promise<void> {
  const [s] = await tx
    .select({ id: schema.workSpaces.id })
    .from(schema.workSpaces)
    .where(and(eq(schema.workSpaces.id, spaceId), eq(schema.workSpaces.organizationId, ctx.organizationId)));
  if (!s) throw notFound('Espaço');
}

export interface StatusInput {
  name: string;
  color?: string;
  category?: StatusCategory;
  isInitial?: boolean;
  isFinal?: boolean;
  position?: number;
}

function validateStatus(input: Partial<StatusInput>): void {
  if (input.name !== undefined && (input.name.trim().length === 0 || input.name.length > 60)) throw invalid('O nome do status precisa ter de 1 a 60 caracteres.');
  if (input.category !== undefined && !STATUS_CATEGORIES.includes(input.category)) throw invalid('Categoria de status inválida.');
  if (input.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw invalid('Cor inválida (use #rrggbb).');
}

export async function createStatus(ctx: WorkContext, spaceId: string, input: StatusInput): Promise<WorkStatus> {
  validateStatus(input);
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await assertSpace(tx, ctx, spaceId);
    const [max] = await tx
      .select({ m: sql<number>`coalesce(max(${schema.workTaskStatuses.position}), 0)` })
      .from(schema.workTaskStatuses)
      .where(eq(schema.workTaskStatuses.spaceId, spaceId));
    if (input.isInitial) await tx.update(schema.workTaskStatuses).set({ isInitial: false }).where(eq(schema.workTaskStatuses.spaceId, spaceId));
    try {
      const [row] = await tx
        .insert(schema.workTaskStatuses)
        .values({
          organizationId: ctx.organizationId,
          spaceId,
          name: input.name.trim(),
          color: input.color ?? '#6b7280',
          category: input.category ?? 'active',
          position: input.position ?? Number(max?.m ?? 0) + 1000,
          isInitial: input.isInitial ?? false,
          isFinal: input.isFinal ?? input.category === 'done',
        })
        .returning();
      await recordActivity(tx, ctx, { entityType: 'status', entityId: row!.id, action: 'created', data: { spaceId, name: row!.name } });
      return row!;
    } catch (e) {
      if (String((e as { message?: string }).message).includes('work_task_statuses_space_name_unique')) throw conflict('Já existe um status com este nome neste espaço.');
      throw e;
    }
  });
}

export async function updateStatus(ctx: WorkContext, statusId: string, patch: Partial<StatusInput>): Promise<WorkStatus> {
  validateStatus(patch);
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [cur] = await tx
      .select()
      .from(schema.workTaskStatuses)
      .where(and(eq(schema.workTaskStatuses.id, statusId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId)));
    if (!cur) throw notFound('Status');
    // O espaço precisa manter UM status inicial: tirar o marcador sem pôr em outro deixaria tarefa nova sem onde nascer.
    if (patch.isInitial === false && cur.isInitial) throw invalid('Defina outro status como inicial em vez de remover o marcador deste.');
    if (patch.isInitial) await tx.update(schema.workTaskStatuses).set({ isInitial: false }).where(eq(schema.workTaskStatuses.spaceId, cur.spaceId));
    const set: Partial<typeof schema.workTaskStatuses.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.isInitial !== undefined) set.isInitial = patch.isInitial;
    if (patch.isFinal !== undefined) set.isFinal = patch.isFinal;
    if (patch.position !== undefined) set.position = patch.position;
    try {
      const [row] = await tx.update(schema.workTaskStatuses).set(set).where(eq(schema.workTaskStatuses.id, statusId)).returning();
      await recordActivity(tx, ctx, { entityType: 'status', entityId: statusId, action: 'updated', data: { fields: Object.keys(patch) } });
      return row!;
    } catch (e) {
      if (String((e as { message?: string }).message).includes('work_task_statuses_space_name_unique')) throw conflict('Já existe um status com este nome neste espaço.');
      throw e;
    }
  });
}

/**
 * Remove um status. Se há tarefa nele, EXIGE um destino (`migrateToStatusId`, do mesmo espaço): apagar
 * um status em uso deixaria tarefa sem estado, e a FK é `restrict` justamente para isso não acontecer
 * em silêncio. As tarefas migradas ganham evento de atividade.
 */
export async function deleteStatus(ctx: WorkContext, statusId: string, opts: { migrateToStatusId?: string } = {}): Promise<{ migratedTasks: number }> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [cur] = await tx
      .select()
      .from(schema.workTaskStatuses)
      .where(and(eq(schema.workTaskStatuses.id, statusId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId)));
    if (!cur) throw notFound('Status');
    if (cur.isInitial) throw conflict('Este é o status inicial do espaço. Defina outro como inicial antes de remover.');
    const [inUse] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.workTasks).where(eq(schema.workTasks.statusId, statusId));
    const count = inUse?.n ?? 0;
    if (count > 0) {
      if (!opts.migrateToStatusId) throw conflict(`${count} tarefa(s) estão neste status. Escolha para onde movê-las.`, { tasksInStatus: count });
      if (opts.migrateToStatusId === statusId) throw invalid('O destino precisa ser outro status.');
      const [dest] = await tx
        .select()
        .from(schema.workTaskStatuses)
        .where(and(eq(schema.workTaskStatuses.id, opts.migrateToStatusId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId), eq(schema.workTaskStatuses.spaceId, cur.spaceId)));
      if (!dest) throw invalid('O status de destino precisa ser do mesmo espaço.');
      const moved = await tx
        .update(schema.workTasks)
        .set({ statusId: dest.id, completedAt: dest.isFinal ? new Date() : null, version: sql`${schema.workTasks.version} + 1`, updatedAt: new Date() })
        .where(eq(schema.workTasks.statusId, statusId))
        .returning({ id: schema.workTasks.id });
      for (const t of moved) await recordActivity(tx, ctx, { entityType: 'task', entityId: t.id, taskId: t.id, action: 'status_changed', data: { from: statusId, to: dest.id, reason: 'status_removed' } });
    }
    await tx.delete(schema.workTaskStatuses).where(eq(schema.workTaskStatuses.id, statusId));
    await recordActivity(tx, ctx, { entityType: 'status', entityId: statusId, action: 'deleted', data: { name: cur.name, migrated: count } });
    return { migratedTasks: count };
  });
}

/** Define as transições permitidas a partir de um status. Lista vazia = volta a ser livre. */
export async function setTransitionsFrom(ctx: WorkContext, fromStatusId: string, toStatusIds: string[]): Promise<void> {
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [from] = await tx
      .select()
      .from(schema.workTaskStatuses)
      .where(and(eq(schema.workTaskStatuses.id, fromStatusId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId)));
    if (!from) throw notFound('Status');
    const targets = [...new Set(toStatusIds)].filter((id) => id !== fromStatusId);
    if (targets.length > 0) {
      const found = await tx
        .select({ id: schema.workTaskStatuses.id })
        .from(schema.workTaskStatuses)
        .where(and(inArray(schema.workTaskStatuses.id, targets), eq(schema.workTaskStatuses.spaceId, from.spaceId), eq(schema.workTaskStatuses.organizationId, ctx.organizationId)));
      if (found.length !== targets.length) throw invalid('Todas as transições precisam apontar para status do mesmo espaço.');
    }
    await tx.delete(schema.workStatusTransitions).where(eq(schema.workStatusTransitions.fromStatusId, fromStatusId));
    if (targets.length > 0) {
      await tx.insert(schema.workStatusTransitions).values(targets.map((to) => ({ organizationId: ctx.organizationId, spaceId: from.spaceId, fromStatusId, toStatusId: to })));
    }
    await recordActivity(tx, ctx, { entityType: 'status', entityId: fromStatusId, action: 'transitions_set', data: { to: targets } });
  });
}

export async function listTransitions(ctx: WorkContext, spaceId: string): Promise<Array<{ fromStatusId: string; toStatusId: string }>> {
  return db
    .select({ fromStatusId: schema.workStatusTransitions.fromStatusId, toStatusId: schema.workStatusTransitions.toStatusId })
    .from(schema.workStatusTransitions)
    .where(and(eq(schema.workStatusTransitions.organizationId, ctx.organizationId), eq(schema.workStatusTransitions.spaceId, spaceId)));
}

/** Lança se a mudança de `from` para `to` não é permitida. Sem regra cadastrada para `from`, tudo é permitido. */
export async function assertTransitionAllowed(tx: Db, ctx: WorkContext, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const rules = await tx
    .select({ toStatusId: schema.workStatusTransitions.toStatusId })
    .from(schema.workStatusTransitions)
    .where(and(eq(schema.workStatusTransitions.organizationId, ctx.organizationId), eq(schema.workStatusTransitions.fromStatusId, fromId)));
  if (rules.length === 0) return;
  if (!rules.some((r) => r.toStatusId === toId)) throw conflict('Esta mudança de status não é permitida pelo fluxo configurado.', { from: fromId, to: toId });
}
