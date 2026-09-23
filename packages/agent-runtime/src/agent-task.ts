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
}

export interface DispatchAgentTaskInput {
  /**
   * Chave de idempotência — normalmente o id da mensagem/turno que originou
   * o pedido. MESMA chave despachada duas vezes é UMA tarefa lógica só
   * (§33): a segunda chamada devolve a tarefa já existente, não cria outra.
   */
  dispatchKey: string;
  organizationId: string;
  clientId: string;
  requestedBy: string;
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
  | { ok: false; reason: 'not_found' | 'cross_org' | 'invalid_transition' | 'terminal_task' };

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
      requestedBy: input.requestedBy,
      assignedAgent: 'jarbas',
      objective: input.objective,
      scope: input.scope,
      entityRefs: input.entityRefs,
      timeWindow: input.timeWindow,
      constraints: input.constraints ?? [],
      originalUserRequest: input.originalUserRequest,
      createdAt: new Date().toISOString(),
      dueAt: input.dueAt ?? null,
      status: 'assigned',
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
    const atualizado: AgentTask = { ...task, status: next };
    this.tarefas.set(taskId, atualizado);
    return { ok: true, task: atualizado };
  }

  async attachResult(taskId: string, result: JarbasAnalysisResult, callerOrganizationId: string): Promise<TransitionOutcome> {
    const task = this.tarefas.get(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.organizationId !== callerOrganizationId) return { ok: false, reason: 'cross_org' };
    if (task.status !== 'verifying' && task.status !== 'analyzing') return { ok: false, reason: 'invalid_transition' };
    this.resultados.set(taskId, result);
    const atualizado: AgentTask = { ...task, status: 'completed_analysis' };
    this.tarefas.set(taskId, atualizado);
    return { ok: true, task: atualizado };
  }
}

export function isTerminalStatus(status: AgentTaskStatus): boolean {
  return TERMINAL.has(status);
}
