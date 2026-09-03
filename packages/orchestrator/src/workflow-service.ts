import { db, schema } from '@desigual-os/database';
import type { RouterDecision } from '@desigual-os/router';
import type { AgentName, QueuePriority } from '@desigual-os/types';
import { findHealthyNodeForAgent } from './discovery';
import { generateExecutionId } from './execution-id';
import { MAX_ATTEMPTS, PRIORITY_VALUE, getAgentQueue } from './queues';
import type { ChatResult } from './result';

const COMPLEXITY_TO_PRIORITY: Record<string, QueuePriority> = { low: 'P3', medium: 'P2', high: 'P1' };

export interface WorkflowDispatchParams {
  message: string;
  userId: string;
  clientId: string | null;
  conversationId: string | null;
  decision: RouterDecision & { workflow: AgentName[] };
}

/**
 * Workflow multi agente (seção 6.3): um único execution_id pra cadeia
 * inteira, cada etapa vira uma linha em execution_steps e workflow_steps.
 * Só a primeira etapa é enfileirada aqui; o worker encadeia as próximas
 * (apps/worker/src/processors/execute-job.ts).
 */
export async function startWorkflow(params: WorkflowDispatchParams): Promise<ChatResult> {
  const { message, userId, clientId, conversationId, decision } = params;
  const firstAgent = decision.workflow[0];
  if (!firstAgent) {
    throw new Error('Workflow decision has no steps');
  }

  const healthyNode = await findHealthyNodeForAgent(firstAgent);
  if (!healthyNode) {
    return {
      executionId: null,
      status: 'unavailable',
      agent: firstAgent,
      error: `Agente '${firstAgent}' (primeira etapa do workflow) está indisponível no momento.`,
    };
  }

  const executionId = generateExecutionId();
  const priority = COMPLEXITY_TO_PRIORITY[decision.estimated_complexity] ?? 'P1';

  const [execution] = await db
    .insert(schema.executions)
    .values({ executionId, userId, clientId, agent: firstAgent, intent: decision.intent, status: 'queued', priority })
    .returning();
  if (!execution) throw new Error('Failed to create execution record');

  const [workflow] = await db
    .insert(schema.workflows)
    .values({ name: decision.intent, executionId: execution.id, status: 'running', definition: decision.workflow })
    .returning();
  if (!workflow) throw new Error('Failed to create workflow record');

  const stepRows = await db
    .insert(schema.executionSteps)
    .values(
      decision.workflow.map((agent, index) => ({
        executionId: execution.id,
        stepIndex: index,
        agent,
        status: 'pending' as const,
        input: { message },
      })),
    )
    .returning();

  await db.insert(schema.workflowSteps).values(
    decision.workflow.map((agent, index) => ({
      workflowId: workflow.id,
      stepIndex: index,
      agent,
      status: 'pending',
      executionStepId: stepRows[index]?.id ?? null,
    })),
  );

  await db.insert(schema.routerDecisions).values({
    conversationId,
    intent: decision.intent,
    primaryAgent: decision.primary_agent,
    requiredTools: decision.required_tools,
    contextRefs: decision.context,
    estimatedComplexity: decision.estimated_complexity,
    workflow: decision.workflow,
  });

  const queue = getAgentQueue(firstAgent);
  await queue.add(
    'execute',
    {
      executionDbId: execution.id,
      executionId: execution.executionId,
      agent: firstAgent,
      message,
      contextRefs: decision.context,
      conversationId,
      workflowId: workflow.id,
      stepIndex: 0,
    },
    { priority: PRIORITY_VALUE[priority], attempts: MAX_ATTEMPTS, backoff: { type: 'fixed', delay: 2000 } },
  );

  return { executionId: execution.executionId, status: 'queued', agent: firstAgent };
}
