import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';
import { getTask } from './tasks';

/** Tudo que a gaveta da tarefa precisa, numa ida só. Toda leitura filtra por organização. */
export async function getTaskDetail(ctx: WorkContext, taskId: string) {
  const task = await getTask(ctx, taskId); // 404 para id de outra empresa
  const org = ctx.organizationId;
  const [comments, checklists, attachments, fieldValues, deps, subtasks, listRow] = await Promise.all([
    db.select({ c: schema.workComments, authorName: schema.users.name, authorAvatar: schema.users.avatarUrl })
      .from(schema.workComments).leftJoin(schema.users, eq(schema.users.id, schema.workComments.authorId))
      .where(and(eq(schema.workComments.taskId, taskId), eq(schema.workComments.organizationId, org))).orderBy(asc(schema.workComments.createdAt)),
    db.select().from(schema.workChecklists).where(and(eq(schema.workChecklists.taskId, taskId), eq(schema.workChecklists.organizationId, org))).orderBy(asc(schema.workChecklists.position)),
    db.select().from(schema.workAttachments).where(and(eq(schema.workAttachments.taskId, taskId), eq(schema.workAttachments.organizationId, org))).orderBy(asc(schema.workAttachments.createdAt)),
    db.select({ v: schema.workCustomFieldValues, name: schema.workCustomFields.name, type: schema.workCustomFields.fieldType })
      .from(schema.workCustomFieldValues).innerJoin(schema.workCustomFields, eq(schema.workCustomFields.id, schema.workCustomFieldValues.fieldId))
      .where(and(eq(schema.workCustomFieldValues.taskId, taskId), eq(schema.workCustomFieldValues.organizationId, org))),
    db.select().from(schema.workTaskDependencies).where(and(eq(schema.workTaskDependencies.organizationId, org), sql`(${schema.workTaskDependencies.taskId} = ${taskId} or ${schema.workTaskDependencies.dependsOnTaskId} = ${taskId})`)),
    db.select({ id: schema.workTasks.id }).from(schema.workTasks).where(and(eq(schema.workTasks.parentTaskId, taskId), eq(schema.workTasks.organizationId, org))),
    db.select({ name: schema.workLists.name, spaceId: schema.workLists.spaceId }).from(schema.workLists).where(eq(schema.workLists.id, task.listId)),
  ]);
  const items = checklists.length
    ? await db.select().from(schema.workChecklistItems).where(and(inArray(schema.workChecklistItems.checklistId, checklists.map((c) => c.id)), eq(schema.workChecklistItems.organizationId, org))).orderBy(asc(schema.workChecklistItems.position))
    : [];
  const outras = [...new Set(deps.flatMap((d) => [d.taskId, d.dependsOnTaskId]).filter((i) => i !== taskId))];
  const titulos = outras.length ? await db.select({ id: schema.workTasks.id, number: schema.workTasks.number, title: schema.workTasks.title }).from(schema.workTasks).where(and(inArray(schema.workTasks.id, outras), eq(schema.workTasks.organizationId, org))) : [];
  const t = new Map(titulos.map((x) => [x.id, { id: x.id, key: `DT-${x.number}`, title: x.title }]));
  return {
    task,
    list: listRow[0] ?? null,
    subtaskIds: subtasks.map((s) => s.id),
    comments: comments.map((r) => ({ id: r.c.id, parentCommentId: r.c.parentCommentId, body: r.c.body, authorId: r.c.authorId, authorName: r.authorName ?? r.c.authorLabel ?? 'Alguém', authorAvatar: r.authorAvatar ?? null, resolvedAt: r.c.resolvedAt?.toISOString() ?? null, createdAt: r.c.createdAt.toISOString() })),
    checklists: checklists.map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.checklistId === c.id).map((i) => ({ id: i.id, parentItemId: i.parentItemId, text: i.text, done: i.done })) })),
    attachments: attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: a.url })),
    customFields: fieldValues.map((r) => ({ fieldId: r.v.fieldId, name: r.name, type: r.type, value: r.v.value })),
    blockedBy: deps.filter((d) => d.kind === 'blocking' && d.taskId === taskId).map((d) => t.get(d.dependsOnTaskId)).filter(Boolean),
    blocking: deps.filter((d) => d.kind === 'blocking' && d.dependsOnTaskId === taskId).map((d) => t.get(d.taskId)).filter(Boolean),
    related: deps.filter((d) => d.kind === 'related').map((d) => t.get(d.taskId === taskId ? d.dependsOnTaskId : d.taskId)).filter(Boolean),
  };
}

export async function addComment(ctx: WorkContext, taskId: string, body: string, parentCommentId?: string | null) {
  const text = body.trim();
  if (!text) throw invalid('Comentário vazio.');
  if (text.length > 20000) throw invalid('Comentário longo demais.');
  await getTask(ctx, taskId);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(schema.workComments).values({ organizationId: ctx.organizationId, taskId, authorId: ctx.userId, body: text, parentCommentId: parentCommentId ?? null }).returning();
    await recordActivity(tx, ctx, { entityType: 'task', entityId: taskId, taskId, action: 'commented', data: { commentId: c!.id } });
    return { id: c!.id };
  });
}

export async function createChecklist(ctx: WorkContext, taskId: string, name: string) {
  if (!name.trim()) throw invalid('Dê um nome ao checklist.');
  await getTask(ctx, taskId);
  const [{ m } = { m: 0 }] = await db.select({ m: sql<number>`coalesce(max(${schema.workChecklists.position}), 0)` }).from(schema.workChecklists).where(eq(schema.workChecklists.taskId, taskId));
  const [c] = await db.insert(schema.workChecklists).values({ organizationId: ctx.organizationId, taskId, name: name.trim(), position: Number(m) + 1 }).returning();
  return { id: c!.id };
}

async function checklistDaEmpresa(ctx: WorkContext, id: string) {
  const [c] = await db.select().from(schema.workChecklists).where(and(eq(schema.workChecklists.id, id), eq(schema.workChecklists.organizationId, ctx.organizationId)));
  if (!c) throw notFound('Checklist');
  return c;
}

export async function addChecklistItem(ctx: WorkContext, checklistId: string, text: string) {
  if (!text.trim()) throw invalid('Item vazio.');
  await checklistDaEmpresa(ctx, checklistId);
  const [{ m } = { m: 0 }] = await db.select({ m: sql<number>`coalesce(max(${schema.workChecklistItems.position}), 0)` }).from(schema.workChecklistItems).where(eq(schema.workChecklistItems.checklistId, checklistId));
  const [i] = await db.insert(schema.workChecklistItems).values({ organizationId: ctx.organizationId, checklistId, text: text.trim(), position: Number(m) + 1 }).returning();
  return { id: i!.id };
}

export async function setChecklistItemDone(ctx: WorkContext, itemId: string, done: boolean) {
  const [r] = await db.update(schema.workChecklistItems).set({ done }).where(and(eq(schema.workChecklistItems.id, itemId), eq(schema.workChecklistItems.organizationId, ctx.organizationId))).returning({ id: schema.workChecklistItems.id });
  if (!r) throw notFound('Item');
  return { id: r.id, done };
}
