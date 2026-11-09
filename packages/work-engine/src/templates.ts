import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';
import { createTask, getTask, updateTask } from './tasks';

/** Esqueleto de uma tarefa: o que um modelo ou uma recorrência copia (título, descrição, prioridade, tags, subtarefas, checklists). */
export interface TaskBlueprint {
  title: string;
  description: string | null;
  priority: number;
  tags: string[];
  estimateMinutes: number | null;
  assigneeIds: string[];
  subtasks: TaskBlueprint[];
  checklists: Array<{ name: string; items: string[] }>;
}

async function capturar(ctx: WorkContext, taskId: string, nivel = 0): Promise<TaskBlueprint> {
  const t = await getTask(ctx, taskId);
  const subs = nivel >= 3 ? [] : await db.select({ id: schema.workTasks.id }).from(schema.workTasks).where(and(eq(schema.workTasks.parentTaskId, taskId), eq(schema.workTasks.organizationId, ctx.organizationId), sql`${schema.workTasks.archivedAt} is null`)).orderBy(asc(schema.workTasks.position));
  const cls = await db.select().from(schema.workChecklists).where(and(eq(schema.workChecklists.taskId, taskId), eq(schema.workChecklists.organizationId, ctx.organizationId))).orderBy(asc(schema.workChecklists.position));
  const itens = cls.length ? await db.select().from(schema.workChecklistItems).where(inArray(schema.workChecklistItems.checklistId, cls.map((c) => c.id))).orderBy(asc(schema.workChecklistItems.position)) : [];
  return {
    title: t.title, description: t.description, priority: t.priority, tags: t.tags, estimateMinutes: t.estimateMinutes, assigneeIds: t.assigneeIds,
    subtasks: await Promise.all(subs.map((s) => capturar(ctx, s.id, nivel + 1))),
    checklists: cls.map((c) => ({ name: c.name, items: itens.filter((i) => i.checklistId === c.id).map((i) => i.text) })),
  };
}

async function materializar(ctx: WorkContext, listId: string, b: TaskBlueprint, over: { parentTaskId?: string; dueAt?: Date | null; title?: string } = {}): Promise<string> {
  const t = await createTask(ctx, { listId, title: over.title ?? b.title, description: b.description, priority: b.priority, tags: b.tags, estimateMinutes: b.estimateMinutes, assigneeIds: b.assigneeIds, dueAt: over.dueAt ?? null, ...(over.parentTaskId ? { parentTaskId: over.parentTaskId } : {}) });
  for (const [i, c] of b.checklists.entries()) {
    const [cl] = await db.insert(schema.workChecklists).values({ organizationId: ctx.organizationId, taskId: t.id, name: c.name, position: i + 1 }).returning();
    if (c.items.length) await db.insert(schema.workChecklistItems).values(c.items.map((text, j) => ({ organizationId: ctx.organizationId, checklistId: cl!.id, text, position: j + 1 })));
  }
  for (const s of b.subtasks) await materializar(ctx, listId, s, { parentTaskId: t.id });
  return t.id;
}

export async function createTemplateFromTask(ctx: WorkContext, taskId: string, name: string) {
  if (!name.trim()) throw invalid('Dê um nome ao modelo.');
  const payload = await capturar(ctx, taskId);
  const [m] = await db.insert(schema.workTemplates).values({ organizationId: ctx.organizationId, kind: 'task', name: name.trim(), payload: payload as unknown as Record<string, unknown>, createdBy: ctx.userId }).returning();
  return { id: m!.id, name: m!.name };
}

export async function listTemplates(ctx: WorkContext) {
  const rows = await db.select().from(schema.workTemplates).where(eq(schema.workTemplates.organizationId, ctx.organizationId)).orderBy(asc(schema.workTemplates.name));
  return rows.map((r) => { const p = r.payload as unknown as TaskBlueprint; return { id: r.id, name: r.name, kind: r.kind, subtasks: p.subtasks?.length ?? 0, checklists: p.checklists?.length ?? 0, createdAt: r.createdAt.toISOString() }; });
}

export async function deleteTemplate(ctx: WorkContext, id: string) {
  const r = await db.delete(schema.workTemplates).where(and(eq(schema.workTemplates.id, id), eq(schema.workTemplates.organizationId, ctx.organizationId))).returning({ id: schema.workTemplates.id });
  if (!r.length) throw notFound('Modelo');
  return { ok: true };
}

export async function instantiateTemplate(ctx: WorkContext, templateId: string, listId: string, over: { title?: string; dueAt?: Date | null } = {}) {
  const [m] = await db.select().from(schema.workTemplates).where(and(eq(schema.workTemplates.id, templateId), eq(schema.workTemplates.organizationId, ctx.organizationId)));
  if (!m) throw notFound('Modelo');
  const id = await materializar(ctx, listId, m.payload as unknown as TaskBlueprint, over);
  return getTask(ctx, id);
}

/** Duplica uma tarefa (com subtarefas e checklists) na mesma lista ou em outra. */
export async function duplicateTask(ctx: WorkContext, taskId: string, listId?: string) {
  const t = await getTask(ctx, taskId);
  const b = await capturar(ctx, taskId);
  const id = await materializar(ctx, listId ?? t.listId, b, { title: `${b.title} (cópia)` });
  return getTask(ctx, id);
}

// ── Recorrência ───────────────────────────────────────────────────────────

function proxima(de: Date, freq: string, interval: number): Date {
  const d = new Date(de);
  if (freq === 'daily') d.setDate(d.getDate() + interval);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7 * interval);
  else d.setMonth(d.getMonth() + interval);
  return d;
}

export async function createRecurrence(ctx: WorkContext, taskId: string, input: { freq: string; interval?: number; firstRunAt?: Date }) {
  if (!['daily', 'weekly', 'monthly'].includes(input.freq)) throw invalid('Frequência inválida (daily, weekly, monthly).');
  const interval = input.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw invalid('Intervalo de 1 a 52.');
  await getTask(ctx, taskId);
  const first = input.firstRunAt ?? proxima(new Date(), input.freq, interval);
  const [r] = await db.insert(schema.workRecurrences).values({ organizationId: ctx.organizationId, templateTaskId: taskId, freq: input.freq, interval, nextRunAt: first, createdBy: ctx.userId }).returning();
  return r!;
}

export async function listRecurrences(ctx: WorkContext) {
  const rows = await db.select({ r: schema.workRecurrences, title: schema.workTasks.title, number: schema.workTasks.number }).from(schema.workRecurrences).innerJoin(schema.workTasks, eq(schema.workTasks.id, schema.workRecurrences.templateTaskId)).where(eq(schema.workRecurrences.organizationId, ctx.organizationId));
  return rows.map((x) => ({ id: x.r.id, taskId: x.r.templateTaskId, taskKey: `DT-${x.number}`, taskTitle: x.title, freq: x.r.freq, interval: x.r.interval, active: x.r.active, nextRunAt: x.r.nextRunAt.toISOString(), lastRunAt: x.r.lastRunAt?.toISOString() ?? null }));
}

export async function setRecurrenceActive(ctx: WorkContext, id: string, active: boolean) {
  const r = await db.update(schema.workRecurrences).set({ active }).where(and(eq(schema.workRecurrences.id, id), eq(schema.workRecurrences.organizationId, ctx.organizationId))).returning({ id: schema.workRecurrences.id });
  if (!r.length) throw notFound('Recorrência');
  return { ok: true };
}

/** Cria as ocorrências vencidas. Cada recorrência é "reivindicada" por UPDATE condicional: duas instâncias nunca geram a mesma ocorrência. */
export async function runDueRecurrences(now = new Date()): Promise<number> {
  const due = await db.select().from(schema.workRecurrences).where(and(eq(schema.workRecurrences.active, true), lte(schema.workRecurrences.nextRunAt, now))).limit(100);
  let criadas = 0;
  for (const r of due) {
    const nova = proxima(r.nextRunAt, r.freq, r.interval);
    const [claim] = await db.update(schema.workRecurrences).set({ nextRunAt: nova > now ? nova : proxima(now, r.freq, r.interval), lastRunAt: now }).where(and(eq(schema.workRecurrences.id, r.id), eq(schema.workRecurrences.nextRunAt, r.nextRunAt))).returning();
    if (!claim) continue;
    try {
      const owner = r.createdBy;
      if (!owner) continue;
      const ctx: WorkContext = { organizationId: r.organizationId, userId: owner, actorKind: 'system' };
      const t = await getTask(ctx, r.templateTaskId);
      const b = await capturar(ctx, r.templateTaskId);
      await materializar(ctx, t.listId, b, { dueAt: r.nextRunAt });
      criadas++;
    } catch { /* uma recorrência quebrada não impede as outras; o próximo ciclo tenta de novo na data seguinte */ }
  }
  return criadas;
}

void updateTask;
