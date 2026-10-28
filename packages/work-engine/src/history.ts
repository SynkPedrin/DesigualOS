import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';
import { getTask } from './tasks';

export interface HistoryItem {
  id: string;
  createdAt: string;
  action: string;
  actorName: string;
  actorAvatar: string | null;
  actorKind: string;
  /** Frase pronta em português, com nomes (não ids). */
  texto: string;
}

const PRIORIDADE = ['sem prioridade', 'urgente', 'alta', 'normal', 'baixa'];
const dia = (v: unknown) => (typeof v === 'string' && v ? new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' }) : 'sem data');
const uuidLike = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Linha do tempo da tarefa: quem fez o quê e quando, com os ids já trocados por nomes. */
export async function getTaskHistory(ctx: WorkContext, taskId: string, limit = 200): Promise<HistoryItem[]> {
  await getTask(ctx, taskId);
  const E = schema.workActivityEvents;
  const eventos = await db.select().from(E).where(and(eq(E.organizationId, ctx.organizationId), eq(E.taskId, taskId))).orderBy(desc(E.createdAt)).limit(Math.min(limit, 500));
  const userIds = new Set<string>(); const statusIds = new Set<string>(); const listIds = new Set<string>(); const clientIds = new Set<string>();
  for (const e of eventos) {
    if (e.actorId) userIds.add(e.actorId);
    const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const u of (d.userIds as unknown[] | undefined) ?? []) if (uuidLike(u)) userIds.add(u);
    if (uuidLike(d.userId)) userIds.add(d.userId);
    if (uuidLike(d.from)) statusIds.add(d.from);
    if (uuidLike(d.to)) statusIds.add(d.to);
    for (const k of ['fromList', 'toList']) if (uuidLike(d[k])) listIds.add(d[k]);
    for (const v of [d.changes?.clientId?.from, d.changes?.clientId?.to]) if (uuidLike(v)) clientIds.add(v);
  }
  const [us, ss, ls, cs] = await Promise.all([
    userIds.size ? db.select({ id: schema.users.id, name: schema.users.name, avatar: schema.users.avatarUrl }).from(schema.users).where(inArray(schema.users.id, [...userIds])) : [],
    statusIds.size ? db.select({ id: schema.workTaskStatuses.id, name: schema.workTaskStatuses.name }).from(schema.workTaskStatuses).where(and(eq(schema.workTaskStatuses.organizationId, ctx.organizationId), inArray(schema.workTaskStatuses.id, [...statusIds]))) : [],
    listIds.size ? db.select({ id: schema.workLists.id, name: schema.workLists.name }).from(schema.workLists).where(and(eq(schema.workLists.organizationId, ctx.organizationId), inArray(schema.workLists.id, [...listIds]))) : [],
    clientIds.size ? db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(and(eq(schema.clients.organizationId, ctx.organizationId), inArray(schema.clients.id, [...clientIds]))) : [],
  ]);
  const U = new Map(us.map((u) => [u.id, u])); const S = new Map(ss.map((s) => [s.id, s.name])); const L = new Map(ls.map((l) => [l.id, l.name])); const C = new Map(cs.map((c) => [c.id, c.name]));
  const nomes = (ids: unknown) => ((ids as unknown[] | undefined) ?? []).map((i) => (typeof i === 'string' ? U.get(i)?.name ?? 'alguém' : 'alguém')).join(', ');

  return eventos.map((e) => {
    const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const frases: string[] = [];
    switch (e.action) {
      case 'created': frases.push('criou a tarefa'); break;
      case 'imported': frases.push('trouxe a tarefa do ClickUp'); break;
      case 'assigned': frases.push(`atribuiu a tarefa a ${nomes(d.userIds)}`); break;
      case 'unassigned': frases.push(`tirou ${nomes(d.userIds)} da tarefa`); break;
      case 'status_changed': frases.push(`mudou o status de “${S.get(d.from) ?? '?'}” para “${S.get(d.to) ?? '?'}”`); break;
      case 'moved': frases.push(`moveu a tarefa de “${L.get(d.fromList) ?? '?'}” para “${L.get(d.toList) ?? '?'}”`); break;
      case 'commented': frases.push('comentou'); break;
      case 'mentioned': frases.push(`mencionou ${nomes([d.userId])}`); break;
      case 'archived': frases.push('arquivou a tarefa'); break;
      case 'restored': frases.push('restaurou a tarefa'); break;
      case 'timer_started': frases.push('iniciou o cronômetro'); break;
      case 'approval_requested': frases.push(`pediu aprovação${d.approverId ? ` a ${nomes([d.approverId])}` : ''}${d.note ? ` — “${d.note}”` : ''}`); break;
      case 'approval_resolved': frases.push(`${d.status === 'approved' ? 'aprovou' : d.status === 'rejected' ? 'reprovou' : 'pediu ajustes'}${d.comment ? ` — “${d.comment}”` : ''}`); break;
      case 'followed': frases.push('passou a seguir a tarefa'); break;
      case 'unfollowed': frases.push('deixou de seguir a tarefa'); break;
      case 'updated': {
        const ch = (d.changes ?? {}) as Record<string, { from: any; to: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const [campo, v] of Object.entries(ch)) {
          if (campo === 'title') frases.push(`renomeou a tarefa de “${v.from}” para “${v.to}”`);
          else if (campo === 'description') frases.push('editou a descrição');
          else if (campo === 'priority') frases.push(`mudou a prioridade de ${PRIORIDADE[Number(v.from)] ?? '?'} para ${PRIORIDADE[Number(v.to)] ?? '?'}`);
          else if (campo === 'dueAt') frases.push(`mudou o prazo de ${dia(v.from)} para ${dia(v.to)}`);
          else if (campo === 'startAt') frases.push(`mudou o início de ${dia(v.from)} para ${dia(v.to)}`);
          else if (campo === 'estimateMinutes') frases.push(`mudou a estimativa de ${v.from ?? '—'} para ${v.to ?? '—'} min`);
          else if (campo === 'tags') { const antes = new Set<string>(v.from ?? []); const depois = new Set<string>(v.to ?? []); const mais = [...depois].filter((t) => !antes.has(t)); const menos = [...antes].filter((t) => !depois.has(t)); frases.push(`alterou as tags${mais.length ? ` (+${mais.join(', +')})` : ''}${menos.length ? ` (−${menos.join(', −')})` : ''}`); }
          else if (campo === 'clientId') frases.push(`mudou o cliente de ${C.get(v.from) ?? 'nenhum'} para ${C.get(v.to) ?? 'nenhum'}`);
          else frases.push(`alterou ${campo}`);
        }
        if (frases.length === 0) frases.push('atualizou a tarefa');
        break;
      }
      default: frases.push(e.action);
    }
    const quem = e.actorKind === 'automation' ? 'Automação' : e.actorKind === 'agent' ? 'Agente' : e.actorKind === 'system' ? 'Sistema' : (e.actorId ? U.get(e.actorId)?.name : null) ?? 'Alguém';
    return { id: e.id, createdAt: e.createdAt.toISOString(), action: e.action, actorName: quem, actorAvatar: e.actorKind === 'user' && e.actorId ? (U.get(e.actorId)?.avatar ?? null) : null, actorKind: e.actorKind, texto: frases.join(' · ') };
  });
}
