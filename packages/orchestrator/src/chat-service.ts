import { db, schema } from '@desigual-os/database';
import type { RouterDecision } from '@desigual-os/router';
import type { QueuePriority } from '@desigual-os/types';
import { findHealthyNodeForAgent } from './discovery';
import { generateExecutionId } from './execution-id';
import { MAX_ATTEMPTS, PRIORITY_VALUE, getAgentQueue } from './queues';
import type { ChatResult } from './result';

const COMPLEXITY_TO_PRIORITY: Record<string, QueuePriority> = {
  low: 'P3',
  medium: 'P2',
  high: 'P1',
};

export interface SingleAgentDispatchParams {
  message: string;
  userId: string;
  clientId: string | null;
  conversationId: string | null;
  decision: RouterDecision;
}

/**
 * POST /chat ponta a ponta (seção 9): decide prioridade pela complexidade
 * do Router, checa saúde do node (circuit breaker, seção 6.2: se não
 * houver node saudável, responde na hora e nunca enfileira), grava a
 * execution e o router_decision, e só então enfileira no BullMQ.
 */
export async function createAndEnqueueExecution(params: SingleAgentDispatchParams): Promise<ChatResult> {
  const { message, userId, clientId, conversationId, decision } = params;

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
  await queue.add(
    'execute',
    {
      executionDbId: execution.id,
      executionId: execution.executionId,
      agent: decision.primary_agent,
      message,
      contextRefs: decision.context,
      conversationId,
    },
    {
      priority: PRIORITY_VALUE[priority],
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'fixed', delay: 2000 },
    },
  );

  return { executionId: execution.executionId, status: 'queued', agent: decision.primary_agent };
}
