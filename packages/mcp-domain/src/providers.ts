/**
 * providers.ts — as fronteiras que permitem trocar de ferramenta sem reescrever
 * o domínio (§16, §17).
 *
 * Hoje o domínio importa `createTask`/`updateTask` do ClickUp direto do
 * `tool-gateway`. Funciona, e é justamente por isso que trocar o ClickUp
 * exigiria mexer no domínio inteiro. Estas interfaces são o contrato mínimo que
 * o MCP precisa — e nenhuma delas fala ClickUp.
 *
 * Regra que governa este arquivo: **nada aqui pode mencionar um fornecedor.**
 * Se um campo só faz sentido no ClickUp, ele não pertence a esta camada.
 */

/** Uma tarefa, como a operação pensa nela — não como o ClickUp a serializa. */
export interface TaskRef {
  id: string;
  title: string;
  status: string | null;
  /** `open` | `done` | `closed` | outro. Normalizado pelo provider. */
  statusType: string | null;
  priority: string | null;
  /** Epoch ms. */
  dueDate: number | null;
  assignees: string[];
  clientId: string | null;
  clientName: string | null;
  url: string | null;
  updatedAt: number | null;
}

export interface TaskQuery {
  clientIds?: string[];
  assigneeIds?: string[];
  dueAfter?: number;
  dueBefore?: number;
  includeClosed?: boolean;
  text?: string;
  limit?: number;
  cursor?: string;
}

export interface TaskPage {
  tasks: TaskRef[];
  /** `null` quando acabou. Cursor opaco: quem consome não interpreta. */
  nextCursor: string | null;
  /** `true` quando a fonte cortou antes do fim. Ver §19: nunca mentir totais. */
  truncated: boolean;
}

export interface CreateTaskInput {
  clientId: string;
  title: string;
  description?: string;
  assigneeName?: string;
  dueDate?: string;
  priority?: string;
  parentTaskId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  assigneeName?: string;
  assigneeOperation?: 'add' | 'remove' | 'replace';
  dueDate?: string;
  priority?: string;
  status?: string;
}

export interface TaskComment {
  id: string;
  author: string | null;
  text: string;
  createdAt: number | null;
}

/**
 * TaskProvider — o contrato do §16.
 *
 * `findTask` existe separado de `searchTasks` de propósito: buscar para LISTAR
 * e buscar para DECIDIR SE JÁ EXISTE são usos diferentes, e o segundo precisa
 * ser barato e preciso o bastante para rodar antes de todo create
 * (reconcile-first, ver idempotency.ts).
 */
export interface TaskProvider {
  readonly nome: string;
  findTask(clientId: string, title: string): Promise<TaskRef[]>;
  getTask(taskId: string): Promise<TaskRef | null>;
  searchTasks(query: TaskQuery): Promise<TaskPage>;
  createTask(input: CreateTaskInput): Promise<TaskRef>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<TaskRef>;
  deleteTask(taskId: string): Promise<void>;
  setStatus(taskId: string, status: string): Promise<TaskRef>;
  assignUser(taskId: string, assigneeName: string, operation: 'add' | 'remove' | 'replace'): Promise<TaskRef>;
  addComment(taskId: string, text: string): Promise<TaskComment>;
  getComments(taskId: string): Promise<TaskComment[]>;
}

/**
 * Resultado de tráfego. `DATA_NOT_AVAILABLE` é um estado de primeira classe
 * (§8): a alternativa é o modelo preencher o buraco, e número inventado sobre
 * verba de cliente é o pior tipo de alucinação que este sistema pode produzir.
 */
export type TrafficResult<T> =
  | { status: 'OK'; data: T }
  | { status: 'DATA_NOT_AVAILABLE'; reason: string };

export interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  leads: number | null;
  cpl: number | null;
  conversions: number | null;
  cpa: number | null;
  roas: number | null;
  periodFrom: string;
  periodTo: string;
}

export interface TrafficProvider {
  readonly nome: string;
  getCampaigns(clientId: string): Promise<TrafficResult<CampaignMetrics[]>>;
  getCampaignPerformance(
    clientId: string,
    options: { from?: string; to?: string; campaignId?: string },
  ): Promise<TrafficResult<CampaignMetrics[]>>;
  getRecentChanges(clientId: string, days: number): Promise<TrafficResult<Array<{ what: string; when: string; detail: string }>>>;
}

export interface AssetRef {
  id: string;
  name: string;
  kind: string;
  clientId: string | null;
  url: string | null;
  createdAt: number | null;
}

export interface AssetProvider {
  readonly nome: string;
  searchAssets(query: { clientId?: string; text?: string; limit?: number }): Promise<AssetRef[]>;
  getAsset(assetId: string): Promise<AssetRef | null>;
  registerAsset(input: { clientId: string; name: string; kind: string; url?: string }): Promise<AssetRef>;
}

/**
 * O conjunto de providers que uma sessão MCP usa. Injetado, nunca importado
 * direto pelas tools — é isso que deixa o teste rodar sem rede e sem ClickUp.
 */
export interface ProviderSet {
  tasks: TaskProvider;
  traffic: TrafficProvider;
  assets: AssetProvider;
}
