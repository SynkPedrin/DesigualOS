import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import type { RouterDecision } from '@desigual-os/router';
import type { QueuePriority, StudioReferenceAsset } from '@desigual-os/types';
import { estimateCost } from '@desigual-os/token-engine';
import { findHealthyNodeForAgent } from './discovery';
import { generateExecutionId } from './execution-id';
import { AGENT_MAX_ATTEMPTS, PRIORITY_VALUE, getAgentQueue } from './queues';
import type { ChatResult } from './result';

const COMPLEXITY_TO_PRIORITY: Record<string, QueuePriority> = {
  low: 'P3',
  medium: 'P2',
  high: 'P1',
};

const logger = createLogger({ service: 'orchestrator:chat-service' });

export interface SingleAgentDispatchParams {
  message: string;
  userId: string;
  clientId: string | null;
  conversationId: string | null;
  decision: RouterDecision;
  attachments?: StudioReferenceAsset[];
  /** Ver AgentJobData.operationalContext. */
  operationalContext?: string;
}

/**
 * POST /chat ponta a ponta (seção 9): decide prioridade pela complexidade
 * do Router, checa saúde do node (circuit breaker, seção 6.2: se não
 * houver node saudável, responde na hora e nunca enfileira), grava a
 * execution e o router_decision, e só então enfileira no BullMQ.
 */
export async function createAndEnqueueExecution(
  params: SingleAgentDispatchParams,
): Promise<ChatResult> {
  const { message, userId, clientId, conversationId, decision, attachments, operationalContext } = params;

  const healthyNode = await findHealthyNodeForAgent(decision.primary_agent);
  if (!healthyNode) {
    return {
      executionId: null,
      status: 'unavailable',
      agent: decision.primary_agent,
      error: `Agente '${decision.primary_agent}' está indisponível no momento (nenhum node online).`,
    };
  }

  const executionId = generateExecutionId();
  const priority = COMPLEXITY_TO_PRIORITY[decision.estimated_complexity] ?? 'P2';
  // Estimativa pré-execução (economy_records, ver cost-service.ts): sem
  // saber ainda o modelo real, usa o preço 'unknown' (nível Sonnet), mesmo
  // fallback do custo real quando o modelo não é reportado.
  const { amountUsd: estimatedCost } = estimateCost('unknown', message);

  const [execution] = await db
    .insert(schema.executions)
    .values({
      executionId,
      userId,
      clientId,
      agent: decision.primary_agent,
      intent: decision.intent,
      status: 'queued',
      priority,
      estimatedCost: estimatedCost.toString(),
    })
    .returning();

  if (!execution) {
    throw new Error('Failed to create execution record');
  }

  await db.insert(schema.routerDecisions).values({
    conversationId,
    intent: decision.intent,
    primaryAgent: decision.primary_agent,
    requiredTools: decision.required_tools,
    contextRefs: decision.context,
    estimatedComplexity: decision.estimated_complexity,
    workflow: decision.workflow,
  });

  const queue = getAgentQueue(decision.primary_agent);
  // O insert acima e o enqueue abaixo não são atômicos (BullMQ/Redis é
  // externo ao Postgres, uma transação de banco não cobre os dois). Sem
  // este try/catch, uma falha no enqueue (ex: Redis fora do ar) deixava a
  // execution em 'queued' pra sempre - nenhum worker nunca ia pegá-la, um
  // job fantasma (achado da auditoria de prontidão, 2026-09-11). Mesmo
  // padrão do POST /studio/jobs (apps/api/src/studio/routes.ts): marcar
  // como 'failed' com o motivo e devolver erro controlado.
  try {
    await queue.add(
      'execute',
      {
        executionDbId: execution.id,
        executionId: execution.executionId,
        agent: decision.primary_agent,
        message,
        contextRefs: decision.context,
        ...(attachments?.length ? { attachments } : {}),
        ...(operationalContext ? { operationalContext } : {}),
        conversationId,
      },
      {
        priority: PRIORITY_VALUE[priority],
        attempts: AGENT_MAX_ATTEMPTS[decision.primary_agent],
        backoff: { type: 'fixed', delay: 2000 },
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(
      { error, executionId: execution.executionId, agent: decision.primary_agent },
      'Failed to enqueue execution after insert',
    );
    // A compensação também pode falhar (ex: Postgres caiu junto com o
    // Redis). Mesmo assim o erro controlado precisa voltar pro chamador -
    // sem isto uma falha dupla viraria 500 sem explicação.
    try {
      const now = new Date();
      await db
        .update(schema.executions)
        .set({ status: 'failed', completedAt: now })
        .where(eq(schema.executions.id, execution.id));
      // executions não tem coluna de erro; o motivo vai no output do step,
      // mesmo lugar onde o worker grava falhas reais (execute-job.ts), pra
      // GET /executions/:id mostrar a razão em vez de um 'queued' eterno.
      await db.insert(schema.executionSteps).values({
        executionId: execution.id,
        stepIndex: 0,
        agent: decision.primary_agent,
        status: 'failed',
        output: { error: `Falha ao enfileirar a execução: ${detail}` },
        startedAt: now,
        completedAt: now,
      });
    } catch (compensationError) {
      logger.error(
        { error: compensationError, executionId: execution.executionId },
        'Failed to mark execution as failed after enqueue error',
      );
    }
    // 'unavailable' é o único status de erro do contrato ChatResult; a rota
    // de chat responde erro controlado (503) com esta mensagem.
    return {
      executionId: execution.executionId,
      status: 'unavailable',
      agent: decision.primary_agent,
      error: 'Não foi possível enfileirar a execução agora (fila temporariamente indisponível). Tente de novo em instantes.',
    };
  }

  return { executionId: execution.executionId, status: 'queued', agent: decision.primary_agent };
}
