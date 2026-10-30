import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';
import { getTask } from './tasks';

/** Tudo que a gaveta da tarefa precisa, numa ida só. Toda leitura filtra por organização. */
export async function getTaskDetail(ctx: WorkContext, taskId: string) {
  const org = ctx.organizationId;
  // Uma leva só, em paralelo: eram seis em série (~3,9 s para abrir uma tarefa com o banco em us-east-1, 30/10/2026).
  // Lista, campos e itens vão por subconsulta à tarefa, sem esperar a tarefa chegar primeiro.
  const listaDaTarefa = sql`(select ${schema.workTasks.listId} from ${schema.workTasks} where ${schema.workTasks.id} = ${taskId} and ${schema.workTasks.organizationId} = ${org})`;
  const [task, comments, checklists, items, attachments, fieldValues, deps, subtasks, listRow, defs, seguidores, [tempo]] = await Promise.all([
    getTask(ctx, taskId), // 404 para id de outra empresa
    db.select({ c: schema.workComments, authorName: schema.users.name, authorAvatar: schema.users.avatarUrl })
      .from(schema.workComments).leftJoin(schema.users, eq(schema.users.id, schema.workComments.authorId))
      .where(and(eq(schema.workComments.taskId, taskId), eq(schema.workComments.organizationId, org))).orderBy(asc(schema.workComments.createdAt)),
    db.select().from(schema.workChecklists).where(and(eq(schema.workChecklists.taskId, taskId), eq(schema.workChecklists.organizationId, org))).orderBy(asc(schema.workChecklists.position)),
    db.select({ i: schema.workChecklistItems }).from(schema.workChecklistItems)
      .innerJoin(schema.workChecklists, eq(schema.workChecklists.id, schema.workChecklistItems.checklistId))
      .where(and(eq(schema.workChecklists.taskId, taskId), eq(schema.workChecklistItems.organizationId, org))).orderBy(asc(schema.workChecklistItems.position)),
    db.select().from(schema.workAttachments).where(and(eq(schema.workAttachments.taskId, taskId), eq(schema.workAttachments.organizationId, org))).orderBy(asc(schema.workAttachments.createdAt)),
    db.select({ v: schema.workCustomFieldValues, name: schema.workCustomFields.name, type: schema.workCustomFields.fieldType })
      .from(schema.workCustomFieldValues).innerJoin(schema.workCustomFields, eq(schema.workCustomFields.id, schema.workCustomFieldValues.fieldId))
      .where(and(eq(schema.workCustomFieldValues.taskId, taskId), eq(schema.workCustomFieldValues.organizationId, org))),
    db.select().from(schema.workTaskDependencies).where(and(eq(schema.workTaskDependencies.organizationId, org), sql`(${schema.workTaskDependencies.taskId} = ${taskId} or ${schema.workTaskDependencies.dependsOnTaskId} = ${taskId})`)),
    db.select({ id: schema.workTasks.id }).from(schema.workTasks).where(and(eq(schema.workTasks.parentTaskId, taskId), eq(schema.workTasks.organizationId, org))),
    db.select({ name: schema.workLists.name, spaceId: schema.workLists.spaceId }).from(schema.workLists).where(sql`${schema.workLists.id} = ${listaDaTarefa}`),
    db.select().from(schema.workCustomFields)
      .where(and(eq(schema.workCustomFields.organizationId, org), sql`${schema.workCustomFields.spaceId} = (select ${schema.workLists.spaceId} from ${schema.workLists} where ${schema.workLists.id} = ${listaDaTarefa})`))
      .orderBy(asc(schema.workCustomFields.position)),
    db.select({ id: schema.users.id, name: schema.users.name, avatar: schema.users.avatarUrl }).from(schema.workTaskFollowers).innerJoin(schema.users, eq(schema.users.id, schema.workTaskFollowers.userId)).where(and(eq(schema.workTaskFollowers.taskId, taskId), eq(schema.workTaskFollowers.organizationId, org))),
    db.select({ ms: sql<number>`coalesce(sum(${schema.workTimeEntries.durationMs}) filter (where ${schema.workTimeEntries.endedAt} is not null), 0)::bigint` }).from(schema.workTimeEntries).where(and(eq(schema.workTimeEntries.taskId, taskId), eq(schema.workTimeEntries.organizationId, org))),
  ]);
  const outras = [...new Set(deps.flatMap((d) => [d.taskId, d.dependsOnTaskId]).filter((i) => i !== taskId))];
  const titulos = outras.length ? await db.select({ id: schema.workTasks.id, number: schema.workTasks.number, title: schema.workTasks.title }).from(schema.workTasks).where(and(inArray(schema.workTasks.id, outras), eq(schema.workTasks.organizationId, org))) : [];
  const t = new Map(titulos.map((x) => [x.id, { id: x.id, key: `DT-${x.number}`, title: x.title }]));
  return {
    task,
    list: listRow[0] ?? null,
    subtaskIds: subtasks.map((s) => s.id),
    comments: comments.map((r) => ({ id: r.c.id, parentCommentId: r.c.parentCommentId, body: r.c.body, authorId: r.c.authorId, authorName: r.authorName ?? r.c.authorLabel ?? 'Alguém', authorAvatar: r.authorAvatar ?? null, resolvedAt: r.c.resolvedAt?.toISOString() ?? null, createdAt: r.c.createdAt.toISOString() })),
    checklists: checklists.map((c) => ({ id: c.id, name: c.name, items: items.map((r) => r.i).filter((i) => i.checklistId === c.id).map((i) => ({ id: i.id, parentItemId: i.parentItemId, text: i.text, done: i.done })) })),
    // Arquivo guardado no servidor não tem URL pública: a tela baixa pela rota autenticada /work/attachments/:id/file.
    attachments: attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, storage: a.storage, url: a.storage === 'storage' ? `/work/attachments/${a.id}/file` : a.url })),
    fieldDefs: defs.map((d) => ({ id: d.id, name: d.name, type: d.fieldType, options: d.options })),
    trackedMs: Number(tempo?.ms ?? 0),
    followers: seguidores,
    following: seguidores.some((f) => f.id === ctx.userId),
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
  // Menções no formato @[Nome](uuid). Só vale quem é MEMBRO desta empresa — o resto é ignorado, nunca notificado.
  const citados = [...new Set([...text.matchAll(/@\[[^\]]+\]\(([0-9a-f-]{36})\)/gi)].map((m) => m[1]!.toLowerCase()))];
  const validos = citados.length
    ? (await db.select({ userId: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), inArray(schema.organizationMembers.userId, citados)))).map((r) => r.userId)
    : [];
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(schema.workComments).values({ organizationId: ctx.organizationId, taskId, authorId: ctx.userId, body: text, mentions: validos, parentCommentId: parentCommentId ?? null }).returning();
    await recordActivity(tx, ctx, { entityType: 'task', entityId: taskId, taskId, action: 'commented', data: { commentId: c!.id } });
    // Quem comenta e quem é citado passa a acompanhar a conversa da tarefa.
    await tx.insert(schema.workTaskFollowers).values([ctx.userId, ...validos].map((userId) => ({ organizationId: ctx.organizationId, taskId, userId }))).onConflictDoNothing();
    for (const userId of validos.filter((u) => u !== ctx.userId)) await recordActivity(tx, ctx, { entityType: 'task', entityId: taskId, taskId, action: 'mentioned', data: { userId, commentId: c!.id } });
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
