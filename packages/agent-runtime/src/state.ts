import type { AgentPlan } from './planner';
/**
 * Estado de execução de um agente (Agentic V2). Persistido como checkpoint
 * após cada transição de fase (ver packages/database schema
 * agent_execution_states), então uma execução longa sobrevive a restart do
 * worker e cada etapa é auditável no trace.
 */
export const AGENT_PHASES = [
  'RECEIVED',
  'UNDERSTANDING',
  'GATHERING_CONTEXT',
  'PLANNING',
  'ACTING',
  'WAITING_TOOL',
  'OBSERVING',
  'EVALUATING',
  'REPLANNING',
  'FINALIZING',
  'COMPLETED',
  'FAILED',
  'NEEDS_USER_INPUT',
] as const;

export type AgentPhase = (typeof AGENT_PHASES)[number];

/** Fases terminais: o loop só para nelas. */
export const TERMINAL_PHASES: readonly AgentPhase[] = ['COMPLETED', 'FAILED', 'NEEDS_USER_INPUT'];

export interface ToolCallRecord {
  tool: string;
  input_summary: string;
  ok: boolean;
  duration_ms: number;
  error?: string;
}

export interface Observation {
  /** Texto do que foi observado de fato (resultado REAL da ação, não suposição). */
  text: string;
  /** Estratégia usada na tentativa que gerou esta observação. */
  strategy: string;
  attempt: number;
}

/**
 * Evidência (seções 24-26 da spec V2): informação REAL recuperada que sustenta
 * uma afirmação. Diferente de contexto (o que entrou no turno) e de memória (o
 * que persiste): evidência é o que ancora um CLAIM factual, com origem e
 * validade rastreáveis. Turno factual sem evidência não passa no evaluator.
 */
export interface Evidence {
  type:
    | 'clickup_task'
    | 'clickup_comment'
    | 'document'
    | 'database'
    | 'obsidian'
    | 'memory'
    | 'user_message'
    | 'web'
    | 'tool_result';
  /** Rótulo legível da fonte (nome da lista/cliente, kind da memória, ferramenta). */
  source: string;
  /** Id na origem quando existir (id da task no ClickUp, id da memória). */
  sourceId?: string;
  clientId?: string | null;
  /** 0..1: dado ao vivo = 1; memória herda a confiança dela. */
  confidence?: number;
  /** ISO: quando foi recuperada (sempre o instante do turno). */
  retrievedAt: string;
  /** ISO: para dado com validade temporal, o instante em que era verdade. */
  validAt?: string;
  /** Texto curto do que a evidência afirma (nunca o dump inteiro). */
  summary: string;
}

export interface AgentExecutionState {
  executionId: string;
  requestId: string;
  agentId: string;
  userId: string;
  clientId: string | null;
  conversationId: string | null;

  originalRequest: string;
  interpretedGoal: string | null;

  constraints: string[];
  successCriteria: string[];

  /** Plano mínimo interno (nunca exposto cru ao usuário). */
  plan: string[];
  /** Plano ADAPTATIVO estruturado do turno (§10-15). Null até a fase PLANNING. */
  structuredPlan: AgentPlan | null;
  currentStep: number;
  stepsCompleted: string[];

  toolCalls: ToolCallRecord[];
  observations: Observation[];

  /** Evidências recuperadas que ancoram afirmações factuais (seção 24). */
  evidence: Evidence[];
  /** Este turno afirma fato sobre estado real e por isso EXIGE evidência (seção 25). */
  requiresEvidence: boolean;

  artifacts: { type: string; ref: string }[];

  confidence: number;
  evaluatorScore: number | null;

  phase: AgentPhase;
  /** Quantas tentativas de ACT já foram feitas. */
  iterations: number;
  /** Estratégias já tentadas (o runtime proíbe repetir estratégia que falhou). */
  strategiesTried: string[];

  startedAt: string;
  updatedAt: string;
}

export type TaskClass = 'simple' | 'standard' | 'complex';

/** Limites por classe de tarefa (seção 11 da spec V2). */
export const MAX_ITERATIONS: Record<TaskClass, number> = {
  simple: 2,
  standard: 5,
  complex: 10,
};

export function createInitialState(input: {
  executionId: string;
  requestId: string;
  agentId: string;
  userId: string;
  clientId: string | null;
  conversationId: string | null;
  originalRequest: string;
}): AgentExecutionState {
  const now = new Date().toISOString();
  return {
    executionId: input.executionId,
    requestId: input.requestId,
    agentId: input.agentId,
    userId: input.userId,
    clientId: input.clientId,
    conversationId: input.conversationId,
    originalRequest: input.originalRequest,
    interpretedGoal: null,
    constraints: [],
    successCriteria: [],
    plan: [],
    structuredPlan: null,
    currentStep: 0,
    stepsCompleted: [],
    toolCalls: [],
    observations: [],
    evidence: [],
    requiresEvidence: false,
    artifacts: [],
    confidence: 0,
    evaluatorScore: null,
    phase: 'RECEIVED',
    iterations: 0,
    strategiesTried: [],
    startedAt: now,
    updatedAt: now,
  };
}
