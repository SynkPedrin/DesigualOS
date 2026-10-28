import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

const PROVIDER = 'clickup';

/**
 * O LADO DO BANCO DA ESCRITA DE VOLTA (Daily → ClickUp). Quem fala com o ClickUp mora na API; aqui só há consulta e
 * gravação local. O desenho é o do motor de automações: a trilha `work_activity_events` já registra TODA mudança
 * (dentro da transação dela), então empurrar para o ClickUp é ler essa trilha a partir de um cursor durável. Não
 * existe caminho de escrita que escape: rota, lote, automação e o que vier depois passam por `recordActivity`.
 *
 * O cursor é uma linha de `work_external_mappings` (tipo `cursor`, id `saida`), por empresa: dispensa tabela nova.
 */

/** As ações da trilha que viram escrita no ClickUp. Mover, arquivar e o resto ficam só no Daily, de propósito. */
export const ACOES_DE_SAIDA = ['created', 'updated', 'status_changed', 'assigned', 'unassigned', 'commented'] as const;

export interface EventoDeSaida {
  id: string;
  createdAt: Date;
  action: string;
  taskId: string;
  actorId: string | null;
  actorKind: string;
  data: Record<string, unknown>;
}

const SEM_ID = '00000000-0000-0000-0000-000000000000';

type Posicao = { lastEventId: string | null; lastEventAt: string };

async function linhaDoCursor(organizationId: string) {
  const [linha] = await db
    .select()
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'cursor'), eq(schema.workExternalMappings.externalId, 'saida')))
    .limit(1);
  return linha ?? null;
}

/** Primeira vez numa empresa: começa de AGORA, nunca reenvia o passado (a carga inicial já veio do ClickUp). */
export async function iniciarCursorDaSaida(organizationId: string): Promise<void> {
  const meta: Posicao = { lastEventId: null, lastEventAt: new Date().toISOString() };
  await db
    .insert(schema.workExternalMappings)
    .values({ organizationId, provider: PROVIDER, externalType: 'cursor', externalId: 'saida', entityType: 'cursor', entityId: organizationId, meta })
    .onConflictDoNothing();
}

export async function cursorDaSaidaExiste(organizationId: string): Promise<boolean> {
  return (await linhaDoCursor(organizationId)) !== null;
}

export async function gravarCursorDaSaida(organizationId: string, evento: { id: string; createdAt: Date }): Promise<void> {
  const meta: Posicao = { lastEventId: evento.id, lastEventAt: evento.createdAt.toISOString() };
  await db
    .update(schema.workExternalMappings)
    .set({ meta, syncedAt: new Date() })
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'cursor'), eq(schema.workExternalMappings.externalId, 'saida')));
}

function depoisDoCursor(pos: Posicao | null) {
  const E = schema.workActivityEvents;
  if (!pos) return sql`true`;
  // Posição = (created_at, id) do último evento lido, comparada NO BANCO: o JS só guarda milissegundos e o Postgres
  // microssegundos; comparar por Date relia o último evento. Se o evento do cursor sumiu, cai para o instante dele.
  if (pos.lastEventId) {
    return sql`(${E.createdAt}, ${E.id}) > (
      coalesce((select created_at from work_activity_events where id = ${pos.lastEventId}), ${pos.lastEventAt}::timestamptz),
      coalesce((select id from work_activity_events where id = ${pos.lastEventId}), ${SEM_ID}::uuid))`;
  }
  return sql`${E.createdAt} > ${pos.lastEventAt}::timestamptz`;
}

/** Eventos novos de uma empresa que pedem escrita no ClickUp, do mais antigo ao mais novo. Sem o que o importador gravou. */
export async function eventosParaSaida(organizationId: string, limite = 100): Promise<EventoDeSaida[]> {
  const linha = await linhaDoCursor(organizationId);
  if (!linha) return [];
  const E = schema.workActivityEvents;
  const linhas = await db
    .select()
    .from(E)
    .where(
      and(
        eq(E.organizationId, organizationId),
        eq(E.entityType, 'task'),
        inArray(E.action, [...ACOES_DE_SAIDA]),
        ne(E.actorKind, 'system'),
        depoisDoCursor(linha.meta as unknown as Posicao),
        lt(E.createdAt, new Date(Date.now() - 1000)),
      ),
    )
    .orderBy(asc(E.createdAt), asc(E.id))
    .limit(limite);
  return linhas.filter((e): e is typeof e & { taskId: string } => e.taskId !== null).map((e) => ({ id: e.id, createdAt: e.createdAt, action: e.action, taskId: e.taskId, actorId: e.actorId, actorKind: e.actorKind, data: e.data }));
}

/**
 * Esta tarefa ainda tem escrita esperando para ir ao ClickUp? Se tiver, ler o ClickUp agora e aplicar por cima
 * apagaria a edição que acabou de ser feita aqui. A leitura espera o escoador esvaziar a fila da tarefa.
 */
export async function temEscritaPendente(organizationId: string, taskId: string): Promise<boolean> {
  const linha = await linhaDoCursor(organizationId);
  if (!linha) return false;
  const E = schema.workActivityEvents;
  const [achado] = await db
    .select({ id: E.id })
    .from(E)
    .where(and(eq(E.organizationId, organizationId), eq(E.taskId, taskId), inArray(E.action, [...ACOES_DE_SAIDA]), ne(E.actorKind, 'system'), depoisDoCursor(linha.meta as unknown as Posicao)))
    .limit(1);
  return Boolean(achado);
}

export async function organizacoesComClickUp(): Promise<string[]> {
  const linhas = await db
    .selectDistinct({ organizationId: schema.workExternalMappings.organizationId })
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'list')));
  return linhas.map((l) => l.organizationId);
}

// ── leitura do estado atual (a escrita sempre empurra o valor de AGORA, nunca o do evento) ─────────────────────

export interface TarefaParaSaida {
  id: string;
  listId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  statusName: string;
  priority: number;
  startAt: Date | null;
  dueAt: Date | null;
  estimateMinutes: number | null;
  tags: string[];
  assigneeIds: string[];
  archivedAt: Date | null;
}

export async function tarefaParaSaida(organizationId: string, taskId: string): Promise<TarefaParaSaida | null> {
  const [t] = await db
    .select({ task: schema.workTasks, statusName: schema.workTaskStatuses.name })
    .from(schema.workTasks)
    .innerJoin(schema.workTaskStatuses, eq(schema.workTaskStatuses.id, schema.workTasks.statusId))
    .where(and(eq(schema.workTasks.id, taskId), eq(schema.workTasks.organizationId, organizationId)))
    .limit(1);
  if (!t) return null;
  const resp = await db.select({ userId: schema.workTaskAssignees.userId }).from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, taskId));
  return {
    id: t.task.id,
    listId: t.task.listId,
    parentTaskId: t.task.parentTaskId,
    title: t.task.title,
    description: t.task.description,
    statusName: t.statusName,
    priority: t.task.priority,
    startAt: t.task.startAt,
    dueAt: t.task.dueAt,
    estimateMinutes: t.task.estimateMinutes,
    tags: t.task.tags,
    assigneeIds: resp.map((r) => r.userId),
    archivedAt: t.task.archivedAt,
  };
}

/** E-mails para casar com os membros do ClickUp: o vínculo oficial (`clickup_email`) vale mais que o e-mail do sistema. */
export async function usuariosParaSaida(userIds: string[]): Promise<Map<string, { email: string; clickupEmail: string | null; name: string }>> {
  if (!userIds.length) return new Map();
  const linhas = await db.select({ id: schema.users.id, email: schema.users.email, clickupEmail: schema.users.clickupEmail, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds));
  return new Map(linhas.map((u) => [u.id, { email: u.email, clickupEmail: u.clickupEmail, name: u.name }]));
}

export async function comentarioParaSaida(organizationId: string, commentId: string) {
  const [c] = await db
    .select({ id: schema.workComments.id, taskId: schema.workComments.taskId, body: schema.workComments.body, authorId: schema.workComments.authorId, authorLabel: schema.workComments.authorLabel })
    .from(schema.workComments)
    .where(and(eq(schema.workComments.id, commentId), eq(schema.workComments.organizationId, organizationId)))
    .limit(1);
  return c ?? null;
}

// ── vínculos ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Vinculo {
  externalId: string;
  meta: Record<string, unknown>;
}

async function vinculoPorEntidade(organizationId: string, externalType: string, entityId: string): Promise<Vinculo | null> {
  const [v] = await db
    .select({ externalId: schema.workExternalMappings.externalId, meta: schema.workExternalMappings.meta })
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, externalType), eq(schema.workExternalMappings.entityId, entityId)))
    .limit(1);
  return v ?? null;
}

/** Para a leitura do ClickUp: de qual tarefa do Daily (e de qual empresa) é esta tarefa do ClickUp, se já foi importada. */
export async function parDaTarefaDoClickUp(externalTaskId: string): Promise<{ organizationId: string; taskId: string } | null> {
  const [v] = await db
    .select({ organizationId: schema.workExternalMappings.organizationId, entityId: schema.workExternalMappings.entityId })
    .from(schema.workExternalMappings)
    .where(and(eq(schema.workExternalMappings.provider, PROVIDER), eq(schema.workExternalMappings.externalType, 'task'), eq(schema.workExternalMappings.externalId, externalTaskId)))
    .limit(1);
  return v ? { organizationId: v.organizationId, taskId: v.entityId } : null;
}

export const vinculoDaTarefa = (organizationId: string, taskId: string) => vinculoPorEntidade(organizationId, 'task', taskId);
export const vinculoDaLista = (organizationId: string, listId: string) => vinculoPorEntidade(organizationId, 'list', listId);
export const vinculoDoComentario = (organizationId: string, commentId: string) => vinculoPorEntidade(organizationId, 'comment', commentId);

/** Liga uma entidade nascida AQUI à que foi criada no ClickUp. `origem: 'daily'` impede a leitura de reescrevê-la depois. */
export async function registrarVinculoDeSaida(organizationId: string, v: { externalType: 'task' | 'comment'; externalId: string; entityId: string; meta?: Record<string, unknown> }): Promise<void> {
  await db
    .insert(schema.workExternalMappings)
    .values({ organizationId, provider: PROVIDER, externalType: v.externalType, externalId: v.externalId, entityType: v.externalType, entityId: v.entityId, meta: { origem: 'daily', ...(v.meta ?? {}) } })
    .onConflictDoNothing();
}

/** Tarefas do Daily que ainda não têm par no ClickUp (para as que nasceram aqui e a criação lá falhou). */
export async function tarefaSemVinculo(organizationId: string, taskId: string): Promise<boolean> {
  return (await vinculoDaTarefa(organizationId, taskId)) === null;
}

