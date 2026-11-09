import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';
import { getTask } from './tasks';

/** Cronômetro: um por pessoa. Iniciar outro encerra o anterior (nunca dois relógios correndo para a mesma pessoa). */
export async function startTimer(ctx: WorkContext, taskId: string) {
  await getTask(ctx, taskId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`timer:${ctx.organizationId}:${ctx.userId}`}, 0))`);
    const agora = new Date();
    const abertos = await tx.select().from(schema.workTimeEntries).where(and(eq(schema.workTimeEntries.organizationId, ctx.organizationId), eq(schema.workTimeEntries.userId, ctx.userId), isNull(schema.workTimeEntries.endedAt)));
    for (const a of abertos) await tx.update(schema.workTimeEntries).set({ endedAt: agora, durationMs: Math.max(0, agora.getTime() - a.startedAt.getTime()) }).where(eq(schema.workTimeEntries.id, a.id));
    const [e] = await tx.insert(schema.workTimeEntries).values({ organizationId: ctx.organizationId, taskId, userId: ctx.userId, startedAt: agora }).returning();
    await recordActivity(tx, ctx, { entityType: 'task', entityId: taskId, taskId, action: 'timer_started' });
    return { id: e!.id, taskId, startedAt: agora.toISOString() };
  });
}

export async function stopTimer(ctx: WorkContext) {
  const agora = new Date();
  const [a] = await db.select().from(schema.workTimeEntries).where(and(eq(schema.workTimeEntries.organizationId, ctx.organizationId), eq(schema.workTimeEntries.userId, ctx.userId), isNull(schema.workTimeEntries.endedAt)));
  if (!a) throw notFound('Cronômetro em andamento');
  const durationMs = Math.max(0, agora.getTime() - a.startedAt.getTime());
  await db.update(schema.workTimeEntries).set({ endedAt: agora, durationMs }).where(eq(schema.workTimeEntries.id, a.id));
  return { id: a.id, taskId: a.taskId, durationMs };
}

export async function runningTimer(ctx: WorkContext) {
  const [a] = await db.select({ e: schema.workTimeEntries, title: schema.workTasks.title, number: schema.workTasks.number })
    .from(schema.workTimeEntries).innerJoin(schema.workTasks, eq(schema.workTasks.id, schema.workTimeEntries.taskId))
    .where(and(eq(schema.workTimeEntries.organizationId, ctx.organizationId), eq(schema.workTimeEntries.userId, ctx.userId), isNull(schema.workTimeEntries.endedAt)));
  return a ? { id: a.e.id, taskId: a.e.taskId, taskKey: `DT-${a.number}`, taskTitle: a.title, startedAt: a.e.startedAt.toISOString() } : null;
}

export async function addManualEntry(ctx: WorkContext, taskId: string, input: { minutes: number; startedAt?: Date; note?: string | null; billable?: boolean }) {
  if (!Number.isFinite(input.minutes) || input.minutes <= 0 || input.minutes > 24 * 60) throw invalid('Informe de 1 minuto a 24 horas.');
  await getTask(ctx, taskId);
  const durationMs = Math.round(input.minutes * 60_000);
  const startedAt = input.startedAt ?? new Date(Date.now() - durationMs);
  const [e] = await db.insert(schema.workTimeEntries).values({ organizationId: ctx.organizationId, taskId, userId: ctx.userId, startedAt, endedAt: new Date(startedAt.getTime() + durationMs), durationMs, note: input.note ?? null, billable: input.billable ?? false }).returning();
  return { id: e!.id };
}

export async function listTimeEntries(ctx: WorkContext, taskId: string) {
  await getTask(ctx, taskId);
  const rows = await db.select({ e: schema.workTimeEntries, name: schema.users.name }).from(schema.workTimeEntries)
    .leftJoin(schema.users, eq(schema.users.id, schema.workTimeEntries.userId))
    .where(and(eq(schema.workTimeEntries.organizationId, ctx.organizationId), eq(schema.workTimeEntries.taskId, taskId))).orderBy(desc(schema.workTimeEntries.startedAt));
  const entries = rows.map((r) => ({ id: r.e.id, userName: r.name ?? r.e.userLabel ?? 'Alguém', startedAt: r.e.startedAt.toISOString(), endedAt: r.e.endedAt?.toISOString() ?? null, durationMs: r.e.endedAt ? r.e.durationMs : Date.now() - r.e.startedAt.getTime(), note: r.e.note, running: r.e.endedAt === null }));
  return { entries, totalMs: entries.reduce((s, e) => s + e.durationMs, 0) };
}
