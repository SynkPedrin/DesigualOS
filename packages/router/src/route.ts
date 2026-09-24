import type { FastifyBaseLogger } from 'fastify';
import type { AgentName } from '@desigual-os/types';
import { classifyWithLLM } from './classifier';
import { classifyLocally } from './local-classifier';
import { matchRule } from './rules';
import { routerDecisionSchema, type RouterDecision } from './schema';

const CONFIDENCE_THRESHOLD = 0.7;

const AGENT_NAME_RE = '(bento|jarbas|suzy|studio|otto)';

/**
 * Menção explícita (@jarbas, @Suzy...) vence qualquer camada: quem menciona já escolheu o
 * agente (pedido do usuário, 2026-09-04).
 *
 * Endereçamento direto no INÍCIO da frase ("Jarbas, tudo certo?", "Bento, quem é você?") conta
 * como menção explícita também, sem precisar de @ — bug real medido ao vivo em 09/09/2026,
 * testado através do chat de verdade: "Jarbas, tudo certo?" caiu no classifier e foi respondido
 * pelo Bento, não pelo Jarbas. Isso é exatamente o padrão que os próprios exemplos do produto
 * usam sem @ ("Jarbas, como estão as campanhas da 3NET hoje?"), então sem isso a prioridade de
 * menção explícita nunca disparava pra ninguém que escrevesse do jeito natural.
 *
 * Só a PRIMEIRA palavra conta, de propósito: "me atualiza sobre o que o Jarbas fez ontem" cita
 * o nome no meio da frase, mas pode ser uma pergunta PRA outro agente (ex: Bento) SOBRE o
 * Jarbas — tratar isso como menção explícita ao Jarbas estaria errado na direção oposta.
 * Limitação aceita conhecida: uma frase que começa com o nome em 3ª pessoa ("Suzy é uma boa
 * secretária, não acha?") também bateria aqui — mais raro em português que o padrão de
 * endereçamento direto que isto existe pra cobrir.
 */
export function detectMentionedAgent(message: string): AgentName | null {
  const arroba = message.match(new RegExp(`@${AGENT_NAME_RE}\\b`, 'i'));
  if (arroba?.[1]) return arroba[1].toLowerCase() as AgentName;

  const vocativo = message.trim().match(new RegExp(`^${AGENT_NAME_RE}\\s*[,:]?\\s`, 'i'));
  if (vocativo?.[1]) return vocativo[1].toLowerCase() as AgentName;

  return null;
}

/**
 * Pipeline de 4 etapas em camadas (seção 6.2): intent detection via rule
 * engine primeiro (barato); só cai pro classifier (LLM) se a confiança for
 * baixa. context vem vazio aqui porque montar o contexto de verdade é
 * trabalho do Context Engine (Fase 11), o Router só aponta o que seria
 * necessário buscar.
 */
export async function route(message: string, logger: FastifyBaseLogger): Promise<RouterDecision> {
  const mentioned = detectMentionedAgent(message);
  if (mentioned) {
    return routerDecisionSchema.parse({
      intent: 'direct_mention',
      primary_agent: mentioned,
      required_tools: [],
      context: [],
      estimated_complexity: 'medium',
      workflow: null,
      confidence: 1,
      source: 'manual',
    });
  }

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

  /**
   * Classifier LOCAL antes da paga. A paga nunca teve chave em produção, e
   * sem ela tudo que o rule engine não decidia caía no Bento — inclusive
   * pergunta de mídia paga, que o Bento responde com dado de vault de outro
   * mês e, num caso medido, de outro cliente. Um modelo 3B local decide isso
   * em ~0,1s.
   */
  const local = await classifyLocally(message, logger);
  if (local) {
    return routerDecisionSchema.parse({
      intent: 'local_classifier',
      primary_agent: local.agent,
      required_tools: [],
      context: [],
      estimated_complexity: 'medium',
      workflow: null,
      confidence: local.confidence,
      source: 'classifier',
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

  /**
   * Nenhuma camada decidiu: nem regra, nem classifier local, nem a paga.
   *
   * O fallback ANTES era "manda pro Bento" — e foi exatamente isso que fez
   * pergunta de mídia paga ser respondida com dado de vault, inclusive de
   * outro cliente. Chutar o agente é pior que perguntar: agora o turno vira
   * um pedido de esclarecimento, tratado no worker sem tocar em vault nem em
   * ferramenta nenhuma (execute-job.ts, caminho `needs_routing_clarification`).
   * O agente segue 'bento' só porque a fila precisa de um nome válido; o
   * intent é o que manda.
   */
  return routerDecisionSchema.parse({
    intent: 'needs_routing_clarification',
    primary_agent: 'bento',
    required_tools: [],
    context: [],
    estimated_complexity: 'low',
    workflow: null,
    confidence: ruleMatch?.confidence ?? 0,
    source: 'rule_engine',
  });
}
