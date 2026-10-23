import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { WorkContext } from './context';
import { invalid } from './errors';
import { getTask } from './tasks';

/** Seguir a tarefa = receber aviso de comentário e de mudança de status, mesmo sem ser responsável. */
export async function followTask(ctx: WorkContext, taskId: string, userId: string = ctx.userId) {
  await getTask(ctx, taskId);
  const [m] = await db.select({ u: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), eq(schema.organizationMembers.userId, userId)));
  if (!m) throw invalid('Essa pessoa não é da empresa.');
  const r = await db.insert(schema.workTaskFollowers).values({ organizationId: ctx.organizationId, taskId, userId }).onConflictDoNothing().returning({ u: schema.workTaskFollowers.userId });
  if (r.length && userId === ctx.userId) await db.transaction(async (tx) => recordActivity(tx, ctx, { entityType: 'task', entityId: taskId, taskId, action: 'followed' }));
  return { ok: true };
}

export async function unfollowTask(ctx: WorkContext, taskId: string, userId: string = ctx.userId) {
  await getTask(ctx, taskId);
  const r = await db.delete(schema.workTaskFollowers).where(and(eq(schema.workTaskFollowers.organizationId, ctx.organizationId), eq(schema.workTaskFollowers.taskId, taskId), eq(schema.workTaskFollowers.userId, userId))).returning({ u: schema.workTaskFollowers.userId });
  if (r.length && userId === ctx.userId) await db.transaction(async (tx) => recordActivity(tx, ctx, { entityType: 'task', entityId: taskId, taskId, action: 'unfollowed' }));
  return { ok: true };
}

export async function listFollowers(ctx: WorkContext, taskId: string) {
  await getTask(ctx, taskId);
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, avatar: schema.users.avatarUrl }).from(schema.workTaskFollowers).innerJoin(schema.users, eq(schema.users.id, schema.workTaskFollowers.userId)).where(and(eq(schema.workTaskFollowers.organizationId, ctx.organizationId), eq(schema.workTaskFollowers.taskId, taskId)));
  return rows;
}
