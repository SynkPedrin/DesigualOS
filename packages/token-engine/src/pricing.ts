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

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostBreakdown {
  const pricing = PRICING_PER_MILLION_TOKENS_USD[model];
  const rates = pricing ?? PRICING_PER_MILLION_TOKENS_USD.unknown;
  if (!rates) {
    throw new Error('Missing fallback pricing entry');
  }

  const amountUsd =
    (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;

  return { amountUsd: Number(amountUsd.toFixed(6)), pricingSource: pricing ? 'known' : 'fallback' };
}

/** ~4 caracteres por token, mesma aproximação usada em execute-job.ts pra medir uso real depois - aqui é a mesma régua aplicada ANTES da chamada existir. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Multiplicador de tokens de saída por token de entrada. Não é medido, é um
 * chute documentado: os TRÊS agentes de produção (Bento/Jarbas/Suzy) tendem
 * a responder mais curto que a pergunta (WhatsApp/chat, não ensaio), então
 * 0.6 é conservador pra não superestimar sistematicamente. Existe só pra dar
 * a `economy_records` (estimado vs real) um número ANTES de saber a
 * resposta - o valor real de output é sempre medido de verdade depois.
 */
const ESTIMATED_OUTPUT_RATIO = 0.6;

/**
 * Estimativa de custo ANTES da chamada existir, pra alimentar
 * `executions.estimated_cost` / `economy_records` (comparado com o custo
 * real depois de `computeCost`). Existe desde 08/09/2026 - antes disso a
 * tabela `economy_records` era migrada no banco mas nunca escrita por
 * nenhum código: não havia estimativa nenhuma pra comparar com o real.
 */
export function estimateCost(
  model: string,
  inputText: string,
): { estimatedInputTokens: number; estimatedOutputTokens: number; amountUsd: number } {
  const estimatedInputTokens = Math.ceil(inputText.length / CHARS_PER_TOKEN_ESTIMATE);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * ESTIMATED_OUTPUT_RATIO);
  const { amountUsd } = computeCost(model, estimatedInputTokens, estimatedOutputTokens);
  return { estimatedInputTokens, estimatedOutputTokens, amountUsd };
}
