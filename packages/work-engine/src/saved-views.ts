import { and, eq, isNull, or } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';

export async function listSavedViews(ctx: WorkContext) {
  return db.select().from(schema.workSavedViews).where(and(eq(schema.workSavedViews.organizationId, ctx.organizationId), or(isNull(schema.workSavedViews.userId), eq(schema.workSavedViews.userId, ctx.userId))));
}
export async function createSavedView(ctx: WorkContext, input: { name: string; config: Record<string, unknown>; shared?: boolean }) {
  if (!input.name.trim()) throw invalid('Dê um nome à visão.');
  const [v] = await db.insert(schema.workSavedViews).values({ organizationId: ctx.organizationId, userId: input.shared ? null : ctx.userId, name: input.name.trim(), config: input.config }).returning();
  return v!;
}
export async function deleteSavedView(ctx: WorkContext, id: string) {
  // só apaga a PRÓPRIA visão, ou a compartilhada da empresa
  const r = await db.delete(schema.workSavedViews).where(and(eq(schema.workSavedViews.id, id), eq(schema.workSavedViews.organizationId, ctx.organizationId), or(isNull(schema.workSavedViews.userId), eq(schema.workSavedViews.userId, ctx.userId)))).returning({ id: schema.workSavedViews.id });
  if (r.length === 0) throw notFound('Visão');
  return { ok: true };
}
