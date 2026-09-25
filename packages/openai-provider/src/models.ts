/**
 * Modelos GPT-5.6 e política de roteamento (missão de release OpenAI +
 * ClickUp MCP, seção 5). Preços confirmados em developers.openai.com/api/docs/pricing
 * (2026-09-25), USD por 1M tokens, tier padrão (não long-context):
 *
 *   luna:  input 0.20 | cached 0.02 | output 1.20
 *   terra: input 2.00 | cached 0.20 | output 12.00
 *   sol:   input 4.00 | cached 0.40 | output 20.00
 */
export const OPENAI_MODELS = {
  luna: 'gpt-5.6-luna',
  terra: 'gpt-5.6-terra',
  sol: 'gpt-5.6-sol',
} as const;

export type OpenAIModelTier = keyof typeof OPENAI_MODELS;
export type OpenAIModelId = (typeof OPENAI_MODELS)[OpenAIModelTier];

export const OPENAI_MODEL_PRICING_PER_MILLION_USD: Record<
  OpenAIModelId,
  { input: number; cachedInput: number; output: number }
> = {
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
};

/**
 * Tipo de tarefa que o chamador está pedindo — não é o agente (Bento/Otto),
 * é a NATUREZA da chamada, conforme seção 5 da missão. O agente escolhe o
 * tipo, este módulo escolhe o modelo.
 */
export type OpenAITaskKind =
  | 'simple_read'
  | 'simple_extraction'
  | 'simple_routing'
  | 'clickup_write'
  | 'ambiguous_instruction'
  | 'multi_tool_planning'
  | 'operational_analysis'
  | 'otto_creative_normal'
  | 'otto_creative_difficult'
  | 'explicit_high_quality_final';

/** Faixas de orçamento mensal consumido, seção 6 (Cost escalation policy). */
export type BudgetTier = 'normal' | 'restrict_sol' | 'luna_mostly' | 'luna_only' | 'exhausted';

export function budgetTierFromUsage(spentUsd: number, monthlyCapUsd: number): BudgetTier {
  if (monthlyCapUsd <= 0) return 'exhausted';
  const pct = (spentUsd / monthlyCapUsd) * 100;
  if (pct >= 100) return 'exhausted';
  if (pct >= 95) return 'luna_only';
  if (pct >= 85) return 'luna_mostly';
  if (pct >= 70) return 'restrict_sol';
  return 'normal';
}

const BASE_TIER_BY_TASK: Record<OpenAITaskKind, OpenAIModelTier> = {
  simple_read: 'luna',
  simple_extraction: 'luna',
  simple_routing: 'luna',
  clickup_write: 'terra',
  ambiguous_instruction: 'terra',
  multi_tool_planning: 'terra',
  operational_analysis: 'terra',
  otto_creative_normal: 'terra',
  otto_creative_difficult: 'sol',
  explicit_high_quality_final: 'sol',
};

export interface ModelRoutingDecision {
  tier: OpenAIModelTier;
  model: OpenAIModelId;
  /** true quando o tier pedido foi rebaixado por política de orçamento. */
  downgraded: boolean;
  reason: string;
}

/**
 * Escolhe o modelo para uma chamada, aplicando a escada de degradação por
 * orçamento (seção 6). Nunca escala PARA CIMA por conta própria — só
 * rebaixa. `sol` nunca é escolha automática fora de `otto_creative_difficult`
 * / `explicit_high_quality_final`, e mesmo assim é bloqueado acima de 70%.
 */
export function pickModel(taskKind: OpenAITaskKind, budgetTier: BudgetTier): ModelRoutingDecision {
  const baseTier = BASE_TIER_BY_TASK[taskKind];

  if (budgetTier === 'exhausted') {
    return {
      tier: 'luna',
      model: OPENAI_MODELS.luna,
      downgraded: baseTier !== 'luna',
      reason:
        'budget_exhausted: orçamento mensal esgotado (>=100%). Reserva de emergência não deve ser queimada silenciosamente — isto exige aviso operacional/admin, não apenas modelo mais barato.',
    };
  }

  if (budgetTier === 'luna_only') {
    return {
      tier: 'luna',
      model: OPENAI_MODELS.luna,
      downgraded: baseTier !== 'luna',
      reason: 'budget>=95%: Luna para quase tudo, salvo override explícito de admin.',
    };
  }

  if (budgetTier === 'luna_mostly') {
    if (baseTier === 'sol') {
      return {
        tier: 'terra',
        model: OPENAI_MODELS.terra,
        downgraded: true,
        reason: 'budget 85-95%: Sol desabilitado, Terra cobre escritas/raciocínio complexo.',
      };
    }
    return { tier: baseTier, model: OPENAI_MODELS[baseTier], downgraded: false, reason: 'budget 85-95%: mantém tier base (não-Sol).' };
  }

  if (budgetTier === 'restrict_sol' && baseTier === 'sol') {
    return {
      tier: 'terra',
      model: OPENAI_MODELS.terra,
      downgraded: true,
      reason: 'budget 70-85%: Sol automático desabilitado.',
    };
  }

  return { tier: baseTier, model: OPENAI_MODELS[baseTier], downgraded: false, reason: 'budget<70%: política normal.' };
}

export interface UsageTokens {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Custo real a partir de uso RETORNADO pela OpenAI — nunca a partir de estimativa pré-request. */
export function computeOpenAICost(model: OpenAIModelId, usage: UsageTokens): number {
  const pricing = OPENAI_MODEL_PRICING_PER_MILLION_USD[model];
  const billedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const amount =
    (billedInput / 1_000_000) * pricing.input +
    (usage.cachedInputTokens / 1_000_000) * pricing.cachedInput +
    (usage.outputTokens / 1_000_000) * pricing.output;
  return Number(amount.toFixed(6));
}

/** Limites de tokens de saída por agente/complexidade, seção 9. */
export const OUTPUT_TOKEN_LIMITS = {
  bento_simple: 400,
  bento_complex: 800,
  otto: 1400,
} as const;

/** Seção 20: teto de passos de tool-loop por request. */
export const MAX_TOOL_STEPS = 6;
