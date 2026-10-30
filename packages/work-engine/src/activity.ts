import { sql } from 'drizzle-orm';
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
  const d = (e.data ?? {}) as Record<string, unknown>;
  const explicitos = e.action === 'assigned' ? ((d.userIds as string[] | undefined) ?? []) : e.action === 'mentioned' ? (typeof d.userId === 'string' ? [d.userId] : []) : null;
  if (explicitos && !explicitos.length) return;
  const ctxActorUser = ctx.actorKind === 'automation' || ctx.actorKind === 'agent' ? null : ctx.userId;
  // Comentário e status: responsáveis, seguidores e criador da tarefa.
  const candidatos = explicitos
    ? sql`select unnest(array[${sql.join(explicitos.map((u) => sql`${u}::uuid`), sql`, `)}])`
    : sql`select user_id from work_task_assignees where task_id = t.id
          union select user_id from work_task_followers where task_id = t.id
          union select t.created_by where t.created_by is not null`;
  // Tarefa, nome do autor e destinatários numa ida só (eram seis consultas em série, ~1,5 s até o banco em us-east-1).
  // Só membros desta empresa recebem (um id estranho no dado nunca vira aviso em outra conta); o autor nunca recebe o próprio.
  const linhas = (await tx.execute(sql`
    select t.id, t.number, t.title,
      (select u.name from users u where u.id = ${ctx.userId}::uuid) as autor,
      coalesce((select json_agg(distinct m.user_id) from organization_members m
        where m.organization_id = ${ctx.organizationId}::uuid and m.user_id in (${candidatos})
          and m.user_id is distinct from ${ctxActorUser}::uuid), '[]'::json) as destinatarios
    from work_tasks t where t.id = ${e.taskId}::uuid and t.organization_id = ${ctx.organizationId}::uuid`)) as unknown as Array<{ id: string; number: number; title: string; autor: string | null; destinatarios: string[] }>;
  const t = linhas[0];
  if (!t || !t.destinatarios.length) return;
  const quem = ctx.actorKind === 'automation' ? 'Uma automação' : ctx.actorKind === 'agent' ? 'Um agente' : (t.autor ?? 'Alguém');
  const ref = `DT-${t.number} ${t.title}`;
  const titulo = e.action === 'assigned' ? `${quem} atribuiu você a ${ref}`
    : e.action === 'mentioned' ? `${quem} mencionou você em ${ref}`
    : e.action === 'commented' ? `${quem} comentou em ${ref}` : `${quem} mudou o status de ${ref}`;
  const link = `/daily-tasks?task=${t.id}`;
  await tx.insert(schema.notifications).values(t.destinatarios.map((userId) => ({ userId, type: `work.${e.action}`, title: titulo.slice(0, 240), body: null, link })));
}
