/**
 * jarbas-analysis.ts — contrato de dados pra análise de performance do Jarbas.
 *
 * NÃO é o formato que o Jarbas devolve hoje. O serviço externo
 * (agentes-desigual, JARBAS_ASK_URL) devolve só `{ ok, agent, answer, error }`
 * — texto livre, sem número estruturado, sem proveniência, sem trace de
 * ferramenta nenhuma (investigado em 24/09/2026, ver
 * docs/coordination/JARBAS_SENIOR_HANDOFF.md). Este arquivo define o
 * contrato que o Jarbas PRECISARIA falar pra virar sênior de verdade — pra
 * existir e ser testável antes de existir dado real pra preencher.
 *
 * Por isso todo tipo aqui tem `provenanceAvailable` explícito, e nenhum
 * código deste repositório pode popular `metricFacts`/`comparisons` com
 * valor inventado só pra bater o schema. Sem dado real do serviço externo,
 * o array fica vazio e `provenanceAvailable` fica `false` — nunca finge.
 */

/** Unidade de medida de um valor numérico — evita confundir 10% com 10 pontos percentuais. */
export type MetricUnit = 'currency' | 'percent' | 'percentage_points' | 'count' | 'ratio';

/** Nível da hierarquia Meta Ads ao qual um MetricFact se refere — nunca ambíguo. */
export type MetaEntityType = 'account' | 'campaign' | 'adset' | 'ad' | 'creative';

/**
 * Um fato numérico único, rastreável. Toda alegação numérica importante do
 * Jarbas ("CPL subiu 23%") precisa apontar pra um ou mais MetricFacts —
 * nunca pra "o modelo disse".
 */
export interface MetricFact {
  metric: string;
  value: number;
  unit: MetricUnit;
  currency?: string | null;
  entityType: MetaEntityType;
  entityId: string;
  entityName: string;
  clientId: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  fetchedAt: string;
  source: string;
  provenanceId: string;
}

/** NULL/MISSING/NOT_TRACKED/NOT_APPLICABLE/DELAYED nunca viram 0 silenciosamente (regra §5). */
export type MetricAvailability = 'available' | 'null' | 'missing' | 'not_tracked' | 'not_applicable' | 'delayed';

export interface MetricValueOrGap {
  availability: MetricAvailability;
  fact?: MetricFact;
}

/** Comparação entre dois períodos — só vale quando os dois lados são comparáveis (§6). */
export interface MetricComparison {
  metric: string;
  current: MetricValueOrGap;
  previous: MetricValueOrGap;
  changeAbsolute?: number | null;
  changePercent?: number | null;
  comparable: boolean;
  incomparabilityReason?: string | null;
}

export type ClaimKind = 'observation' | 'hypothesis' | 'conclusion' | 'recommendation';

export interface AnalysisClaim {
  text: string;
  kind: ClaimKind;
  metricFactIds: string[];
  confidence: 'high' | 'medium' | 'low';
}

export type FreshnessStatus = 'current' | 'recent' | 'stale' | 'unknown';

export interface SourceTraceEntry {
  provider: string;
  requestType: string;
  accountId: string;
  entityId: string | null;
  periodStart: string;
  periodEnd: string;
  metricNames: string[];
  retrievedAt: string;
  freshness: FreshnessStatus;
}

/**
 * Resultado estruturado de uma análise do Jarbas — o que Bento consumiria
 * de volta (§18) se/quando existir. `schemaVersion` porque isto MUDA assim
 * que o serviço externo ganhar suporte real; consumidor deve checar antes
 * de assumir forma.
 */
export type RecommendationType =
  | 'observe'
  | 'review_creative'
  | 'check_tracking'
  | 'check_post_click'
  | 'review_audience'
  | 'review_budget'
  | 'collect_more_data';

export interface Recommendation {
  type: RecommendationType;
  title: string;
  rationale: string;
  evidenceRefs: string[];
  confidence: 'high' | 'medium' | 'low';
  priority: 'high' | 'medium' | 'low';
  expectedImpact?: string | null;
  risk: string;
  requiresApproval: boolean;
}

export type ProposedActionType = 'budget_change' | 'bid_change' | 'audience_change' | 'creative_change' | 'pause' | 'resume' | 'duplicate' | 'publish';

/**
 * Proposta de mutação — NUNCA um caminho de execução. Este repositório não
 * tem, em nenhum lugar, código capaz de chamar a Graph API do Meta; um
 * ProposedAction existe só pra registrar a proposta e aguardar aprovação
 * humana (mesmo padrão de requestToolCall/[AGUARDA_APROVACAO] já usado
 * pra Jarbas/Suzy em execute-job.ts — ver §6 do handoff doc).
 */
export interface ProposedAction {
  type: ProposedActionType;
  entityId: string;
  currentValue: string | number | null;
  proposedValue: string | number;
  reason: string;
  evidenceRefs: string[];
  risk: string;
  requiresApproval: true;
}

export interface JarbasAnalysisResult {
  schemaVersion: 1;
  taskId: string;
  /** Precisa bater com AgentTask.version NO MOMENTO da leitura (§16) — senão o resultado é stale. */
  taskVersion: number;
  /** false até o serviço externo devolver dado estruturado de verdade — nunca populado por invenção local. */
  provenanceAvailable: boolean;
  scope: {
    organizationId: string;
    clientId: string;
    accountId: string | null;
    entityType: MetaEntityType | 'account_wide' | null;
    entityId: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  claims: AnalysisClaim[];
  metricFacts: MetricFact[];
  comparisons: MetricComparison[];
  recommendations: Recommendation[];
  proposedActions: ProposedAction[];
  missingData: string[];
  risks: string[];
  sourceTrace: SourceTraceEntry[];
  analysisConfidence: 'high' | 'medium' | 'low' | 'insufficient_data';
}

export type AgentTaskStatus =
  | 'assigned'
  | 'acknowledged'
  | 'context_resolved'
  | 'data_required'
  | 'analyzing'
  | 'verifying'
  | 'completed_analysis'
  | 'ready_for_review'
  | 'blocked_needs_data'
  | 'blocked_ambiguous'
  | 'blocked_permission'
  | 'blocked_external_service'
  | 'cancelled';

/**
 * Contrato de uma tarefa entre agentes (§15-17) — Bento atribuindo trabalho
 * ao Jarbas. O mecanismo de dispatch/estado (packages/agent-runtime/src/
 * agent-task.ts) já existe e é testado offline; a persistência real
 * (Postgres) é código também, mas nunca aplicada contra o banco ao vivo
 * nesta missão — ver docs/coordination/JARBAS_SENIOR_HANDOFF.md.
 */
export interface AgentTask {
  taskId: string;
  organizationId: string;
  clientId: string;
  requestedBy: string;
  assignedAgent: 'jarbas';
  objective: string;
  scope: string;
  entityRefs: Array<{ type: MetaEntityType | 'client' | 'account'; id: string }>;
  timeWindow: { start: string; end: string } | null;
  constraints: string[];
  /** O pedido ORIGINAL do funcionário — nunca só a interpretação derivada do Bento (regra do handoff, §17). */
  originalUserRequest: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  status: AgentTaskStatus;
  /**
   * Versão do ESCOPO (§15-16). Incrementa quando o escopo muda
   * (ex.: "últimos 7 dias" -> "últimos 30 dias") enquanto a tarefa está em
   * andamento. Um resultado só é válido se `result.taskVersion` bater com
   * `task.version` NO MOMENTO da leitura — nunca apresentar resultado de
   * versão antiga como se fosse da atual.
   */
  version: number;
  retry: TaskRetryState;
}

export interface TaskRetryState {
  attemptCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
  nextEligibleRetryAt: string | null;
}

export type PerformanceMemoryEventType =
  | 'analysis_completed'
  | 'hypothesis_accepted'
  | 'hypothesis_rejected'
  | 'recommendation_generated'
  | 'recommendation_approved'
  | 'recommendation_rejected'
  | 'action_performed'
  | 'outcome_observed'
  | 'tracking_incident'
  | 'creative_changed'
  | 'budget_changed'
  | 'kpi_target_changed';

/**
 * Registro de aprendizado operacional (§17-22). NÃO é uma tabela nova —
 * é o formato que um `RememberInput` (packages/orchestrator/src/
 * memory-engine.ts, motor JÁ EXISTENTE e reaproveitado, nunca reescrito)
 * assume quando quem grava é o caminho de resposta do Jarbas. `subject`
 * (campo do RememberInput real) é o que garante que uma REJEIÇÃO
 * substitui a hipótese anterior do MESMO aspecto, em vez de acumular.
 */
export interface PerformanceMemoryEvent {
  organizationId: string;
  clientId: string;
  entityType: MetaEntityType | null;
  entityId: string | null;
  eventType: PerformanceMemoryEventType;
  observation: string;
  hypothesis?: string | null;
  recommendation?: string | null;
  decision?: string | null;
  outcome?: string | null;
  confidence: 'high' | 'medium' | 'low';
  sourceRefs: string[];
  createdAt: string;
}

/**
 * Contrato V2 que o serviço externo (agentes-desigual) PRECISARIA falar
 * pra sair de "texto livre" — nunca implementado nem chamado de verdade
 * nesta missão (código-fonte do serviço não está acessível deste
 * ambiente, ver docs/coordination/JARBAS_SENIOR_HANDOFF.md). Existe aqui
 * só como contrato/parser-alvo: o adapter local (jarbas-response-adapter.ts
 * em packages/agent-runtime) sabe reconhecer este formato SE ele um dia
 * chegar, e cai pro formato V1 (`{answer}`) com segurança quando não.
 */
export interface JarbasExternalResponseV2 {
  schemaVersion: '2';
  ok: boolean;
  agent: 'jarbas';
  answer: string;
  scope: {
    organizationId: string;
    clientId: string;
    accountId?: string | null;
    entityType?: MetaEntityType | null;
    entityId?: string | null;
    entityName?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    timezone?: string | null;
  };
  metricFacts: MetricFact[];
  comparisons: MetricComparison[];
  observations: string[];
  hypotheses: string[];
  recommendations: Recommendation[];
  missingData: string[];
  proposedActions: ProposedAction[];
  sourceTrace: SourceTraceEntry[];
  toolTrace: ToolTraceEntry[];
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  fetchedAt?: string | null;
  errors?: string[];
}

export interface ToolTraceEntry {
  toolName: string;
  operation: string;
  entityId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: 'ok' | 'error';
  durationMs: number;
  resultRef: string | null;
}

/** Formato legado — o único que o serviço externo fala de fato hoje. */
export interface JarbasExternalResponseV1 {
  answer: string;
}
