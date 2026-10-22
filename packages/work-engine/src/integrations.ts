import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { addComment } from './collab';
import type { WorkContext } from './context';
import { invalid, notFound, WorkError } from './errors';
import { resolveDailyTasksAccess } from './access';
import { createTask, getTask, listTasks, updateTask, type TaskFilter } from './tasks';

/**
 * INTEGRAÇÕES. Uma tarefa pode nascer de outra parte do sistema (mensagem da Comunicação, alerta de Mídia,
 * pedido de um agente). O vínculo mora em `work_external_mappings`; o mesmo par (origem, id) devolve SEMPRE
 * a mesma tarefa — clicar duas vezes em "criar tarefa" nunca cria duas.
 */
const ORIGENS = ['communication', 'media', 'agent', 'client'] as const;

export async function createTaskFromSource(
  ctx: WorkContext,
  src: { provider: string; externalType: string; externalId: string; listId: string; title: string; description?: string | null; clientId?: string | null; priority?: number; assigneeIds?: string[]; dueAt?: Date | null; meta?: Record<string, unknown> },
) {
  if (!(ORIGENS as readonly string[]).includes(src.provider)) throw invalid(`Origem inválida. Use: ${ORIGENS.join(', ')}.`);
  if (!src.externalId.trim() || src.externalId.length > 200) throw invalid('Identificador de origem inválido.');
  // SEM transação longa: com o pool pequeno de produção, segurar uma conexão enquanto `createTask` pede outra
  // trava tudo. A unicidade vem do banco: quem perde a corrida apaga a própria cópia e devolve a vencedora.
  const chave = and(
    eq(schema.workExternalMappings.organizationId, ctx.organizationId), eq(schema.workExternalMappings.provider, src.provider),
    eq(schema.workExternalMappings.externalType, src.externalType), eq(schema.workExternalMappings.externalId, src.externalId));
  const [ja] = await db.select().from(schema.workExternalMappings).where(chave);
  if (ja) return { task: await getTask(ctx, ja.entityId), created: false };
  const task = await createTask(ctx, { listId: src.listId, title: src.title, description: src.description ?? null, clientId: src.clientId ?? null, ...(src.priority !== undefined ? { priority: src.priority } : {}), ...(src.assigneeIds ? { assigneeIds: src.assigneeIds } : {}), ...(src.dueAt !== undefined ? { dueAt: src.dueAt } : {}) });
  const gravou = await db.insert(schema.workExternalMappings)
    .values({ organizationId: ctx.organizationId, provider: src.provider, externalType: src.externalType, externalId: src.externalId, entityType: 'task', entityId: task.id, meta: src.meta ?? {} })
    .onConflictDoNothing().returning({ id: schema.workExternalMappings.id });
  if (gravou.length) return { task, created: true };
  await db.delete(schema.workTasks).where(and(eq(schema.workTasks.id, task.id), eq(schema.workTasks.organizationId, ctx.organizationId)));
  const [vencedora] = await db.select().from(schema.workExternalMappings).where(chave);
  return { task: await getTask(ctx, vencedora!.entityId), created: false };
}

export async function findTasksBySource(ctx: WorkContext, provider: string, externalType: string, externalId: string) {
  const rows = await db.select({ id: schema.workExternalMappings.entityId }).from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.organizationId, ctx.organizationId), eq(schema.workExternalMappings.provider, provider),
    eq(schema.workExternalMappings.externalType, externalType), eq(schema.workExternalMappings.externalId, externalId), eq(schema.workExternalMappings.entityType, 'task')));
  return Promise.all(rows.map((r) => getTask(ctx, r.id)));
}

/** Resumo de trabalho de um cliente (para a ficha do cliente e para agentes). */
export async function clientWorkSummary(ctx: WorkContext, clientId: string) {
  const T = schema.workTasks;
  const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, ctx.organizationId)));
  if (!c) throw notFound('Cliente');
  const [n] = await db.select({
    abertas: sql<number>`count(*) filter (where ${T.completedAt} is null)::int`,
    atrasadas: sql<number>`count(*) filter (where ${T.completedAt} is null and ${T.dueAt} < now())::int`,
    concluidas30d: sql<number>`count(*) filter (where ${T.completedAt} > now() - interval '30 days')::int`,
  }).from(T).where(and(eq(T.organizationId, ctx.organizationId), eq(T.clientId, clientId), isNull(T.archivedAt), isNull(T.parentTaskId)));
  const recentes = await listTasks(ctx, { clientId, completed: false, sort: 'due', limit: 10 });
  return { ...n!, proximas: recentes.rows.map((t) => ({ id: t.id, key: t.key, title: t.title, dueAt: t.dueAt, priority: t.priority })) };
}

/**
 * FERRAMENTAS DE AGENTE (Bento, Otto, Jarbas). Mesmas funções das telas, mesmo escopo da empresa, e o mesmo portão:
 * o agente age EM NOME de uma pessoa — se ela não tem acesso ao Daily Tasks, o agente também não tem.
 * Tudo que o agente grava entra na trilha com `actorKind = 'agent'`. Nada apaga: no máximo comenta, muda status ou cria.
 */
async function comoAgente(ctx: WorkContext, platformRoles: string[]): Promise<WorkContext> {
  const acesso = await resolveDailyTasksAccess({ organizationId: ctx.organizationId, userId: ctx.userId, platformRoles });
  if (!acesso.allowed) throw new WorkError('forbidden', 'O Daily Tasks não está liberado para esta pessoa; o agente também não pode usá-lo.');
  return { ...ctx, actorKind: 'agent' };
}

export const workTools = {
  async listTasks(ctx: WorkContext, platformRoles: string[], filter: Pick<TaskFilter, 'listId' | 'clientId' | 'assigneeId' | 'q' | 'completed'> & { limit?: number } = {}) {
    const a = await comoAgente(ctx, platformRoles);
    const r = await listTasks(a, { ...filter, limit: Math.min(filter.limit ?? 20, 50), sort: 'due' });
    return { total: r.total, tasks: r.rows.map((t) => ({ id: t.id, key: t.key, title: t.title, status: t.status?.name ?? null, priority: t.priority, dueAt: t.dueAt, assigneeIds: t.assigneeIds })) };
  },
  async createTask(ctx: WorkContext, platformRoles: string[], input: { listId: string; title: string; description?: string; priority?: number; clientId?: string }) {
    const a = await comoAgente(ctx, platformRoles);
    return createTask(a, input);
  },
  async changeStatus(ctx: WorkContext, platformRoles: string[], taskId: string, statusId: string) {
    const a = await comoAgente(ctx, platformRoles);
    return updateTask(a, taskId, { statusId });
  },
  async comment(ctx: WorkContext, platformRoles: string[], taskId: string, body: string) {
    const a = await comoAgente(ctx, platformRoles);
    return addComment(a, taskId, body);
  },
  async clientSummary(ctx: WorkContext, platformRoles: string[], clientId: string) {
    const a = await comoAgente(ctx, platformRoles);
    return clientWorkSummary(a, clientId);
  },
};

void desc;
