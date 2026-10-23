import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@desigual-os/database';
import type { Db, WorkContext } from './context';

export interface ActivityInput {
  entityType: string;
  entityId: string;
  taskId?: string | null;
  action: string;
  data?: Record<string, unknown>;
}

/**
 * Grava um evento na trilha. É a base do histórico da tarefa, da auditoria e (no incremento de
 * automações) do disparo de regras: tudo que muda passa por aqui, dentro da MESMA transação da
 * mudança, então não existe alteração sem rastro nem rastro sem alteração.
 */
export async function recordActivity(tx: Db, ctx: WorkContext, e: ActivityInput): Promise<void> {
  await tx.insert(schema.workActivityEvents).values({
    organizationId: ctx.organizationId,
    entityType: e.entityType,
    entityId: e.entityId,
    taskId: e.taskId ?? null,
    action: e.action,
    actorId: ctx.userId,
    actorKind: ctx.actorKind ?? 'user',
    data: e.data ?? {},
  });
  await notificarEvento(tx, ctx, e);
}

/** Quem recebe aviso de cada tipo de evento (o autor nunca recebe o próprio). */
const COM_AVISO = new Set(['assigned', 'mentioned', 'commented', 'status_changed']);

/**
 * Notificações: o mesmo evento da trilha vira aviso no sino do sistema (`notifications`), dentro da MESMA transação.
 * Só a pessoa certa recebe: atribuída → quem foi atribuída; menção → quem foi citada; comentário e mudança de status →
 * responsáveis e criador da tarefa. O link leva direto à tarefa (`/daily-tasks?task=<id>`).
 */
export async function notificarEvento(tx: Db, ctx: WorkContext, e: ActivityInput): Promise<void> {
  if (!COM_AVISO.has(e.action) || !e.taskId) return;
  const [t] = await tx.select({ id: schema.workTasks.id, number: schema.workTasks.number, title: schema.workTasks.title, createdBy: schema.workTasks.createdBy }).from(schema.workTasks).where(and(eq(schema.workTasks.id, e.taskId), eq(schema.workTasks.organizationId, ctx.organizationId)));
  if (!t) return;
  const [autor] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ctx.userId));
  const quem = ctx.actorKind === 'automation' ? 'Uma automação' : ctx.actorKind === 'agent' ? 'Um agente' : (autor?.name ?? 'Alguém');
  const link = `/daily-tasks?task=${t.id}`;
  const ref = `DT-${t.number} ${t.title}`;
  const d = (e.data ?? {}) as Record<string, unknown>;
  let alvo: string[] = [];
  let titulo = '';
  if (e.action === 'assigned') { alvo = (d.userIds as string[] | undefined) ?? []; titulo = `${quem} atribuiu você a ${ref}`; }
  else if (e.action === 'mentioned') { alvo = typeof d.userId === 'string' ? [d.userId] : []; titulo = `${quem} mencionou você em ${ref}`; }
  else {
    const resp = await tx.select({ userId: schema.workTaskAssignees.userId }).from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, t.id));
    const seg = await tx.select({ userId: schema.workTaskFollowers.userId }).from(schema.workTaskFollowers).where(eq(schema.workTaskFollowers.taskId, t.id));
    alvo = [...new Set([...resp.map((r) => r.userId), ...seg.map((r) => r.userId), ...(t.createdBy ? [t.createdBy] : [])])];
    titulo = e.action === 'commented' ? `${quem} comentou em ${ref}` : `${quem} mudou o status de ${ref}`;
  }
  const ctxActorUser = ctx.actorKind === 'automation' || ctx.actorKind === 'agent' ? null : ctx.userId;
  const destinatarios = [...new Set(alvo)].filter((u) => u !== ctxActorUser);
  if (!destinatarios.length) return;
  // Só membros desta empresa recebem (um id estranho no dado nunca vira aviso em outra conta).
  const membros = await tx.select({ userId: schema.organizationMembers.userId }).from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, ctx.organizationId), inArray(schema.organizationMembers.userId, destinatarios)));
  if (!membros.length) return;
  await tx.insert(schema.notifications).values(membros.map((m) => ({ userId: m.userId, type: `work.${e.action}`, title: titulo.slice(0, 240), body: null, link })));
}
