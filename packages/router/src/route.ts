import type { FastifyBaseLogger } from 'fastify';
import { classifyWithLLM } from './classifier';
import { matchRule } from './rules';
import { routerDecisionSchema, type RouterDecision } from './schema';

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Pipeline de 4 etapas em camadas (seção 6.2): intent detection via rule
 * engine primeiro (barato); só cai pro classifier (LLM) se a confiança for
 * baixa. context vem vazio aqui porque montar o contexto de verdade é
 * trabalho do Context Engine (Fase 11), o Router só aponta o que seria
 * necessário buscar.
 */
export async function route(message: string, logger: FastifyBaseLogger): Promise<RouterDecision> {
  const ruleMatch = matchRule(message);

  if (ruleMatch && ruleMatch.confidence >= CONFIDENCE_THRESHOLD) {
    return routerDecisionSchema.parse({
      intent: ruleMatch.rule.intent,
      primary_agent: ruleMatch.rule.primaryAgent,
      required_tools: ruleMatch.rule.requiredTools,
      context: [],
      estimated_complexity: ruleMatch.rule.complexity,
      workflow: ruleMatch.rule.workflow ?? null,
      confidence: ruleMatch.confidence,
      source: 'rule_engine',
    });
  }

  const classified = await classifyWithLLM(message, logger);
  if (classified) {
    return routerDecisionSchema.parse({
      intent: classified.intent,
      primary_agent: classified.primary_agent,
      required_tools: classified.required_tools,
      context: [],
      estimated_complexity: classified.estimated_complexity,
      workflow: classified.workflow,
      confidence: 0.5,
      source: 'classifier',
    });
  }

  // Nem regra bateu nem o classifier respondeu (sem API key, por exemplo).
  // Fallback seguro: bento, porque é o agente de conhecimento geral,
  // baixa confiança pra deixar claro que isso é um chute, não uma decisão.
  return routerDecisionSchema.parse({
    intent: 'unclassified',
    primary_agent: 'bento',
    required_tools: [],
    context: [],
    estimated_complexity: 'low',
    workflow: null,
    confidence: ruleMatch?.confidence ?? 0,
    source: 'rule_engine',
  });
}
