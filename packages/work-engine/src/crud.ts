import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { Db, WorkContext } from './context';
import { invalid, notFound, WorkError } from './errors';
import { getTask } from './tasks';

/** Edição e exclusão de tudo que a gaveta e a árvore mostram. Toda escrita filtra por empresa; "não é seu" vira 404. */

// ── Comentários: só o autor edita ou apaga o próprio comentário
export async function editComment(ctx: WorkContext, commentId: string, body: string) {
  const text = body.trim();
  if (!text) throw invalid('Comentário vazio.');
  const [c] = await db.select().from(schema.workComments).where(and(eq(schema.workComments.id, commentId), eq(schema.workComments.organizationId, ctx.organizationId)));
  if (!c) throw notFound('Comentário');
  if (c.authorId !== ctx.userId) throw new WorkError('forbidden', 'Só quem escreveu pode editar o comentário.');
  await db.update(schema.workComments).set({ body: text, editedAt: new Date() }).where(eq(schema.workComments.id, commentId));
  return { id: commentId };
}

export async function deleteComment(ctx: WorkContext, commentId: string) {
  const [c] = await db.select().from(schema.workComments).where(and(eq(schema.workComments.id, commentId), eq(schema.workComments.organizationId, ctx.organizationId)));
  if (!c) throw notFound('Comentário');
  if (c.authorId !== ctx.userId) throw new WorkError('forbidden', 'Só quem escreveu pode apagar o comentário.');
  await db.delete(schema.workComments).where(eq(schema.workComments.id, commentId));
  return { ok: true };
}

// ── Checklists
export async function renameChecklist(ctx: WorkContext, id: string, name: string) {
  if (!name.trim()) throw invalid('Dê um nome ao checklist.');
  const r = await db.update(schema.workChecklists).set({ name: name.trim() }).where(and(eq(schema.workChecklists.id, id), eq(schema.workChecklists.organizationId, ctx.organizationId))).returning({ id: schema.workChecklists.id });
  if (!r.length) throw notFound('Checklist');
  return { id };
}
export async function deleteChecklist(ctx: WorkContext, id: string) {
  const r = await db.delete(schema.workChecklists).where(and(eq(schema.workChecklists.id, id), eq(schema.workChecklists.organizationId, ctx.organizationId))).returning({ id: schema.workChecklists.id });
  if (!r.length) throw notFound('Checklist');
  return { ok: true };
}
export async function editChecklistItem(ctx: WorkContext, id: string, patch: { text?: string; done?: boolean; assigneeId?: string | null }) {
  const set: Record<string, unknown> = {};
  if (patch.text !== undefined) { if (!patch.text.trim()) throw invalid('Item vazio.'); set.text = patch.text.trim(); }
  if (patch.done !== undefined) set.done = patch.done;
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId) {
      const [m] = await db.select({ u: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), eq(schema.organizationMembers.userId, patch.assigneeId)));
      if (!m) throw invalid('Essa pessoa não é da empresa.');
    }
    set.assigneeId = patch.assigneeId;
  }
  if (!Object.keys(set).length) throw invalid('Nada para alterar.');
  const r = await db.update(schema.workChecklistItems).set(set).where(and(eq(schema.workChecklistItems.id, id), eq(schema.workChecklistItems.organizationId, ctx.organizationId))).returning({ id: schema.workChecklistItems.id });
  if (!r.length) throw notFound('Item');
  return { id };
}
export async function deleteChecklistItem(ctx: WorkContext, id: string) {
  const r = await db.delete(schema.workChecklistItems).where(and(eq(schema.workChecklistItems.id, id), eq(schema.workChecklistItems.organizationId, ctx.organizationId))).returning({ id: schema.workChecklistItems.id });
  if (!r.length) throw notFound('Item');
  return { ok: true };
}

// ── Anexos (por link; o arquivo continua onde está)
export async function addAttachmentLink(ctx: WorkContext, taskId: string, input: { url: string; fileName?: string }) {
  let u: URL;
  try { u = new URL(input.url); } catch { throw invalid('Link inválido.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw invalid('Só links http(s).');
  await getTask(ctx, taskId);
  const [a] = await db.insert(schema.workAttachments).values({ organizationId: ctx.organizationId, taskId, fileName: (input.fileName?.trim() || u.hostname + u.pathname).slice(0, 300), url: u.toString(), storage: 'external', uploadedBy: ctx.userId }).returning();
  return { id: a!.id };
}
export async function deleteAttachment(ctx: WorkContext, id: string) {
  const r = await db.delete(schema.workAttachments).where(and(eq(schema.workAttachments.id, id), eq(schema.workAttachments.organizationId, ctx.organizationId))).returning({ id: schema.workAttachments.id });
  if (!r.length) throw notFound('Anexo');
  return { ok: true };
}

// ── Dependências
export async function addDependency(ctx: WorkContext, taskId: string, dependsOnId: string, kind: 'blocking' | 'related' = 'blocking') {
  if (taskId === dependsOnId) throw invalid('Uma tarefa não pode depender dela mesma.');
  await getTask(ctx, taskId); await getTask(ctx, dependsOnId);
  if (kind === 'blocking') {
    // ciclo: se `dependsOnId` já depende (direta ou indiretamente) de `taskId`, fecharia um laço
    const rows = (await db.execute(sql`with recursive cadeia as (
        select depends_on_task_id as id from work_task_dependencies where task_id = ${dependsOnId} and kind = 'blocking' and organization_id = ${ctx.organizationId}
        union select d.depends_on_task_id from work_task_dependencies d join cadeia c on d.task_id = c.id where d.kind = 'blocking' and d.organization_id = ${ctx.organizationId})
      select 1 as hit from cadeia where id = ${taskId} limit 1`)) as unknown as unknown[];
    if (rows.length) throw invalid('Essa dependência criaria um ciclo.');
  }
  await db.insert(schema.workTaskDependencies).values({ organizationId: ctx.organizationId, taskId, dependsOnTaskId: dependsOnId, kind }).onConflictDoNothing();
  return { ok: true };
}
export async function removeDependency(ctx: WorkContext, taskId: string, dependsOnId: string) {
  await db.delete(schema.workTaskDependencies).where(and(eq(schema.workTaskDependencies.organizationId, ctx.organizationId), sql`((${schema.workTaskDependencies.taskId} = ${taskId} and ${schema.workTaskDependencies.dependsOnTaskId} = ${dependsOnId}) or (${schema.workTaskDependencies.taskId} = ${dependsOnId} and ${schema.workTaskDependencies.dependsOnTaskId} = ${taskId}))`));
  return { ok: true };
}

// ── Exclusão definitiva: só do que JÁ está arquivado (arquivar é o caminho normal e reversível)
export async function deleteTaskPermanently(ctx: WorkContext, taskId: string) {
  const r = await db.delete(schema.workTasks).where(and(eq(schema.workTasks.id, taskId), eq(schema.workTasks.organizationId, ctx.organizationId), isNotNull(schema.workTasks.archivedAt))).returning({ id: schema.workTasks.id });
  if (!r.length) {
    await getTask(ctx, taskId); // 404 se não existe / é de outra empresa
    throw invalid('Arquive a tarefa antes de excluir definitivamente.');
  }
  return { ok: true };
}

const TABELAS = { space: schema.workSpaces, folder: schema.workFolders, project: schema.workProjects, list: schema.workLists } as const;
export async function deleteContainerPermanently(ctx: WorkContext, kind: keyof typeof TABELAS, id: string) {
  const t = TABELAS[kind];
  const r = await db.delete(t).where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId), isNotNull(t.archivedAt))).returning({ id: t.id });
  if (!r.length) {
    const [ex] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.organizationId, ctx.organizationId)));
    if (!ex) throw notFound({ space: 'Espaço', folder: 'Pasta', project: 'Projeto', list: 'Lista' }[kind]);
    throw invalid('Arquive antes de excluir definitivamente.');
  }
  return { ok: true };
}

export async function renameFolder(ctx: WorkContext, id: string, name: string) {
  if (!name.trim()) throw invalid('Dê um nome à pasta.');
  const r = await db.update(schema.workFolders).set({ name: name.trim() }).where(and(eq(schema.workFolders.id, id), eq(schema.workFolders.organizationId, ctx.organizationId))).returning({ id: schema.workFolders.id });
  if (!r.length) throw notFound('Pasta');
  return { id };
}

void recordActivity; void ({} as Db);
