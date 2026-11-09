import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { recordActivity } from './activity';
import type { Db, WorkContext } from './context';
import { invalid, notFound } from './errors';
import { getTask } from './tasks';

/**
 * APROVAÇÃO DE TAREFA. Usa a MESMA fila do módulo Aprovações (`approval_requests`, tipo "task", id da tarefa em
 * `resource_id`): quem aprova pela tela de Aprovações e quem aprova dentro da tarefa mexe no mesmo registro, e os dois
 * caminhos deixam rastro na tarefa e avisam quem pediu. Sem tabela nova.
 */
const tx = () => db as unknown as Db;
type Resolucao = 'approved' | 'rejected' | 'changes_requested';
const ROTULO: Record<Resolucao, string> = { approved: 'aprovou', rejected: 'reprovou', changes_requested: 'pediu ajustes em' };

async function avisar(userIds: string[], ctx: WorkContext, type: string, title: string, taskId: string) {
  const alvo = [...new Set(userIds)].filter((u) => u !== ctx.userId);
  if (!alvo.length) return;
  const membros = await db.select({ userId: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), inArray(schema.organizationMembers.userId, alvo)));
  if (!membros.length) return;
  await db.insert(schema.notifications).values(membros.map((m) => ({ userId: m.userId, type, title: title.slice(0, 240), body: null, link: `/daily-tasks?task=${taskId}` })));
}

export async function listTaskApprovals(ctx: WorkContext, taskId: string) {
  await getTask(ctx, taskId);
  const A = schema.approvalRequests;
  const rows = await db.select({ a: A, solicitante: schema.users.name }).from(A)
    .leftJoin(schema.users, eq(schema.users.id, A.requestedBy))
    .where(and(eq(A.organizationId, ctx.organizationId), eq(A.resourceType, 'task'), eq(A.resourceId, taskId)))
    .orderBy(desc(A.createdAt));
  const aprovadores = rows.map((r) => r.a.approverId).filter((x): x is string => Boolean(x));
  const nomes = aprovadores.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, aprovadores)) : [];
  const N = new Map(nomes.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.a.id, status: r.a.status, comment: r.a.comment, requestedBy: r.a.requestedBy, requestedByName: r.solicitante ?? 'Alguém',
    approverId: r.a.approverId, approverName: r.a.approverId ? N.get(r.a.approverId) ?? null : null,
    createdAt: r.a.createdAt.toISOString(), resolvedAt: r.a.resolvedAt?.toISOString() ?? null,
  }));
}

/** Pede aprovação. Se já existe um pedido aberto para a tarefa, devolve esse (clique duplo não empilha). */
export async function requestTaskApproval(ctx: WorkContext, taskId: string, input: { approverId?: string | null; note?: string | null } = {}) {
  const t = await getTask(ctx, taskId);
  const A = schema.approvalRequests;
  const [aberto] = await db.select({ id: A.id }).from(A).where(and(eq(A.organizationId, ctx.organizationId), eq(A.resourceType, 'task'), eq(A.resourceId, taskId), eq(A.status, 'pending')));
  if (aberto) return { id: aberto.id, created: false };
  if (input.approverId) {
    const [m] = await db.select({ userId: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), eq(schema.organizationMembers.userId, input.approverId)));
    if (!m) throw invalid('Essa pessoa não é da empresa.');
    if (input.approverId === ctx.userId) throw invalid('Escolha outra pessoa para aprovar: quem pede não aprova.');
  }
  const [a] = await db.insert(A).values({ organizationId: ctx.organizationId, clientId: t.clientId ?? null, resourceType: 'task', resourceId: taskId, requestedBy: ctx.userId, approverId: input.approverId ?? null }).returning({ id: A.id });
  await recordActivity(tx(), ctx, { entityType: 'task', entityId: taskId, taskId, action: 'approval_requested', data: { approvalId: a!.id, approverId: input.approverId ?? null, userIds: input.approverId ? [input.approverId] : [], note: input.note?.trim() || null } });
  // Sem aprovador escolhido, o aviso vai para quem administra a empresa (menos quem pediu).
  const destinatarios = input.approverId ? [input.approverId] : (await db.select({ userId: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), inArray(schema.organizationMembers.role, ['owner', 'admin'])))).map((m) => m.userId);
  await avisar(destinatarios, ctx, 'work.approval_requested', `Aprovação pedida: DT-${t.number} ${t.title}`, taskId);
  return { id: a!.id, created: true };
}

/** Rastro na tarefa + aviso a quem pediu. Chamado pelos dois caminhos de resolução (aqui e pela tela de Aprovações). */
export async function registrarResolucao(ctx: WorkContext, a: { id: string; resourceId: string; requestedBy: string; status: string; comment: string | null }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.resourceId)) return; // tarefa de outro sistema (ClickUp): não é nossa
  const [t] = await db.select({ id: schema.workTasks.id, number: schema.workTasks.number, title: schema.workTasks.title }).from(schema.workTasks).where(and(eq(schema.workTasks.id, a.resourceId), eq(schema.workTasks.organizationId, ctx.organizationId)));
  if (!t) return;
  await recordActivity(tx(), ctx, { entityType: 'task', entityId: t.id, taskId: t.id, action: 'approval_resolved', data: { approvalId: a.id, status: a.status, userIds: [a.requestedBy], comment: a.comment } });
  const [quem] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ctx.userId));
  await avisar([a.requestedBy], ctx, 'work.approval_resolved', `${quem?.name ?? 'Alguém'} ${ROTULO[a.status as Resolucao] ?? 'respondeu a aprovação de'} DT-${t.number} ${t.title}`, t.id);
}

export async function resolveTaskApproval(ctx: WorkContext, approvalId: string, input: { status: Resolucao; comment?: string | null }) {
  const A = schema.approvalRequests;
  const [alvo] = await db.select().from(A).where(and(eq(A.id, approvalId), eq(A.organizationId, ctx.organizationId), eq(A.resourceType, 'task')));
  if (!alvo) throw notFound('Aprovação');
  if (alvo.requestedBy === ctx.userId) throw invalid('Quem pediu a aprovação não pode respondê-la.');
  if (alvo.approverId && alvo.approverId !== ctx.userId) throw invalid('Esta aprovação foi pedida a outra pessoa.');
  const comment = input.comment?.trim() || null;
  if (input.status !== 'approved' && !comment) throw invalid('Explique o motivo para reprovar ou pedir ajustes.');
  // Reivindicação atômica: só quem chega primeiro resolve (mesmo padrão do módulo Aprovações).
  const r = await db.update(A).set({ status: input.status, approverId: ctx.userId, comment, resolvedAt: sql`now()` }).where(and(eq(A.id, approvalId), eq(A.status, 'pending'))).returning();
  if (!r.length) throw invalid('Esta aprovação já foi respondida.');
  await registrarResolucao(ctx, r[0]!);
  return { ok: true, status: input.status };
}
