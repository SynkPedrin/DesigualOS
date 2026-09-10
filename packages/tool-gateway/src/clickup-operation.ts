import { z } from 'zod';
import type { ClickUpConfig } from './clickup-client';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

/**
 * clickup-operation.ts — consulta de tarefas no escopo da OPERAÇÃO INTEIRA, não de
 * uma lista só.
 *
 * Lacuna real medida em 10/09/2026: até aqui TODA leitura de tarefa no repo passava
 * por `getTasksInList` (clickup-oauth.ts), que bate em `GET /list/{id}/task` — uma
 * lista = um cliente. Não existia NENHUMA chamada a `GET /team/{id}/task` em lugar
 * nenhum do código. Consequência prática: pergunta como "quantas tasks vencem
 * amanhã?" era literalmente irrespondível pelo sistema, porque não havia primitiva
 * de operação inteira — só dava pra perguntar cliente por cliente. Era isso, e não
 * o prompt do agente, que fazia o agente responder "de qual cliente?".
 *
 * POR QUE `GET /team/{id}/task` E NÃO UM LOOP DE 50 LISTAS:
 * o endpoint de time aceita `list_ids[]` e filtros de data/status/responsável e
 * resolve a operação inteira em 1 requisição (2-3 com paginação). O loop
 * equivalente custaria ~50 requisições — metade do orçamento de 100 req/min do
 * ClickUp num único pedido de usuário, sem nenhum tratamento de 429 no repo hoje
 * (verificado: zero backoff/retry em todo o código de integração). Confirmado ao
 * vivo contra a API real: 10 tasks vencendo amanhã, 5 clientes diferentes, uma
 * requisição, `last_page: true`.
 *
 * AUTORIZAÇÃO (nunca "todos" no sentido de bypass): o chamador passa `listIds` com
 * as listas dos clientes que aquele usuário pode ver. Escopo global significa
 * "todos os clientes autorizados", nunca "tudo que a chave da agência alcança".
 * Hoje `hasClientAccess` (apps/api/src/lib/access.ts) devolve `true` por decisão
 * registrada do produto (cliente é compartilhado pelo time), então na prática é a
 * carteira inteira — mas o filtro é aplicado aqui do mesmo jeito, pra que no dia
 * que aquela função voltar a restringir, esta camada já respeite sem alteração.
 */

const teamTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  text_content: z.string().nullish(),
  description: z.string().nullish(),
  status: z.object({ status: z.string(), color: z.string().nullish(), type: z.string().nullish() }).nullish(),
  date_created: z.string().nullish(),
  date_updated: z.string().nullish(),
  due_date: z.string().nullish(),
  start_date: z.string().nullish(),
  priority: z.object({ priority: z.string().nullish(), color: z.string().nullish() }).nullish(),
  url: z.string().nullish(),
  assignees: z
    .array(z.object({ id: z.number().nullish(), username: z.string().nullish(), email: z.string().nullish() }))
    .nullish(),
  tags: z.array(z.object({ name: z.string() })).nullish(),
  list: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  folder: z.object({ id: z.string().nullish(), name: z.string().nullish() }).nullish(),
  space: z.object({ id: z.string().nullish() }).nullish(),
});

const teamTasksResponseSchema = z.object({
  tasks: z.array(teamTaskSchema),
  last_page: z.boolean().nullish(),
});

/** Tarefa já normalizada: nomes em camelCase, datas em ms numérico, nunca `undefined`
 * no meio (quem monta briefing não deveria ter que defender de 6 formatos do ClickUp). */
export interface OperationTask {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  statusType: string | null;
  priority: string | null;
  url: string | null;
  dueDate: number | null;
  startDate: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  assignees: string[];
  tags: string[];
  listId: string | null;
  listName: string | null;
  folderName: string | null;
  spaceId: string | null;
}

export interface OperationTaskQuery {
  /** Listas autorizadas. Vazio/omitido = sem filtro de lista (ver nota de autorização
   * no topo: o chamador é responsável por decidir isso). */
  listIds?: string[];
  /** Janela de vencimento, em ms epoch. Semântica do ClickUp é exclusiva nas pontas. */
  dueAfter?: number;
  dueBefore?: number;
  /** Filtra por status (ex: ['aberto', 'em andamento']). */
  statuses?: string[];
  /** Ids numéricos de responsáveis no ClickUp. */
  assigneeIds?: number[];
  includeClosed?: boolean;
  subtasks?: boolean;
  /** Só tarefas SEM data de vencimento. Útil pra "o que está solto na operação". */
  dueDateNull?: boolean;
}

export interface OperationTaskPage {
  tasks: OperationTask[];
  /** true quando a busca parou por atingir MAX_PAGES e não por fim de dados —
   * quem exibe precisa saber que o número não é o total real. */
  truncated: boolean;
  pagesFetched: number;
}

/** Teto de segurança: 100 tarefas por página × 20 = 2000 tarefas. Acima disso a
 * pergunta virou "relatório", não "consulta de chat", e devolver truncado com aviso
 * é melhor que gastar 30 requisições e estourar o rate limit da agência inteira. */
const MAX_PAGES = 20;
const RATE_LIMIT_MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 20_000;

function toNumberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTask(raw: z.infer<typeof teamTaskSchema>): OperationTask {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description?.trim() || raw.text_content?.trim() || null,
    status: raw.status?.status ?? null,
    statusType: raw.status?.type ?? null,
    priority: raw.priority?.priority ?? null,
    url: raw.url ?? null,
    dueDate: toNumberOrNull(raw.due_date),
    startDate: toNumberOrNull(raw.start_date),
    createdAt: toNumberOrNull(raw.date_created),
    updatedAt: toNumberOrNull(raw.date_updated),
    assignees: (raw.assignees ?? []).map((a) => a.username || a.email || '').filter(Boolean),
    tags: (raw.tags ?? []).map((t) => t.name),
    listId: raw.list?.id ?? null,
    listName: raw.list?.name ?? null,
    folderName: raw.folder?.name ?? null,
    spaceId: raw.space?.id ?? null,
  };
}

function buildQueryString(query: OperationTaskQuery, page: number): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('subtasks', String(query.subtasks ?? true));
  params.set('include_closed', String(query.includeClosed ?? false));
  if (query.dueAfter !== undefined) params.set('due_date_gt', String(query.dueAfter));
  if (query.dueBefore !== undefined) params.set('due_date_lt', String(query.dueBefore));
  if (query.dueDateNull) params.set('due_date_null', 'true');
  // ClickUp exige a forma `chave[]=v` repetida pra array (não CSV), e o
  // URLSearchParams já cuida do percent-encoding dos colchetes.
  for (const listId of query.listIds ?? []) params.append('list_ids[]', listId);
  for (const status of query.statuses ?? []) params.append('statuses[]', status);
  for (const assignee of query.assigneeIds ?? []) params.append('assignees[]', String(assignee));
  return params.toString();
}

/**
 * Uma página. Trata 429 com espera (respeitando `Retry-After` quando o ClickUp
 * manda) — hoje NÃO existe nenhum tratamento de rate limit em todo o código de
 * integração do repo, e uma consulta de operação inteira é justamente o tipo de
 * pedido que encosta no limite.
 */
async function fetchPage(
  config: ClickUpConfig,
  query: OperationTaskQuery,
  page: number,
): Promise<{ tasks: OperationTask[]; lastPage: boolean }> {
  const url = `${CLICKUP_API_BASE}/team/${config.teamId}/task?${buildQueryString(query, page)}`;

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: { Authorization: config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 429) {
      if (attempt === RATE_LIMIT_MAX_RETRIES) {
        throw new Error('ClickUp (tarefas da operação) HTTP 429: limite de requisições atingido');
      }
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`ClickUp (tarefas da operação) HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const parsed = teamTasksResponseSchema.parse(await response.json());
    return {
      tasks: parsed.tasks.map(normalizeTask),
      // O ClickUp só manda `last_page` em algumas versões da resposta; sem o campo,
      // página incompleta (< 100) também significa fim.
      lastPage: parsed.last_page === true || parsed.tasks.length < 100,
    };
  }

  throw new Error('ClickUp (tarefas da operação): esgotou as tentativas de rate limit');
}

/** Busca todas as páginas (até MAX_PAGES) e devolve o conjunto completo. */
export async function queryOperationTasks(
  config: ClickUpConfig,
  query: OperationTaskQuery = {},
): Promise<OperationTaskPage> {
  const tasks: OperationTask[] = [];
  let page = 0;

  for (; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(config, query, page);
    tasks.push(...result.tasks);
    if (result.lastPage) {
      return { tasks, truncated: false, pagesFetched: page + 1 };
    }
  }

  return { tasks, truncated: true, pagesFetched: page };
}

export interface TasksByClient {
  clientId: string;
  clientName: string;
  listId: string;
  tasks: OperationTask[];
}

/**
 * Agrupa por cliente usando o mapa `clickup_list_id -> cliente` que o chamador já
 * tem do banco. Tarefa de lista não mapeada cai em `unmatched` em vez de ser
 * descartada silenciosamente — se aparecer muita coisa aí, é sinal de cliente sem
 * `clickup_list_id` (medido em 10/09/2026: 7 de 57 clientes sem mapeamento), e isso
 * precisa ser visível em vez de virar buraco no relatório.
 */
export function groupTasksByClient(
  tasks: OperationTask[],
  clientsByListId: Map<string, { id: string; name: string }>,
): { byClient: TasksByClient[]; unmatched: OperationTask[] } {
  const grouped = new Map<string, TasksByClient>();
  const unmatched: OperationTask[] = [];

  for (const task of tasks) {
    const client = task.listId ? clientsByListId.get(task.listId) : undefined;
    if (!client || !task.listId) {
      unmatched.push(task);
      continue;
    }
    const existing = grouped.get(task.listId);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    grouped.set(task.listId, {
      clientId: client.id,
      clientName: client.name,
      listId: task.listId,
      tasks: [task],
    });
  }

  const byClient = [...grouped.values()].sort((a, b) => b.tasks.length - a.tasks.length);
  return { byClient, unmatched };
}
