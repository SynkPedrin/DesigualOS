import { and, desc, eq, gt, inArray, isNull, ne, notLike, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';

const RELEVANTES = ['commented', 'status_changed', 'assigned', 'updated', 'mentioned', 'completed'];

/**
 * Caixa de entrada: o que aconteceu nas tarefas da pessoa (responsável ou criadora) feito POR OUTRA pessoa,
 * mais as menções diretas a ela. Nada de dado de outra empresa: tudo filtra por organização.
 */
export async function listInbox(ctx: WorkContext, limit = 60) {
  const org = ctx.organizationId;
  const E = schema.workActivityEvents;
  const [estado] = await db.select().from(schema.workUserState).where(and(eq(schema.workUserState.organizationId, org), eq(schema.workUserState.userId, ctx.userId)));
  const lidoAte = estado?.inboxReadAt ?? null;
  const minhas = sql`(select t.id from work_tasks t where t.organization_id = ${org} and (t.created_by = ${ctx.userId} or exists (select 1 from work_task_assignees a where a.task_id = t.id and a.user_id = ${ctx.userId})))`;
  const rows = await db
    .select({ e: E, title: schema.workTasks.title, number: schema.workTasks.number, actorName: schema.users.name, actorAvatar: schema.users.avatarUrl })
    .from(E)
    .innerJoin(schema.workTasks, eq(schema.workTasks.id, E.taskId))
    .leftJoin(schema.users, eq(schema.users.id, E.actorId))
    .where(and(
      eq(E.organizationId, org),
      inArray(E.action, RELEVANTES),
      sql`(
        (${E.action} = 'mentioned' and ${E.data}->>'userId' = ${ctx.userId})
        or (${E.taskId} in ${minhas} and (${E.actorId} is null or ${E.actorId} <> ${ctx.userId}) and ${E.action} <> 'mentioned')
      )`,
    ))
    .orderBy(desc(E.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({
    id: r.e.id,
    taskId: r.e.taskId,
    taskKey: `DT-${r.number}`,
    taskTitle: r.title,
    action: r.e.action,
    actorName: r.e.actorKind === 'automation' ? 'Automação' : (r.actorName ?? 'Alguém'),
    actorAvatar: r.actorAvatar ?? null,
    data: r.e.data,
    createdAt: r.e.createdAt.toISOString(),
    unread: lidoAte === null || r.e.createdAt > lidoAte,
  }));
}

export async function markInboxRead(ctx: WorkContext) {
  await db.insert(schema.workUserState).values({ organizationId: ctx.organizationId, userId: ctx.userId, inboxReadAt: new Date() })
    .onConflictDoUpdate({ target: [schema.workUserState.organizationId, schema.workUserState.userId], set: { inboxReadAt: new Date() } });
  return { ok: true };
}

export async function inboxUnreadCount(ctx: WorkContext): Promise<number> {
  const u = (await listInboxUnified(ctx, 200)).unread;
  return u.task + u.communication + u.system;
}

export interface InboxEntry {
  id: string;
  kind: 'task' | 'communication' | 'system';
  /** Quem fez (ou o canal). */
  actorName: string;
  actorAvatar: string | null;
  /** Frase pronta: "comentou em", "mencionou você em"... */
  verb: string;
  /** O objeto: "DT-12 título", "#geral", "Notificação". */
  subject: string;
  snippet: string | null;
  link: string;
  taskId: string | null;
  mention: boolean;
  unread: boolean;
  createdAt: string;
}

const VERBOS: Record<string, string> = { mentioned: 'mencionou você em', commented: 'comentou em', status_changed: 'mudou o status de', assigned: 'atribuiu uma pessoa em', updated: 'atualizou', completed: 'concluiu' };

/**
 * CAIXA DE ENTRADA UNIFICADA: tarefas (o que outras pessoas fizeram nas suas), Comunicação (mensagens que você ainda
 * não leu e menções) e avisos do sistema (o sino). Tudo sempre da SUA empresa e das SUAS conversas.
 */
export interface AtribuidaAMim { taskId: string; key: string; title: string; dueAt: string | null; priority: number; statusName: string; statusColor: string | null; clientName: string | null; atribuidaEm: string | null }

/** Tudo que está aberto e é DA pessoa: o que vence primeiro vem antes; sem prazo por último. */
async function atribuidasAMim(ctx: WorkContext, limite = 60): Promise<AtribuidaAMim[]> {
  const T = schema.workTasks;
  const rows = await db.select({ t: T, status: schema.workTaskStatuses.name, cor: schema.workTaskStatuses.color, cliente: schema.clients.name })
    .from(T)
    .innerJoin(schema.workTaskAssignees, and(eq(schema.workTaskAssignees.taskId, T.id), eq(schema.workTaskAssignees.userId, ctx.userId)))
    .innerJoin(schema.workTaskStatuses, eq(schema.workTaskStatuses.id, T.statusId))
    .leftJoin(schema.clients, eq(schema.clients.id, T.clientId))
    .where(and(eq(T.organizationId, ctx.organizationId), isNull(T.completedAt), isNull(T.archivedAt)))
    .orderBy(sql`${T.dueAt} asc nulls last`, desc(T.updatedAt))
    .limit(limite);
  return rows.map((r) => ({ taskId: r.t.id, key: `DT-${r.t.number}`, title: r.t.title, dueAt: r.t.dueAt?.toISOString() ?? null, priority: r.t.priority, statusName: r.status, statusColor: r.cor ?? null, clientName: r.cliente ?? null, atribuidaEm: null }));
}

export async function listInboxUnified(ctx: WorkContext, limit = 80): Promise<{ items: InboxEntry[]; unread: { task: number; communication: number; system: number }; assigned: AtribuidaAMim[] }> {
  const org = ctx.organizationId;
  const [tarefas, com, sistema, atribuidas] = await Promise.all([
    listInbox(ctx, limit),
    db.select({
      m: schema.internalMessages, conv: schema.internalConversations, sender: schema.users.name, avatar: schema.users.avatarUrl,
      lastReadAt: schema.internalConversationMembers.lastReadAt, mutedAt: schema.internalConversationMembers.mutedAt,
    })
      .from(schema.internalMessages)
      .innerJoin(schema.internalConversationMembers, and(eq(schema.internalConversationMembers.conversationId, schema.internalMessages.conversationId), eq(schema.internalConversationMembers.userId, ctx.userId)))
      .innerJoin(schema.internalConversations, eq(schema.internalConversations.id, schema.internalMessages.conversationId))
      .innerJoin(schema.users, eq(schema.users.id, schema.internalMessages.senderId))
      .where(and(
        eq(schema.internalMessages.organizationId, org), ne(schema.internalMessages.senderId, ctx.userId), isNull(schema.internalMessages.deletedAt), eq(schema.internalMessages.kind, 'user'),
        isNull(schema.internalConversations.archivedAt),
        sql`${schema.internalMessages.createdAt} > now() - interval '14 days'`,
        or(isNull(schema.internalConversationMembers.lastReadAt), gt(schema.internalMessages.createdAt, schema.internalConversationMembers.lastReadAt)),
      ))
      .orderBy(desc(schema.internalMessages.createdAt)).limit(limit),
    db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, ctx.userId), notLike(schema.notifications.type, 'work.%'))).orderBy(desc(schema.notifications.createdAt)).limit(30),
    atribuidasAMim(ctx),
  ]);
  const items: InboxEntry[] = [
    ...tarefas.map((t): InboxEntry => ({ id: `t:${t.id}`, kind: 'task', actorName: t.actorName, actorAvatar: t.actorAvatar, verb: VERBOS[t.action] ?? 'atualizou', subject: `${t.taskKey} ${t.taskTitle}`, snippet: null, link: `/daily-tasks?task=${t.taskId}`, taskId: t.taskId, mention: t.action === 'mentioned', unread: t.unread, createdAt: t.createdAt })),
    ...com.filter((r) => !r.mutedAt || r.m.mentions.includes(ctx.userId)).map((r): InboxEntry => {
      const canal = r.conv.kind === 'direct' ? r.sender : r.conv.kind === 'general' ? '#geral' : `#${r.conv.title ?? 'conversa'}`;
      const mention = r.m.mentions.includes(ctx.userId);
      return { id: `c:${r.m.id}`, kind: 'communication', actorName: r.sender, actorAvatar: r.avatar ?? null, verb: mention ? 'mencionou você em' : r.conv.kind === 'direct' ? 'enviou mensagem' : 'escreveu em', subject: canal, snippet: (r.m.content ?? '').slice(0, 160) || null, link: `/comunicacao?c=${r.conv.id}&m=${r.m.id}`, taskId: null, mention, unread: true, createdAt: r.m.createdAt.toISOString() };
    }),
    ...sistema.map((n): InboxEntry => ({ id: `s:${n.id}`, kind: 'system', actorName: 'Sistema', actorAvatar: null, verb: '', subject: n.title, snippet: n.body, link: n.link ?? '/', taskId: null, mention: false, unread: n.readAt === null, createdAt: n.createdAt.toISOString() })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  const conta = (k: InboxEntry['kind']) => items.filter((i) => i.kind === k && i.unread).length;
  return { items, unread: { task: conta('task'), communication: conta('communication'), system: conta('system') }, assigned: atribuidas };
}

/** Marca como lido o que é DESTA tela (tarefas e avisos). Conversas só leem na própria Comunicação, onde a leitura é real. */
export async function markInboxReadAll(ctx: WorkContext) {
  await markInboxRead(ctx);
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, ctx.userId), isNull(schema.notifications.readAt)));
  return { ok: true };
}
