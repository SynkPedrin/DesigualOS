import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AgentName } from '@desigual-os/types';
import { computeOpenAICost } from './models.js';
import type { OpenAIModelId, UsageTokens } from './models.js';
import { BUDGET_CONFIG } from './budget.js';
import { budgetTierFromUsage, type BudgetTier } from './models.js';

/**
 * Cost ledger (seção 11 da missão). Uma linha por chamada real à OpenAI,
 * custo computado a partir do uso RETORNADO pela API (nunca de estimativa
 * pré-request — regra explícita da seção 11).
 */
export interface RecordUsageParams {
  organizationId?: string | null;
  userId?: string | null;
  agent?: AgentName | null;
  conversationId?: string | null;
  model: OpenAIModelId;
  usage: UsageTokens;
  requestType: string;
  toolSteps?: number;
  metadata?: Record<string, unknown>;
}

export async function recordOpenAIUsage(params: RecordUsageParams): Promise<{ costUsd: number }> {
  const costUsd = computeOpenAICost(params.model, params.usage);

  await db.insert(schema.aiUsageLedger).values({
    organizationId: params.organizationId ?? null,
    userId: params.userId ?? null,
    agent: params.agent ?? null,
    conversationId: params.conversationId ?? null,
    model: params.model,
    provider: 'openai',
    inputTokens: params.usage.inputTokens,
    cachedInputTokens: params.usage.cachedInputTokens,
    outputTokens: params.usage.outputTokens,
    costUsd: costUsd.toString(),
    requestType: params.requestType,
    toolSteps: params.toolSteps ?? 0,
    metadata: params.metadata ?? {},
  });

  return { costUsd };
}

async function sumCostSince(sinceIso: string, organizationId?: string | null): Promise<number> {
  const where = organizationId
    ? and(gte(schema.aiUsageLedger.createdAt, new Date(sinceIso)), eq(schema.aiUsageLedger.organizationId, organizationId))
    : gte(schema.aiUsageLedger.createdAt, new Date(sinceIso));

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.aiUsageLedger.costUsd}), 0)` })
    .from(schema.aiUsageLedger)
    .where(where);
  return Number(row?.total ?? 0);
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function dailySpendUsd(organizationId?: string | null): Promise<number> {
  return sumCostSince(startOfTodayIso(), organizationId);
}

export async function monthlySpendUsd(organizationId?: string | null): Promise<number> {
  return sumCostSince(startOfMonthIso(), organizationId);
}

export interface SpendBreakdownRow {
  key: string;
  totalUsd: number;
}

export async function monthlySpendByModel(organizationId?: string | null): Promise<SpendBreakdownRow[]> {
  const where = organizationId
    ? and(gte(schema.aiUsageLedger.createdAt, new Date(startOfMonthIso())), eq(schema.aiUsageLedger.organizationId, organizationId))
    : gte(schema.aiUsageLedger.createdAt, new Date(startOfMonthIso()));

  const rows = await db
    .select({ model: schema.aiUsageLedger.model, total: sql<string>`coalesce(sum(${schema.aiUsageLedger.costUsd}), 0)` })
    .from(schema.aiUsageLedger)
    .where(where)
    .groupBy(schema.aiUsageLedger.model);
  return rows.map((r) => ({ key: r.model, totalUsd: Number(r.total) }));
}

export async function monthlySpendByAgent(organizationId?: string | null): Promise<SpendBreakdownRow[]> {
  const where = organizationId
    ? and(gte(schema.aiUsageLedger.createdAt, new Date(startOfMonthIso())), eq(schema.aiUsageLedger.organizationId, organizationId))
    : gte(schema.aiUsageLedger.createdAt, new Date(startOfMonthIso()));

  const rows = await db
    .select({ agent: schema.aiUsageLedger.agent, total: sql<string>`coalesce(sum(${schema.aiUsageLedger.costUsd}), 0)` })
    .from(schema.aiUsageLedger)
    .where(where)
    .groupBy(schema.aiUsageLedger.agent);
  return rows.map((r) => ({ key: r.agent ?? 'unknown', totalUsd: Number(r.total) }));
}

/**
 * Ponto único de decisão de orçamento pro model router (integra
 * `pickModel`/`budgetTierFromUsage` de `models.ts` com o gasto real
 * gravado no ledger). Cai para `'exhausted'` (nunca para um erro que
 * derrube o turno) se a leitura do banco falhar — mais seguro rebaixar
 * pra Luna do que continuar sem saber o gasto real.
 */
export async function currentBudgetTier(organizationId?: string | null): Promise<{ tier: BudgetTier; spentUsd: number }> {
  try {
    const spentUsd = await monthlySpendUsd(organizationId);
    return { tier: budgetTierFromUsage(spentUsd, BUDGET_CONFIG.monthlyOperationalCapUsd), spentUsd };
  } catch {
    return { tier: 'exhausted', spentUsd: BUDGET_CONFIG.monthlyOperationalCapUsd };
  }
}
