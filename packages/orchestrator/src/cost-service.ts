import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { computeCost } from '@desigual-os/token-engine';
import type { AgentName } from '@desigual-os/types';

/**
 * Grava um evento de custo granular (uma linha por chamada de agente: uma
 * execution de agente único é uma linha, uma etapa de workflow é uma
 * linha por etapa, atribuída ao agente daquela etapa especificamente).
 * Custo é aproximado (ver packages/token-engine/src/pricing.ts): sem o
 * modelo real vindo do OpenClaw ainda, assume uma faixa de preço padrão.
 */
export async function recordCostEvent(params: {
  executionDbId: string;
  clientId: string | null;
  userId: string;
  agent: AgentName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Bento/Jarbas/Suzy não reportam usage de verdade (ver estimateTokenUsage
   * em apps/worker/src/processors/execute-job.ts) - marca a linha como tal
   * pra quem for ler `cost_records` depois saber que é aproximado, não medido. */
  estimated?: boolean;
}): Promise<void> {
  const {
    executionDbId,
    clientId,
    userId,
    agent,
    model,
    inputTokens,
    outputTokens,
    estimated = false,
  } = params;
  if (inputTokens === 0 && outputTokens === 0) {
    return;
  }

  const { amountUsd } = computeCost(model, inputTokens, outputTokens);

  await db.insert(schema.costRecords).values({
    executionId: executionDbId,
    clientId,
    userId,
    agent,
    kind: estimated ? 'model_estimated' : 'model',
    amount: amountUsd.toString(),
    currency: 'USD',
  });
}

/** Soma todas as linhas de custo já gravadas pra essa execution e atualiza o total. */
export async function finalizeExecutionCost(executionDbId: string): Promise<void> {
  const rows = await db
    .select({ amount: schema.costRecords.amount })
    .from(schema.costRecords)
    .where(eq(schema.costRecords.executionId, executionDbId));

  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const [execution] = await db
    .update(schema.executions)
    .set({ actualCost: total.toString() })
    .where(eq(schema.executions.id, executionDbId))
    .returning({ estimatedCost: schema.executions.estimatedCost });

  await recordEconomy(executionDbId, execution?.estimatedCost ?? null, total);
}

/**
 * `economy_records` (estimado vs real): migrada no banco desde a Fase 11,
 * mas até 08/09/2026 nada escrevia nela - não existia estimativa nenhuma
 * pra comparar (ver `estimateCost` em @desigual-os/token-engine, chamado na
 * criação da execution em chat-service.ts/workflow-service.ts). Sem
 * estimatedCost (execution criada antes desta mudança, ou custo real deu
 * zero), não escreve linha - não faz sentido "economia" sem os dois lados.
 */
async function recordEconomy(
  executionDbId: string,
  estimatedCostRaw: string | null,
  actualCost: number,
): Promise<void> {
  const estimatedCost = estimatedCostRaw ? Number(estimatedCostRaw) : null;
  if (estimatedCost === null || estimatedCost <= 0) return;

  const savedAmount = estimatedCost - actualCost;
  const savedPercentage = Math.max(-999.99, Math.min(999.99, (savedAmount / estimatedCost) * 100));

  // Sem unique constraint em executionId: se finalizeExecutionCost algum dia
  // for chamado 2x pra mesma execution (não deveria, mas nada impede hoje),
  // isto evita duas linhas de economia pra uma execution só.
  await db
    .delete(schema.economyRecords)
    .where(eq(schema.economyRecords.executionId, executionDbId));
  await db.insert(schema.economyRecords).values({
    executionId: executionDbId,
    estimatedCost: estimatedCost.toString(),
    actualCost: actualCost.toString(),
    savedAmount: savedAmount.toString(),
    savedPercentage: savedPercentage.toFixed(2),
  });
}
