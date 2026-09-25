import { describe, expect, it } from 'vitest';
import { budgetTierFromUsage, computeOpenAICost, pickModel } from './models.js';

describe('budgetTierFromUsage', () => {
  it('classifica as faixas da seção 6', () => {
    expect(budgetTierFromUsage(0, 12)).toBe('normal');
    expect(budgetTierFromUsage(8.5, 12)).toBe('restrict_sol'); // 70.8%
    expect(budgetTierFromUsage(10.3, 12)).toBe('luna_mostly'); // 85.8%
    expect(budgetTierFromUsage(11.5, 12)).toBe('luna_only'); // 95.8%
    expect(budgetTierFromUsage(12, 12)).toBe('exhausted');
  });
});

describe('pickModel', () => {
  it('usa terra para escrita ClickUp em orçamento normal', () => {
    const decision = pickModel('clickup_write', 'normal');
    expect(decision.model).toBe('gpt-5.6-terra');
    expect(decision.downgraded).toBe(false);
  });

  it('nunca escolhe sol automaticamente acima de 70% de orçamento', () => {
    const decision = pickModel('otto_creative_difficult', 'restrict_sol');
    expect(decision.model).toBe('gpt-5.6-terra');
    expect(decision.downgraded).toBe(true);
  });

  it('cai para luna-only acima de 95%, mesmo para tarefa de escrita', () => {
    const decision = pickModel('clickup_write', 'luna_only');
    expect(decision.model).toBe('gpt-5.6-luna');
  });

  it('nunca troca silenciosamente de provider ao esgotar: sinaliza no reason', () => {
    const decision = pickModel('otto_creative_difficult', 'exhausted');
    expect(decision.model).toBe('gpt-5.6-luna');
    expect(decision.reason).toContain('budget_exhausted');
  });
});

describe('computeOpenAICost', () => {
  it('cobra tokens cacheados na tarifa reduzida, não na tarifa cheia', () => {
    const cost = computeOpenAICost('gpt-5.6-terra', {
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 0,
    });
    // 500k a 2.00/M + 500k a 0.20/M
    expect(cost).toBeCloseTo(1.0 + 0.1, 5);
  });
});
