import type { ConversationResourceState, StructuredAction } from './types.js';
import { evaluateCardinality, type CardinalityRecord } from './types.js';

/**
 * §5 da missão: "The model proposes. Code validates. Policy DOES NOT parse
 * natural Portuguese. It validates the structured action." Tudo aqui é
 * determinístico — nenhuma chamada de LLM, nenhuma heurística de texto.
 */
export interface PolicyContext {
  actorHasClickUpWrite: boolean;
  agentHasClickUpWrite: boolean;
  mutationsThisExecution: number;
  maxMutationsPerExecution: number;
  /** true quando o usuário confirmou explicitamente um plano com cardinalidade > 1 num turno anterior. */
  explicitMultiActionConfirmed: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  cardinality: CardinalityRecord;
  /** resourceId resolvido (do estado da conversa) quando target.resourceId veio null do planner. */
  resolvedResourceId: string | null;
}

const WRITE_INTENTS = new Set<StructuredAction['intent']>(['create_task', 'update_task', 'comment_task']);

/**
 * §3: prioridade de resolução — id explícito primeiro, nunca busca global.
 * Retorna null quando nada no estado resolve a referência (o call site deve
 * pedir esclarecimento, não seguir pra um lookup global).
 */
export function resolveTargetResourceId(action: StructuredAction, state: ConversationResourceState): string | null {
  if (action.target?.resourceId) return action.target.resourceId;
  if (!action.target) return null;
  if (state.focusedResource) return state.focusedResource.resourceId;
  if (state.selectedResources.length === 1) return state.selectedResources[0]!.resourceId;
  if (state.lastExecution && state.lastExecution.resourceIds.length === 1) return state.lastExecution.resourceIds[0]!;
  return null;
}

export function validateBentoAction(action: StructuredAction, state: ConversationResourceState, ctx: PolicyContext): PolicyDecision {
  const isWrite = WRITE_INTENTS.has(action.intent);
  const resolvedResourceId = isWrite || action.intent === 'get_task' ? resolveTargetResourceId(action, state) : null;

  // §4: cardinalidade. Leitura/análise não muta nada — plannedCardinality é sempre 0 pra esses intents.
  const plannedCardinality = action.intent === 'create_task' ? 1 : 0;
  const cardinality = evaluateCardinality(action.requestedCardinality, plannedCardinality);

  if (!isWrite) {
    return { allowed: true, reason: 'leitura/análise não muta nada', cardinality, resolvedResourceId };
  }

  if (cardinality.blocked && !ctx.explicitMultiActionConfirmed) {
    return { allowed: false, reason: cardinality.blockReason ?? 'cardinalidade bloqueada', cardinality, resolvedResourceId };
  }

  if (!ctx.agentHasClickUpWrite || !ctx.actorHasClickUpWrite) {
    return { allowed: false, reason: 'permission_denied: clickup:write ausente (ator ou agente)', cardinality, resolvedResourceId };
  }

  if ((action.intent === 'update_task' || action.intent === 'comment_task') && !resolvedResourceId) {
    return {
      allowed: false,
      reason: 'target_unresolved: a referência ("essa"/"ela"/...) não resolveu contra o estado da conversa — pedir esclarecimento, nunca busca global',
      cardinality,
      resolvedResourceId,
    };
  }

  if (ctx.mutationsThisExecution >= ctx.maxMutationsPerExecution) {
    return { allowed: false, reason: `mutation_budget_exceeded: limite de ${ctx.maxMutationsPerExecution} mutações por execução`, cardinality, resolvedResourceId };
  }

  return { allowed: true, reason: 'ok', cardinality, resolvedResourceId };
}
