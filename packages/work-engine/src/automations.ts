import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { addComment } from './collab';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';
import { createTask, getTask, updateTask, type WorkTask } from './tasks';

/**
 * MOTOR DE AUTOMAÇÕES — QUANDO (gatilho) + SE (condições) + ENTÃO (ações).
 *
 * Como roda: lê a trilha `work_activity_events` a partir de um cursor por empresa (nasce em "agora": não
 * reexecuta o passado). Eventos feitos por uma AUTOMAÇÃO não disparam outras (sem encadeamento, logo sem
 * laço). Cada tentativa vira uma linha em `work_automation_runs` (ok / failed / skipped). Falha numa ação
 * nunca derruba o motor nem as outras automações.
 */

export const TRIGGERS = ['task_created', 'status_changed', 'assigned', 'priority_changed', 'comment_added', 'task_completed', 'due_date_passed'] as const;
export const ACTIONS = ['set_status', 'set_priority', 'assign', 'unassign', 'set_due_in_days', 'add_comment', 'add_tag', 'create_subtask'] as const;
const CAMPOS = ['priority', 'statusId', 'listId', 'assignee', 'tag', 'clientId'] as const;
const OPS = ['eq', 'neq', 'in', 'contains'] as const;

export interface AutomationInput {
  name: string;
  enabled?: boolean;
  spaceId?: string | null;
  listId?: string | null;
  trigger: { type: string; config?: Record<string, unknown> };
  conditions?: Array<{ field: string; op: string; value?: unknown }>;
  actions: Array<{ type: string; config?: Record<string, unknown> }>;
}

function validar(i: AutomationInput) {
  if (!i.name.trim()) throw invalid('Dê um nome à automação.');
  if (!(TRIGGERS as readonly string[]).includes(i.trigger.type)) throw invalid(`Gatilho inválido. Use: ${TRIGGERS.join(', ')}.`);
  if (!i.actions.length) throw invalid('Inclua ao menos uma ação.');
  if (i.actions.length > 10) throw invalid('No máximo 10 ações por automação.');
  for (const a of i.actions) if (!(ACTIONS as readonly string[]).includes(a.type)) throw invalid(`Ação inválida: ${a.type}.`);
  for (const c of i.conditions ?? []) {
    if (!(CAMPOS as readonly string[]).includes(c.field)) throw invalid(`Condição inválida: campo ${c.field}.`);
    if (!(OPS as readonly string[]).includes(c.op)) throw invalid(`Condição inválida: operador ${c.op}.`);
  }
}

export async function listAutomations(ctx: WorkContext) {
  return db.select().from(schema.workAutomations).where(eq(schema.workAutomations.organizationId, ctx.organizationId)).orderBy(desc(schema.workAutomations.createdAt));
}

export async function createAutomation(ctx: WorkContext, input: AutomationInput) {
  validar(input);
  if (input.listId) {
    const [l] = await db.select({ spaceId: schema.workLists.spaceId }).from(schema.workLists).where(and(eq(schema.workLists.id, input.listId), eq(schema.workLists.organizationId, ctx.organizationId)));
    if (!l) throw notFound('Lista');
  }
  if (input.spaceId) {
    const [s] = await db.select({ id: schema.workSpaces.id }).from(schema.workSpaces).where(and(eq(schema.workSpaces.id, input.spaceId), eq(schema.workSpaces.organizationId, ctx.organizationId)));
    if (!s) throw notFound('Espaço');
  }
  const [a] = await db.insert(schema.workAutomations).values({ organizationId: ctx.organizationId, spaceId: input.spaceId ?? null, listId: input.listId ?? null, name: input.name.trim(), enabled: input.enabled ?? true, trigger: input.trigger, conditions: input.conditions ?? [], actions: input.actions, createdBy: ctx.userId }).returning();
  return a!;
}

export async function updateAutomation(ctx: WorkContext, id: string, patch: Partial<AutomationInput>) {
  const [cur] = await db.select().from(schema.workAutomations).where(and(eq(schema.workAutomations.id, id), eq(schema.workAutomations.organizationId, ctx.organizationId)));
  if (!cur) throw notFound('Automação');
  const merged: AutomationInput = { name: patch.name ?? cur.name, trigger: patch.trigger ?? cur.trigger, conditions: patch.conditions ?? cur.conditions, actions: patch.actions ?? cur.actions };
  validar(merged);
  const [a] = await db.update(schema.workAutomations).set({ name: merged.name.trim(), trigger: merged.trigger, conditions: merged.conditions ?? [], actions: merged.actions, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}) }).where(eq(schema.workAutomations.id, id)).returning();
  return a!;
}

export async function deleteAutomation(ctx: WorkContext, id: string) {
  const r = await db.delete(schema.workAutomations).where(and(eq(schema.workAutomations.id, id), eq(schema.workAutomations.organizationId, ctx.organizationId))).returning({ id: schema.workAutomations.id });
  if (!r.length) throw notFound('Automação');
  return { ok: true };
}

export async function listAutomationRuns(ctx: WorkContext, automationId: string, limit = 50) {
  const [a] = await db.select({ id: schema.workAutomations.id }).from(schema.workAutomations).where(and(eq(schema.workAutomations.id, automationId), eq(schema.workAutomations.organizationId, ctx.organizationId)));
  if (!a) throw notFound('Automação');
  return db.select().from(schema.workAutomationRuns).where(and(eq(schema.workAutomationRuns.organizationId, ctx.organizationId), eq(schema.workAutomationRuns.automationId, automationId))).orderBy(desc(schema.workAutomationRuns.createdAt)).limit(Math.min(limit, 200));
}

type Automation = typeof schema.workAutomations.$inferSelect;

function condicaoOk(c: { field: string; op: string; value?: unknown }, t: WorkTask): boolean {
  const atual: unknown = c.field === 'priority' ? t.priority : c.field === 'statusId' ? t.statusId : c.field === 'listId' ? t.listId : c.field === 'clientId' ? t.clientId : c.field === 'assignee' ? t.assigneeIds : t.tags;
  const alvo = c.value;
  const contem = (v: unknown) => (Array.isArray(atual) ? atual.includes(v) : atual === v);
  if (c.op === 'eq') return contem(alvo);
  if (c.op === 'neq') return !contem(alvo);
  if (c.op === 'in') return Array.isArray(alvo) && alvo.some((v) => contem(v));
  if (c.op === 'contains') return Array.isArray(atual) && atual.includes(alvo);
  return false;
}

async function executarAcao(ctx: WorkContext, a: { type: string; config?: Record<string, unknown> }, t: WorkTask): Promise<string> {
  const c = a.config ?? {};
  switch (a.type) {
    case 'set_status': await updateTask(ctx, t.id, { statusId: String(c.statusId) }); return 'status alterado';
    case 'set_priority': await updateTask(ctx, t.id, { priority: Number(c.priority) }); return 'prioridade alterada';
    case 'assign': { const cur = await getTask(ctx, t.id); await updateTask(ctx, t.id, { assigneeIds: [...new Set([...cur.assigneeIds, String(c.userId)])] }); return 'responsável adicionado'; }
    case 'unassign': { const cur = await getTask(ctx, t.id); await updateTask(ctx, t.id, { assigneeIds: cur.assigneeIds.filter((u) => u !== String(c.userId)) }); return 'responsável removido'; }
    case 'set_due_in_days': await updateTask(ctx, t.id, { dueAt: new Date(Date.now() + Number(c.days ?? 0) * 86_400_000) }); return 'prazo definido';
    case 'add_comment': await addComment(ctx, t.id, String(c.text ?? '')); return 'comentário adicionado';
    case 'add_tag': { const cur = await getTask(ctx, t.id); await updateTask(ctx, t.id, { tags: [...new Set([...cur.tags, String(c.tag)])] }); return 'tag adicionada'; }
    case 'create_subtask': await createTask(ctx, { listId: t.listId, title: String(c.title ?? 'Subtarefa'), parentTaskId: t.id }); return 'subtarefa criada';
    default: throw invalid(`Ação desconhecida: ${a.type}`);
  }
}

/** Roda UMA automação para UMA tarefa e registra o resultado. Nunca lança. */
export async function runAutomation(a: Automation, taskId: string, why: Record<string, unknown>): Promise<'ok' | 'failed' | 'skipped'> {
  const owner = a.createdBy;
  const org = a.organizationId;
  const registrar = async (status: string, detail: Record<string, unknown>) => {
    await db.insert(schema.workAutomationRuns).values({ organizationId: org, automationId: a.id, taskId, status, detail: { ...why, ...detail } });
    if (status !== 'skipped') await db.update(schema.workAutomations).set({ runCount: sql`${schema.workAutomations.runCount} + 1`, lastRunAt: new Date() }).where(eq(schema.workAutomations.id, a.id));
  };
  try {
    if (!owner) { await registrar('failed', { erro: 'Automação sem dono ativo.' }); return 'failed'; }
    const ctx: WorkContext = { organizationId: org, userId: owner, actorKind: 'automation' };
    const t = await getTask(ctx, taskId);
    if (!a.conditions.every((c) => condicaoOk(c, t))) { await registrar('skipped', { motivo: 'condições não bateram' }); return 'skipped'; }
    const feitos: string[] = [];
    for (const ac of a.actions) feitos.push(await executarAcao(ctx, ac, t));
    await registrar('ok', { acoes: feitos });
    return 'ok';
  } catch (e) {
    await registrar('failed', { erro: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
    return 'failed';
  }
}

function gatilhoDoEvento(e: typeof schema.workActivityEvents.$inferSelect, finalIds: Set<string>): string[] {
  const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (e.action === 'created' && e.entityType === 'task') return ['task_created'];
  if (e.action === 'commented') return ['comment_added'];
  if (e.action === 'assigned') return ['assigned'];
  if (e.action === 'status_changed') return finalIds.has(String(d.to)) ? ['status_changed', 'task_completed'] : ['status_changed'];
  if (e.action === 'updated' && d.changes?.priority) return ['priority_changed'];
  return [];
}

/** Processa eventos novos de UMA empresa. Devolve quantas execuções fez. */
export async function processAutomationEvents(organizationId: string, batch = 200): Promise<number> {
  const autos = await db.select().from(schema.workAutomations).where(and(eq(schema.workAutomations.organizationId, organizationId), eq(schema.workAutomations.enabled, true)));
  const E = schema.workActivityEvents;
  const [cur] = await db.select().from(schema.workAutomationCursor).where(eq(schema.workAutomationCursor.organizationId, organizationId));
  if (!cur) {
    await db.insert(schema.workAutomationCursor).values({ organizationId }).onConflictDoNothing();
    return 0; // primeira vez: começa de agora, não reexecuta o passado
  }
  // Posição = (created_at, id) do último evento lido, comparada NO BANCO: o JS só guarda milissegundos e o
  // Postgres microssegundos — comparar por Date relia o último evento (execução em dobro).
  const depois = cur.lastEventId
    ? sql`(${E.createdAt}, ${E.id}) > (select created_at, id from work_activity_events where id = ${cur.lastEventId})`
    : gt(E.createdAt, cur.lastEventAt);
  const novos = await db.select().from(E).where(and(eq(E.organizationId, organizationId), depois, lt(E.createdAt, new Date(Date.now() - 1000)))).orderBy(asc(E.createdAt), asc(E.id)).limit(batch);
  if (!novos.length) return 0;
  let execucoes = 0;
  if (autos.length) {
    const finais = new Set((await db.select({ id: schema.workTaskStatuses.id }).from(schema.workTaskStatuses).where(and(eq(schema.workTaskStatuses.organizationId, organizationId), eq(schema.workTaskStatuses.isFinal, true)))).map((r) => r.id));
    for (const e of novos) {
      if (e.actorKind === 'automation' || !e.taskId) continue;
      const gatilhos = gatilhoDoEvento(e, finais);
      if (!gatilhos.length) continue;
      const [task] = await db.select({ listId: schema.workTasks.listId }).from(schema.workTasks).where(eq(schema.workTasks.id, e.taskId));
      if (!task) continue;
      const [lista] = await db.select({ spaceId: schema.workLists.spaceId }).from(schema.workLists).where(eq(schema.workLists.id, task.listId));
      const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const a of autos) {
        if (!gatilhos.includes(a.trigger.type)) continue;
        if (a.listId && a.listId !== task.listId) continue;
        if (a.spaceId && a.spaceId !== lista?.spaceId) continue;
        const cfg = a.trigger.config ?? {};
        if (a.trigger.type === 'status_changed' && cfg.toStatusId && cfg.toStatusId !== d.to) continue;
        if (a.trigger.type === 'assigned' && cfg.userId && !(d.userIds ?? []).includes(cfg.userId)) continue;
        await runAutomation(a, e.taskId, { evento: e.action, eventoId: e.id });
        execucoes++;
      }
    }
  }
  const ultimo = novos[novos.length - 1]!;
  await db.update(schema.workAutomationCursor).set({ lastEventAt: ultimo.createdAt, lastEventId: ultimo.id }).where(eq(schema.workAutomationCursor.organizationId, organizationId));
  return execucoes;
}

/** Gatilho por tempo: tarefa aberta cujo prazo passou dispara UMA vez por automação. */
export async function processOverdueTriggers(organizationId: string): Promise<number> {
  const autos = (await db.select().from(schema.workAutomations).where(and(eq(schema.workAutomations.organizationId, organizationId), eq(schema.workAutomations.enabled, true)))).filter((a) => a.trigger.type === 'due_date_passed');
  let n = 0;
  for (const a of autos) {
    const T = schema.workTasks;
    const venc = await db.select({ id: T.id }).from(T)
      .innerJoin(schema.workLists, eq(schema.workLists.id, T.listId))
      .where(and(eq(T.organizationId, organizationId), isNull(T.archivedAt), isNull(T.completedAt), lt(T.dueAt, new Date()),
        a.listId ? eq(T.listId, a.listId) : undefined, a.spaceId ? eq(schema.workLists.spaceId, a.spaceId) : undefined,
        sql`not exists (select 1 from work_automation_runs r where r.automation_id = ${a.id} and r.task_id = ${T.id})`))
      .limit(100);
    for (const t of venc) { await runAutomation(a, t.id, { evento: 'due_date_passed' }); n++; }
  }
  return n;
}

/** Um ciclo do motor para todas as empresas com automação ligada. Protegido por lock: só uma instância roda por vez. */
export async function automationTick(): Promise<{ eventos: number; atrasos: number }> {
  // Lock de TRANSAÇÃO (some sozinho no commit/rollback — o de sessão vazaria numa conexão do pool).
  return db.transaction(async (tx) => {
    const [lock] = (await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended('work-automation-tick', 0)) as ok`)) as unknown as Array<{ ok: boolean }>;
    if (!lock?.ok) return { eventos: 0, atrasos: 0 };
    const orgs = await tx.selectDistinct({ id: schema.workAutomations.organizationId }).from(schema.workAutomations).where(eq(schema.workAutomations.enabled, true));
    let eventos = 0; let atrasos = 0;
    for (const o of orgs) { eventos += await processAutomationEvents(o.id); atrasos += await processOverdueTriggers(o.id); }
    return { eventos, atrasos };
  });
}

void inArray; void or;
