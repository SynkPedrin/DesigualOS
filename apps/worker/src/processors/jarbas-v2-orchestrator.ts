import { askJarbasV2, type AgentTaskStore } from '@desigual-os/agent-runtime';
import type { AgentTask, JarbasAnalysisResult, MetricFact } from '@desigual-os/types';

/**
 * jarbas-v2-orchestrator.ts — fecha o fluxo real (§13 da missão de
 * wiring): AgentTask persistida -> ACK -> contexto resolvido -> V2 real
 * -> MetricFacts -> verificação -> resultado persistido -> READY_FOR_REVIEW.
 *
 * Escopo DELIBERADAMENTE mínimo pra esta missão de fechamento: o resultado
 * reporta os FATOS do período pedido (spend/impressions/clicks/ctr/...),
 * nunca inventa comparação de período anterior — isso exigiria uma SEGUNDA
 * chamada V2 (janela anterior) que esta missão não pediu. A árvore de
 * diagnóstico fato-vs-hipótese (jarbas-diagnosis.ts) já existe e continua
 * disponível pra quando o orquestrador ganhar essa segunda chamada; não
 * forçada aqui sobre dado que não temos.
 */

export interface JarbasV2OrchestratorConfig {
  url: string;
  token: string;
  timeoutMs?: number;
}

export type RunJarbasV2Outcome =
  | { ok: true; task: AgentTask; result: JarbasAnalysisResult; answer: string }
  | { ok: false; reason: string; task: AgentTask | null };

function extractAccountId(task: AgentTask): string | null {
  const ref = task.entityRefs.find((r) => r.type === 'account');
  return ref?.id ?? null;
}

function summarizeFacts(facts: MetricFact[]): { totals: Record<string, number>; entityCount: number } {
  const totals: Record<string, number> = {};
  const entities = new Set<string>();
  for (const f of facts) {
    entities.add(f.entityId);
    if (['spend', 'impressions', 'clicks', 'leads', 'purchases'].includes(f.metric)) {
      totals[f.metric] = (totals[f.metric] ?? 0) + f.value;
    }
  }
  return { totals, entityCount: entities.size };
}

/**
 * §21: resumo executivo primeiro, fato separado de hipótese, sem certeza
 * não sustentada, nada de despejo de JSON cru.
 */
export function formatExecutiveAnswer(task: AgentTask, result: JarbasAnalysisResult, metricVerified: boolean): string {
  const { totals, entityCount } = summarizeFacts(result.metricFacts);
  const linhas: string[] = [];
  linhas.push(`Análise de ${task.scope} concluída.`);
  if (result.metricFacts.length === 0) {
    linhas.push('Não encontrei dado de performance real pra esse período — pode ser que não houve veiculação, ou a conta/janela pedida não tem histórico aqui.');
  } else {
    linhas.push(`Dados reais de ${entityCount} campanha(s), fonte: Meta Ads (${metricVerified ? 'métrica principal verificada de forma independente' : 'sem verificação numérica cruzada nesta amostra'}).`);
    if (totals.spend !== undefined) linhas.push(`Investimento total no período: R$${totals.spend.toFixed(2)}.`);
    if (totals.impressions !== undefined) linhas.push(`Impressões: ${Math.round(totals.impressions).toLocaleString('pt-BR')}.`);
    if (totals.clicks !== undefined) linhas.push(`Cliques: ${Math.round(totals.clicks).toLocaleString('pt-BR')}.`);
    if (totals.leads !== undefined) linhas.push(`Leads: ${Math.round(totals.leads)}.`);
  }
  if (result.missingData.length > 0) linhas.push(`O que falta: ${result.missingData.join('; ')}.`);
  linhas.push('Isso é o que os dados mostram no período — não fiz nenhuma alteração de campanha.');
  return linhas.join(' ');
}

export async function runJarbasV2Task(
  store: AgentTaskStore,
  taskId: string,
  organizationId: string,
  config: JarbasV2OrchestratorConfig,
): Promise<RunJarbasV2Outcome> {
  const task0 = await store.get(taskId);
  if (!task0) return { ok: false, reason: 'task não encontrada', task: null };

  const ack = await store.transition(taskId, 'acknowledged', organizationId);
  if (!ack.ok) return { ok: false, reason: `ack falhou: ${ack.reason}`, task: task0 };

  const resolved = await store.transition(taskId, 'context_resolved', organizationId);
  if (!resolved.ok) return { ok: false, reason: `context_resolved falhou: ${resolved.reason}`, task: ack.task };

  const accountId = extractAccountId(resolved.task);
  const timeWindow = resolved.task.timeWindow;
  if (!accountId || !timeWindow) {
    const blocked = await store.transition(taskId, 'blocked_needs_data', organizationId);
    return { ok: false, reason: 'accountId ou timeWindow ausente na tarefa', task: blocked.ok ? blocked.task : resolved.task };
  }

  const analyzing = await store.transition(taskId, 'analyzing', organizationId);
  if (!analyzing.ok) return { ok: false, reason: `analyzing falhou: ${analyzing.reason}`, task: resolved.task };

  const v2 = await askJarbasV2(config, {
    text: analyzing.task.objective,
    sessionId: `agent-task:${taskId}`,
    scope: {
      organizationId,
      clientId: analyzing.task.clientId,
      accountId,
      periodStart: timeWindow.start,
      periodEnd: timeWindow.end,
    },
  });

  if (v2.status === 'unavailable') {
    // §9 — NUNCA cai pro legado :3102 nem apresenta prosa como verificada.
    await store.recordFailure(taskId, v2.reason, organizationId);
    const current = await store.get(taskId);
    return { ok: false, reason: `V2 indisponível: ${v2.reason}`, task: current };
  }

  const verifying = await store.transition(taskId, 'verifying', organizationId);
  if (!verifying.ok) return { ok: false, reason: `verifying falhou: ${verifying.reason}`, task: analyzing.task };

  const result: JarbasAnalysisResult = {
    schemaVersion: 1,
    taskId,
    taskVersion: verifying.task.version,
    provenanceAvailable: v2.adapted.provenanceAvailable,
    scope: {
      organizationId,
      clientId: verifying.task.clientId,
      accountId,
      entityType: 'campaign',
      entityId: null,
      periodStart: verifying.task.timeWindow?.start ?? null,
      periodEnd: verifying.task.timeWindow?.end ?? null,
    },
    claims: [],
    metricFacts: v2.adapted.v2?.metricFacts ?? [],
    comparisons: [],
    recommendations: [],
    proposedActions: v2.adapted.v2?.proposedActions ?? [],
    missingData: v2.adapted.v2?.missingData ?? [],
    risks: [],
    sourceTrace: v2.adapted.v2?.sourceTrace ?? [],
    analysisConfidence: v2.metricVerified ? 'medium' : 'insufficient_data',
  };

  const attach = await store.attachResult(taskId, result, organizationId);
  if (!attach.ok) return { ok: false, reason: `attachResult falhou: ${attach.reason}`, task: verifying.task };

  const done = await store.transition(taskId, 'ready_for_review', organizationId);
  if (!done.ok) return { ok: false, reason: `ready_for_review falhou: ${done.reason}`, task: attach.task };

  return { ok: true, task: done.task, result, answer: formatExecutiveAnswer(done.task, result, v2.metricVerified) };
}
