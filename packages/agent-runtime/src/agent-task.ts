import type { AgentTask, AgentTaskStatus, JarbasAnalysisResult } from '@desigual-os/types';

/**
 * agent-task.ts — mecanismo real de handoff Bento -> Jarbas, offline.
 *
 * Escopo desta missão (24/09/2026): construir a LÓGICA (dispatch idempotente,
 * máquina de estado válida, isolamento por cliente/organização) de forma
 * 100% testável offline, sem tocar produção. `AgentTaskStore` é uma
 * interface; a única implementação fornecida aqui é em memória
 * (`InMemoryAgentTaskStore`) — deliberado. Persistir isto em Postgres é uma
 * migração de schema real, que esta missão explicitamente proíbe fazer
 * ("do not deploy", "do not restart production"). A interface já está no
 * formato certo pra um `PostgresAgentTaskStore` futuro implementar sem
 * mudar quem chama.
 */

export interface AgentTaskStore {
  dispatch(input: DispatchAgentTaskInput): Promise<DispatchOutcome>;
  get(taskId: string): Promise<AgentTask | null>;
  getResult(taskId: string): Promise<JarbasAnalysisResult | null>;
  transition(taskId: string, next: AgentTaskStatus, callerOrganizationId: string): Promise<TransitionOutcome>;
  attachResult(taskId: string, result: JarbasAnalysisResult, callerOrganizationId: string): Promise<TransitionOutcome>;
  /**
   * Muda o ESCOPO de uma tarefa em andamento (§15-16, ex.: "últimos 7 dias"
   * -> "últimos 30 dias"). Incrementa `version` e descarta qualquer
   * resultado já anexado da versão anterior — nunca deixa um resultado
   * velho passar por atual. Só vale pra tarefa NÃO terminal.
   */
  updateScope(taskId: string, next: { scope?: string; timeWindow?: AgentTask['timeWindow'] }, callerOrganizationId: string): Promise<TransitionOutcome>;
  recordFailure(taskId: string, error: string, callerOrganizationId: string): Promise<RecordFailureOutcome>;
  /**
   * "Qual foi a última tarefa do Jarbas nesta conversa?" (§5-§6). As TRÊS
   * chaves juntas, sempre — nunca só conversationId: se a conversa trocar de
   * cliente, a tarefa do cliente anterior não pode "vazar" pra pergunta de
   * status/resultado feita depois da troca. Mais recente = maior updatedAt.
   */
  getLatestTaskForClientConversation(organizationId: string, clientId: string, conversationId: string): Promise<AgentTask | null>;
}

export type RecordFailureOutcome =
  | { ok: true; task: AgentTask; retryable: boolean }
  | { ok: false; reason: 'not_found' | 'cross_org' | 'terminal_task' };

export interface DispatchAgentTaskInput {
  /**
   * Chave de idempotência — normalmente o id da mensagem/turno que originou
   * o pedido. MESMA chave despachada duas vezes é UMA tarefa lógica só
   * (§33): a segunda chamada devolve a tarefa já existente, não cria outra.
   */
  dispatchKey: string;
  organizationId: string;
  clientId: string;
  conversationId?: string | null;
  requestedBy: string | null;
  objective: string;
  scope: string;
  entityRefs: AgentTask['entityRefs'];
  timeWindow: AgentTask['timeWindow'];
  constraints?: string[];
  /** O pedido ORIGINAL do funcionário — nunca a paráfrase do Bento (§17/§29). */
  originalUserRequest: string;
  dueAt?: string | null;
}

export interface DispatchOutcome {
  task: AgentTask;
  /** true = já existia (mesma dispatchKey); nenhuma tarefa nova foi criada. */
  wasAlreadyDispatched: boolean;
}

export type TransitionOutcome =
  | { ok: true; task: AgentTask }
  | { ok: false; reason: 'not_found' | 'cross_org' | 'invalid_transition' | 'terminal_task' | 'stale_version' };

/**
 * Classificador de retry (§25-26). Puro, sem estado — decide se um erro
 * externo merece nova tentativa (timeout, 429, 5xx transitório) ou se deve
 * ir direto pra um estado BLOCKED_* (permissão, cliente inválido, entidade
 * ambígua, versão de tarefa inválida, erro de contrato que precisa de
 * correção de código). Nunca retry infinito: MAX_TENTATIVAS é o teto.
 */
export const MAX_TENTATIVAS_RETRY = 3;

const PADROES_NAO_RETENTAVEIS = [/permiss[ãa]o/i, /permission/i, /cliente inv[áa]lido/i, /invalid client/i, /entidade amb[íi]gua/i, /ambiguous entity/i, /vers[ãa]o inv[áa]lida/i, /invalid.*version/i, /contrato/i, /validation/i];

export function isRetryableError(error: string): boolean {
  if (PADROES_NAO_RETENTAVEIS.some((re) => re.test(error))) return false;
  return /timeout|429|5\d\d|temporari|transient|econnreset|econnrefused/i.test(error);
}

/** Backoff exponencial simples: 2^tentativa segundos, mínimo 1s. Determinístico, sem jitter — mais fácil de testar. */
export function computeNextEligibleRetry(attemptCount: number, now: Date = new Date()): string {
  const segundos = Math.max(1, 2 ** attemptCount);
  return new Date(now.getTime() + segundos * 1000).toISOString();
}

/**
 * Máquina de estado (§23). Cancelamento é permitido de qualquer estado não
 * terminal (§35: "pare antes do próximo estágio caro"). Nenhuma transição
 * pode sair de um estado TERMINAL (ready_for_review, cancelled, e os
 * blocked_* — que só saem por um dispatch NOVO, nunca por transição).
 */
const TERMINAL: ReadonlySet<AgentTaskStatus> = new Set([
  'ready_for_review',
  'cancelled',
  'blocked_needs_data',
  'blocked_ambiguous',
  'blocked_permission',
  'blocked_external_service',
]);

const VALID_NEXT: Record<AgentTaskStatus, ReadonlySet<AgentTaskStatus>> = {
  assigned: new Set(['acknowledged', 'cancelled', 'blocked_permission', 'blocked_ambiguous']),
  acknowledged: new Set(['context_resolved', 'cancelled', 'blocked_ambiguous', 'blocked_permission']),
  context_resolved: new Set(['data_required', 'analyzing', 'cancelled', 'blocked_needs_data', 'blocked_external_service']),
  data_required: new Set(['analyzing', 'cancelled', 'blocked_needs_data', 'blocked_external_service']),
  analyzing: new Set(['verifying', 'cancelled', 'blocked_needs_data', 'blocked_external_service']),
  verifying: new Set(['completed_analysis', 'cancelled', 'blocked_needs_data']),
  completed_analysis: new Set(['ready_for_review', 'cancelled']),
  ready_for_review: new Set([]),
  cancelled: new Set([]),
  blocked_needs_data: new Set([]),
  blocked_ambiguous: new Set([]),
  blocked_permission: new Set([]),
  blocked_external_service: new Set([]),
};

let contador = 0;
function novoTaskId(): string {
  contador += 1;
  return `agent-task-${Date.now()}-${contador}`;
}

export class InMemoryAgentTaskStore implements AgentTaskStore {
  private readonly tarefas = new Map<string, AgentTask>();
  private readonly resultados = new Map<string, JarbasAnalysisResult>();
  private readonly porDispatchKey = new Map<string, string>();

  async dispatch(input: DispatchAgentTaskInput): Promise<DispatchOutcome> {
    const existenteId = this.porDispatchKey.get(input.dispatchKey);
    if (existenteId) {
      const existente = this.tarefas.get(existenteId);
      if (existente) return { task: existente, wasAlreadyDispatched: true };
    }
    const task: AgentTask = {
      taskId: novoTaskId(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      conversationId: input.conversationId ?? null,
      requestedBy: input.requestedBy,
      assignedAgent: 'jarbas',
      objective: input.objective,
      scope: input.scope,
      entityRefs: input.entityRefs,
      timeWindow: input.timeWindow,
      constraints: input.constraints ?? [],
      originalUserRequest: input.originalUserRequest,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dueAt: input.dueAt ?? null,
      status: 'assigned',
      version: 1,
      retry: { attemptCount: 0, lastError: null, lastErrorAt: null, nextEligibleRetryAt: null },
    };
    this.tarefas.set(task.taskId, task);
    this.porDispatchKey.set(input.dispatchKey, task.taskId);
    return { task, wasAlreadyDispatched: false };
  }

  async get(taskId: string): Promise<AgentTask | null> {
    return this.tarefas.get(taskId) ?? null;
  }

  async getResult(taskId: string): Promise<JarbasAnalysisResult | null> {
    return this.resultados.get(taskId) ?? null;
  }

  async transition(taskId: string, next: AgentTaskStatus, callerOrganizationId: string): Promise<TransitionOutcome> {
    const task = this.tarefas.get(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (TERMINAL.has(task.status)) return { ok: false, reason: 'terminal_task' };
    if (!VALID_NEXT[task.status].has(next)) return { ok: false, reason: 'invalid_transition' };
    const atualizado: AgentTask = { ...task, status: next, updatedAt: new Date().toISOString() };
    this.tarefas.set(taskId, atualizado);
    return { ok: true, task: atualizado };
  }

  async attachResult(taskId: string, result: JarbasAnalysisResult, callerOrganizationId: string): Promise<TransitionOutcome> {
    const task = this.tarefas.get(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (task.status !== 'verifying' && task.status !== 'analyzing') return { ok: false, reason: 'invalid_transition' };
    // §16: um resultado calculado sobre uma versão de escopo que já mudou
    // (updateScope rodou enquanto a análise estava em andamento) nunca vira
    // "atual" — a análise em curso precisa recomeçar na versão nova.
    if (result.taskVersion !== task.version) return { ok: false, reason: 'stale_version' };
    this.resultados.set(taskId, result);
    const atualizado: AgentTask = { ...task, status: 'completed_analysis', updatedAt: new Date().toISOString() };
    this.tarefas.set(taskId, atualizado);
    return { ok: true, task: atualizado };
  }

  async updateScope(taskId: string, next: { scope?: string; timeWindow?: AgentTask['timeWindow'] }, callerOrganizationId: string): Promise<TransitionOutcome> {
    const task = this.tarefas.get(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (TERMINAL.has(task.status)) return { ok: false, reason: 'terminal_task' };
    const atualizado: AgentTask = {
      ...task,
      scope: next.scope ?? task.scope,
      timeWindow: next.timeWindow ?? task.timeWindow,
      version: task.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tarefas.set(taskId, atualizado);
    // O resultado da versão anterior nunca deve aparecer como se fosse da
    // atual — descartado, não "marcado stale e mantido": getResult só pode
    // devolver o que já foi validado contra a versão vigente.
    this.resultados.delete(taskId);
    return { ok: true, task: atualizado };
  }

  async recordFailure(taskId: string, error: string, callerOrganizationId: string): Promise<RecordFailureOutcome> {
    const task = this.tarefas.get(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (TERMINAL.has(task.status)) return { ok: false, reason: 'terminal_task' };
    const attemptCount = task.retry.attemptCount + 1;
    const retryable = isRetryableError(error) && attemptCount <= MAX_TENTATIVAS_RETRY;
    const agora = new Date().toISOString();
    const retry = {
      attemptCount,
      lastError: error,
      lastErrorAt: agora,
      nextEligibleRetryAt: retryable ? computeNextEligibleRetry(attemptCount) : null,
    };
    const proximoStatus: AgentTaskStatus = retryable ? task.status : 'blocked_external_service';
    const atualizado: AgentTask = { ...task, retry, status: proximoStatus, updatedAt: agora };
    this.tarefas.set(taskId, atualizado);
    return { ok: true, task: atualizado, retryable };
  }

  async getLatestTaskForClientConversation(organizationId: string, clientId: string, conversationId: string): Promise<AgentTask | null> {
    let maisRecente: AgentTask | null = null;
    for (const task of this.tarefas.values()) {
      if (task.organizationId !== organizationId || task.clientId !== clientId || task.conversationId !== conversationId) continue;
      if (!maisRecente || task.updatedAt > maisRecente.updatedAt) maisRecente = task;
    }
    return maisRecente;
  }
}

export function isTerminalStatus(status: AgentTaskStatus): boolean {
  return TERMINAL.has(status);
}
