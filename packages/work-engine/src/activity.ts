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
}
