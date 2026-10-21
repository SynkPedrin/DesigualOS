import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';

const RELEVANTES = ['commented', 'status_changed', 'assigned', 'updated', 'mentioned', 'completed'];

/**
 * Caixa de entrada: o que aconteceu nas tarefas da pessoa (responsável ou criadora) feito POR OUTRA pessoa,
 * mais as menções diretas a ela. Nada de dado de outra empresa: tudo filtra por organização.
 */
export async function listInbox(ctx: WorkContext, limit = 60) {
  const org = ctx.organizationId;
  const E = schema.workActivityEvents;
  const [estado] = await db.select().from(schema.workUserState).where(and(eq(schema.workUserState.organizationId, org), eq(schema.workUserState.userId, ctx.userId)));
  const lidoAte = estado?.inboxReadAt ?? null;
  const minhas = sql`(select t.id from work_tasks t where t.organization_id = ${org} and (t.created_by = ${ctx.userId} or exists (select 1 from work_task_assignees a where a.task_id = t.id and a.user_id = ${ctx.userId})))`;
  const rows = await db
    .select({ e: E, title: schema.workTasks.title, number: schema.workTasks.number, actorName: schema.users.name, actorAvatar: schema.users.avatarUrl })
    .from(E)
    .innerJoin(schema.workTasks, eq(schema.workTasks.id, E.taskId))
    .leftJoin(schema.users, eq(schema.users.id, E.actorId))
    .where(and(
      eq(E.organizationId, org),
      inArray(E.action, RELEVANTES),
      sql`(
        (${E.action} = 'mentioned' and ${E.data}->>'userId' = ${ctx.userId})
        or (${E.taskId} in ${minhas} and (${E.actorId} is null or ${E.actorId} <> ${ctx.userId}) and ${E.action} <> 'mentioned')
      )`,
    ))
    .orderBy(desc(E.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({
    id: r.e.id,
    taskId: r.e.taskId,
    taskKey: `DT-${r.number}`,
    taskTitle: r.title,
    action: r.e.action,
    actorName: r.e.actorKind === 'automation' ? 'Automação' : (r.actorName ?? 'Alguém'),
    actorAvatar: r.actorAvatar ?? null,
    data: r.e.data,
    createdAt: r.e.createdAt.toISOString(),
    unread: lidoAte === null || r.e.createdAt > lidoAte,
  }));
}

export async function markInboxRead(ctx: WorkContext) {
  await db.insert(schema.workUserState).values({ organizationId: ctx.organizationId, userId: ctx.userId, inboxReadAt: new Date() })
    .onConflictDoUpdate({ target: [schema.workUserState.organizationId, schema.workUserState.userId], set: { inboxReadAt: new Date() } });
  return { ok: true };
}

export async function inboxUnreadCount(ctx: WorkContext): Promise<number> {
  const itens = await listInbox(ctx, 200);
  return itens.filter((i) => i.unread).length;
}

// evita warnings de import não usado em builds estritos
void gt; void ne;
