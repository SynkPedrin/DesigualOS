import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';

/**
 * Atualiza do ClickUp o que mudou DEPOIS da importação: status, conclusão e prazo de tarefas já importadas.
 * A equipe continua trabalhando no ClickUp enquanto o Daily não é a fonte única, então o Daily envelhece sozinho
 * (tarefa fechada lá continua aberta aqui, e vice-versa).
 *
 * Regras que protegem o trabalho feito no Daily:
 *  - tarefa que ALGUÉM mexeu no Daily depois de `desde` NÃO é tocada: vai para `conflitos` para decisão humana;
 *  - status só troca por nome IGUAL já existente no espaço (nunca inventa status);
 *  - a data de conclusão existente é mantida (pronto → encerrado não "reconclui");
 *  - não envia aviso para ninguém: é sincronização, não atividade (o rastro fica na trilha como `clickup_sync`).
 */
export interface ItemDoClickUp { id: string; status: string | null; type: string | null; closed: string | null; updated: string | null; due: string | null }
export interface RelatorioDeSincronizacao {
  dryRun: boolean; examinadas: number; semCorrespondente: number; semMudanca: number; atualizadas: number;
  porMudanca: { status: number; conclusao: number; prazo: number };
  conflitos: Array<{ taskId: string; clickupId: string; motivo: string }>;
  statusSemEquivalente: Array<{ clickupId: string; status: string; espaco: string }>;
  exemplos: Array<{ clickupId: string; titulo: string; de: string; para: string }>;
}

const ms = (v: string | null): Date | null => { const n = Number(v); return v && Number.isFinite(n) && n > 0 ? new Date(n) : null; };

export async function sincronizarDoClickUp(ctx: WorkContext, itens: ItemDoClickUp[], opts: { dryRun?: boolean; desde?: Date } = {}): Promise<RelatorioDeSincronizacao> {
  const org = ctx.organizationId; const desde = opts.desde ?? new Date('2026-10-22T12:00:00Z');
  const rel: RelatorioDeSincronizacao = { dryRun: opts.dryRun ?? true, examinadas: itens.length, semCorrespondente: 0, semMudanca: 0, atualizadas: 0, porMudanca: { status: 0, conclusao: 0, prazo: 0 }, conflitos: [], statusSemEquivalente: [], exemplos: [] };
  const maps = await db.select({ ext: schema.workExternalMappings.externalId, id: schema.workExternalMappings.entityId }).from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, org), eq(schema.workExternalMappings.provider, 'clickup'), eq(schema.workExternalMappings.externalType, 'task')));
  const dailyId = new Map(maps.map((m) => [m.ext, m.id]));
  const T = schema.workTasks;
  const alvos = itens.filter((i) => dailyId.has(i.id));
  rel.semCorrespondente = itens.length - alvos.length;

  const ids = alvos.map((i) => dailyId.get(i.id)!);
  const tarefas = new Map<string, { id: string; title: string; statusId: string; dueAt: Date | null; completedAt: Date | null; version: number; listId: string }>();
  for (let i = 0; i < ids.length; i += 1000) for (const t of await db.select({ id: T.id, title: T.title, statusId: T.statusId, dueAt: T.dueAt, completedAt: T.completedAt, version: T.version, listId: T.listId }).from(T).where(and(eq(T.organizationId, org), inArray(T.id, ids.slice(i, i + 1000))))) tarefas.set(t.id, t);
  const listas = await db.select({ id: schema.workLists.id, spaceId: schema.workLists.spaceId, space: schema.workSpaces.name }).from(schema.workLists).innerJoin(schema.workSpaces, eq(schema.workSpaces.id, schema.workLists.spaceId)).where(eq(schema.workLists.organizationId, org));
  const espaco = new Map(listas.map((l) => [l.id, l]));
  const sts = await db.select().from(schema.workTaskStatuses).where(eq(schema.workTaskStatuses.organizationId, org));
  const porNome = new Map(sts.map((s) => [`${s.spaceId}:${s.name.trim().toLowerCase()}`, s]));
  const stPorId = new Map(sts.map((s) => [s.id, s]));
  const mexidas = new Set((await db.select({ t: schema.workActivityEvents.taskId }).from(schema.workActivityEvents).where(and(eq(schema.workActivityEvents.organizationId, org), eq(schema.workActivityEvents.actorKind, 'user'), sql`${schema.workActivityEvents.createdAt} > ${desde.toISOString()}::timestamptz`, inArray(schema.workActivityEvents.action, ['status_changed', 'updated', 'assigned', 'unassigned']))).groupBy(schema.workActivityEvents.taskId)).map((r) => r.t).filter((x): x is string => Boolean(x)));

  for (const it of alvos) {
    const tid = dailyId.get(it.id)!; const t = tarefas.get(tid);
    if (!t) { rel.semCorrespondente += 1; continue; }
    const lista = espaco.get(t.listId); const atual = stPorId.get(t.statusId)!;
    const set: Partial<typeof T.$inferInsert> = {}; const mud: string[] = []; const campos: Record<string, { from: unknown; to: unknown }> = {};
    let statusAlvo = atual;
    if (it.status && it.status.trim().toLowerCase() !== atual.name.trim().toLowerCase()) {
      const eq2 = lista ? porNome.get(`${lista.spaceId}:${it.status.trim().toLowerCase()}`) : undefined;
      if (!eq2) { rel.statusSemEquivalente.push({ clickupId: it.id, status: it.status, espaco: lista?.space ?? '?' }); }
      else { statusAlvo = eq2; set.statusId = eq2.id; mud.push('status'); rel.porMudanca.status += 1; }
    }
    const final = statusAlvo.isFinal;
    if (final && !t.completedAt) { set.completedAt = ms(it.closed) ?? ms(it.updated) ?? new Date(); mud.push('conclusao'); rel.porMudanca.conclusao += 1; }
    if (!final && t.completedAt) { set.completedAt = null; mud.push('conclusao'); rel.porMudanca.conclusao += 1; }
    const due = ms(it.due);
    if ((due?.getTime() ?? null) !== (t.dueAt?.getTime() ?? null)) { set.dueAt = due; campos.dueAt = { from: t.dueAt?.toISOString() ?? null, to: due?.toISOString() ?? null }; mud.push('prazo'); rel.porMudanca.prazo += 1; }
    if (!mud.length) { rel.semMudanca += 1; continue; }
    if (mexidas.has(tid)) { rel.conflitos.push({ taskId: tid, clickupId: it.id, motivo: `mexida no Daily depois da importação (${mud.join(', ')} divergem do ClickUp)` }); continue; }
    if (rel.exemplos.length < 12) rel.exemplos.push({ clickupId: it.id, titulo: t.title.slice(0, 60), de: `${atual.name}${t.completedAt ? ' ✓' : ''}`, para: `${statusAlvo.name}${set.completedAt === null ? '' : final ? ' ✓' : ''}` });
    rel.atualizadas += 1;
    if (rel.dryRun) continue;
    await db.transaction(async (tx) => {
      await tx.update(T).set({ ...set, version: t.version + 1, updatedAt: new Date() }).where(and(eq(T.id, tid), eq(T.organizationId, org)));
      if (set.statusId) await tx.insert(schema.workActivityEvents).values({ organizationId: org, entityType: 'task', entityId: tid, taskId: tid, action: 'status_changed', actorId: ctx.userId, actorKind: 'system', data: { from: t.statusId, to: set.statusId, source: 'clickup_sync' } });
      if (campos.dueAt) await tx.insert(schema.workActivityEvents).values({ organizationId: org, entityType: 'task', entityId: tid, taskId: tid, action: 'updated', actorId: ctx.userId, actorKind: 'system', data: { changes: campos, source: 'clickup_sync' } });
    });
  }
  return rel;
}
