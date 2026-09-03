/**
 * Preço por milhão de tokens, em USD. Valores aproximados de tabelas
 * públicas dos provedores; preços de LLM mudam com frequência, isso
 * precisa de revisão periódica, não é fonte de verdade financeira.
 * O Node ainda não devolve qual modelo o OpenClaw usou de fato (ver Fase
 * 04), então a maioria das execuções cai no fallback 'unknown' por
 * enquanto: custo aproximado, nunca exato, até esse dado chegar de verdade.
 */
const PRICING_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'gpt-4o': { input: 2.5, output: 10 },
  unknown: { input: 3, output: 15 }, // assume nível Sonnet até termos o modelo real
};

export interface CostBreakdown {
  amountUsd: number;
  pricingSource: 'known' | 'fallback';
}

export function computeCost(model: string, inputTokens: number, outputTokens: number): CostBreakdown {
  const pricing = PRICING_PER_MILLION_TOKENS_USD[model];
  const rates = pricing ?? PRICING_PER_MILLION_TOKENS_USD.unknown;
  if (!rates) {
    throw new Error('Missing fallback pricing entry');
  }

  const amountUsd = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;

  return { amountUsd: Number(amountUsd.toFixed(6)), pricingSource: pricing ? 'known' : 'fallback' };
}
