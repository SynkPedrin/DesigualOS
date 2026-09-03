import type { AgentName, ExecutionComplexity } from '@desigual-os/types';

export interface RoutingRule {
  intent: string;
  keywords: string[];
  primaryAgent: AgentName;
  requiredTools: string[];
  complexity: ExecutionComplexity;
  workflow?: AgentName[];
}

/**
 * Regras do rule engine (camada barata do Router, seção 6.2). Cobrem os
 * exemplos de intent citados no prompt mestre: content_creation,
 * campaign_analysis/campaign_creation, internal_process/knowledge_query,
 * social_selling, hybrid_workflow. Baseado em substring match em português,
 * suficiente pro rule engine; frases fora disso caem pro classifier (LLM).
 */
export const ROUTING_RULES: RoutingRule[] = [
  {
    intent: 'campaign_creation',
    keywords: ['campanha completa', 'crie uma campanha', 'nova campanha para', 'criar campanha'],
    primaryAgent: 'bento',
    requiredTools: [],
    complexity: 'high',
    workflow: ['bento', 'jarbas', 'studio', 'bento'],
  },
  {
    intent: 'campaign_analysis',
    keywords: [
      'como está a campanha',
      'performance da campanha',
      'resultado dos anúncios',
      'cpl',
      'cpa',
      'roas',
      'ctr',
      'métricas de tráfego',
    ],
    primaryAgent: 'jarbas',
    requiredTools: ['meta_ads'],
    complexity: 'medium',
  },
  {
    intent: 'content_creation',
    keywords: [
      'crie uma imagem',
      'gere um carrossel',
      'gerar carrossel',
      'preciso de um criativo',
      'gerar vídeo',
      'gerar reels',
      'fazer upscale',
    ],
    primaryAgent: 'studio',
    requiredTools: ['gpu'],
    complexity: 'medium',
  },
  {
    intent: 'social_selling',
    keywords: [
      'responder o lead',
      'qualificar lead',
      'agendar reunião',
      'mensagem no whatsapp',
      'follow-up com o cliente',
    ],
    primaryAgent: 'suzy',
    requiredTools: ['whatsapp'],
    complexity: 'low',
  },
  {
    intent: 'knowledge_query',
    keywords: ['qual é o processo', 'onboarding do cliente', 'sop de', 'histórico do cliente', 'como fazemos'],
    primaryAgent: 'bento',
    requiredTools: ['clickup'],
    complexity: 'low',
  },
];

export interface RuleMatch {
  rule: RoutingRule;
  confidence: number;
}

/**
 * Confiança simples por contagem de keywords batidas; 0 keywords = sem match.
 * Um match único e forte (>=1 keyword) já é confiança alta o suficiente pra
 * não gastar chamada de LLM; é exatamente o ponto do rule engine existir.
 */
export function matchRule(message: string): RuleMatch | null {
  const normalized = message.toLowerCase();
  let best: RuleMatch | null = null;

  for (const rule of ROUTING_RULES) {
    const hits = rule.keywords.filter((keyword) => normalized.includes(keyword)).length;
    if (hits === 0) continue;
    const confidence = Math.min(1, 0.7 + hits * 0.15);
    if (!best || confidence > best.confidence) {
      best = { rule, confidence };
    }
  }

  return best;
}
