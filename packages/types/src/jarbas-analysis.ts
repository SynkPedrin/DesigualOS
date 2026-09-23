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
export interface JarbasAnalysisResult {
  schemaVersion: 1;
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
 * ao Jarbas. NÃO existe mecanismo de despacho/persistência disto hoje (nem
 * tabela, nem fila, nem rota): é só o formato de dados que esse mecanismo
 * precisaria falar quando for construído. Construir o mecanismo em si
 * (tabela, lifecycle, idempotência) é trabalho de produto novo, fora do
 * escopo desta missão de hardening.
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
  dueAt: string | null;
  status: AgentTaskStatus;
}
