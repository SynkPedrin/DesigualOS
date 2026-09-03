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
}): Promise<void> {
  const { executionDbId, clientId, userId, agent, model, inputTokens, outputTokens } = params;
  if (inputTokens === 0 && outputTokens === 0) {
    return;
  }

  const { amountUsd } = computeCost(model, inputTokens, outputTokens);

  await db.insert(schema.costRecords).values({
    executionId: executionDbId,
    clientId,
    userId,
    agent,
    kind: 'model',
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
  await db.update(schema.executions).set({ actualCost: total.toString() }).where(eq(schema.executions.id, executionDbId));
}
