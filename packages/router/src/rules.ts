import type { AgentName, ExecutionComplexity } from '@desigual-os/types';

export interface RoutingRule {
  intent: string;
  /** Frases que expressam INTENÇÃO ("performance da campanha", "cpa"). Uma só já basta
   * pra decidir sem gastar chamada de LLM. */
  keywords: string[];
  /**
   * Palavras que indicam só o ASSUNTO, não a intenção ("campanha", "copy", "criativo").
   * Contam pouco de propósito: sozinhas ficam ABAIXO do limiar de escalonamento, então a
   * decisão vai pro classifier em vez de ser cravada pela regra.
   *
   * Por que isso existe (bug real medido em 10/09/2026): `creative_direction` tinha
   * 'campanha' e 'copy' como keyword normal, e o match era substring solto valendo 0.85 —
   * acima do limiar de 0.7. Efeito: "qual cliente tem a melhor CAMPANHA hoje?" era
   * roteirizada pro Otto (direção criativa) com confiança alta e o classifier nunca era
   * consultado, quando a pergunta é de performance cross-client (Jarbas). O usuário só não
   * viu isso sempre porque escrevia "Jarbas, ..." e a detecção de menção passa na frente.
   */
  topicKeywords?: string[];
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
      // Comparação de performance ENTRE clientes é leitura de mídia paga, não direção
      // criativa. Sem estas, "qual cliente tem a melhor campanha" caía em creative_direction
      // por causa da palavra solta "campanha".
      'melhor campanha',
      'pior campanha',
      'melhor resultado',
      'campanha que merece escala',
      'fadiga de criativo',
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
    // Direção criativa (pensar) é Otto; gerar a mídia em si (executar) segue
    // sendo Studio. Em empate de confiança vale a regra que vem antes aqui,
    // então "gere um carrossel" continua indo direto pro Studio.
    intent: 'creative_direction',
    /**
     * O nome do ENTREGÁVEL criativo é sinal FORTE, não fraco.
     *
     * topicKeywords tem teto de 0,65 e o Router só decide a partir de 0,70:
     * sinal fraco existe pra ESCALAR pro classifier. Só que o classifier está
     * indisponível em produção (ANTHROPIC_API_KEY vazia), então tudo que
     * depende dele cai no fallback — que é o Bento. Medido no front em
     * 24/09/2026: "faz 2 legendas pro aniversário da Cosentino" foi parar no
     * Bento, que respondeu com a data de fundação tirada do vault e zero
     * legendas.
     *
     * Aqui ficam só os substantivos que NÃO são ambíguos na fala da agência:
     * pedir legenda, título, headline, hook, copy ou roteiro é pedir peça
     * criativa, ponto. 'campanha', 'conceito' e 'posts' seguem fracos de
     * propósito — "como está a campanha" é leitura de mídia paga (Jarbas).
     */
    keywords: [
      'direção de arte',
      'identidade visual',
      'prompt de imagem',
      'conceito criativo',
      'direção criativa',
      'legenda',
      'legendas',
      'titulo',
      'título',
      'titulos',
      'títulos',
      'headline',
      'headlines',
      'hook',
      'hooks',
      'tagline',
      'roteiro',
      'roteiros',
      'carrossel',
      'copys',
      'copies',
    ],
    topicKeywords: ['campanha', 'conceito', 'copy', 'criativo', 'reels', 'posts'],
    primaryAgent: 'otto',
    requiredTools: ['studio'],
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
 * Confiança por contagem de keywords batidas, com peso diferente para intenção e assunto.
 *
 * - keyword de INTENÇÃO: 0.7 + 0.15 por hit -> acima do limiar, decide sem LLM.
 * - só keyword de ASSUNTO: 0.45 + 0.05 por hit -> ABAIXO do limiar de propósito, pra que
 *   `route()` escale pro classifier em vez de cravar o agente pela palavra solta.
 *
 * O limiar de escalonamento vive em route.ts (RULE_CONFIDENCE_THRESHOLD); manter estes
 * números abaixo dele é o que faz a escalada acontecer.
 */
export function matchRule(message: string): RuleMatch | null {
  const normalized = message.toLowerCase();
  let best: RuleMatch | null = null;

  for (const rule of ROUTING_RULES) {
    const strong = rule.keywords.filter((keyword) => normalized.includes(keyword)).length;
    const weak = (rule.topicKeywords ?? []).filter((keyword) => normalized.includes(keyword)).length;
    if (strong === 0 && weak === 0) continue;
    const confidence =
      strong > 0 ? Math.min(1, 0.7 + strong * 0.15) : Math.min(0.65, 0.45 + weak * 0.05);
    if (!best || confidence > best.confidence) {
      best = { rule, confidence };
    }
  }

  return best;
}
