import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { db, schema } from '@desigual-os/database';
import { executeResponseSchema, type ExecuteResponse } from '@desigual-os/node-protocol';
import {
  AGENT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  PRIORITY_VALUE,
  findHealthyNodeForAgent,
  finalizeExecutionCost,
  getAgentQueue,
  publishWsEvent,
  recordCostEvent,
  type AgentJobData,
} from '@desigual-os/orchestrator';
import type { AgentName } from '@desigual-os/types';
import { askBentoQA, BentoQAError, askAgent, AgentAskError } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

// Convenção de porta padrão dos Node Agents genéricos (desigual-node). Em
// produção cada agente é uma máquina física separada, então todos podem
// usar a mesma porta sem conflito. Em dev, com vários nodes fake na mesma
// máquina, private_host pode incluir a porta explicitamente (host:porta).
const DEFAULT_NODE_PORT = 4001;

function buildNodeUrl(privateHost: string): string {
  return privateHost.includes(':') ? `http://${privateHost}` : `http://${privateHost}:${DEFAULT_NODE_PORT}`;
}

/**
 * Bento tem um caminho REAL e já em produção pra pergunta-resposta
 * (bento-qa, porta 8791), então o Chat central fala com ele diretamente em
 * vez de exigir o protocolo genérico `/execute` de um Node Agent que nunca
 * foi implantado na máquina dele. Jarbas e Suzy ganharam o equivalente em
 * 03/09/2026: o `POST /internal/ask` do agentes-desigual (susy-service,
 * porta 3102 nos Mac Minis deles), que despacha pro answerQuestion() de
 * cada agente reusando o cérebro real do WhatsApp. O caminho genérico
 * `/execute` continua só pro Studio e pra futuros Node Agents.
 */
async function callBento(message: string, logger: Logger): Promise<ExecuteResponse> {
  const url = process.env.BENTO_QA_URL ?? 'http://100.93.182.83:8791';
  const token = process.env.BENTO_QA_TOKEN;
  if (!token) {
    return {
      execution_id: '',
      agent: 'bento',
      status: 'failed',
      answer: null,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: 'BENTO_QA_TOKEN not configured on the Orchestrator worker',
    };
  }

  try {
    const { text, citations } = await askBentoQA({ url, token, channel: 'whatsapp' }, message);
    return {
      execution_id: '',
      agent: 'bento',
      status: 'completed',
      answer: text,
      sources: citations.map((c) => c.path),
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  } catch (error) {
    const message2 = error instanceof BentoQAError ? error.message : error instanceof Error ? error.message : String(error);
    logger.error({ error: message2 }, 'bento-qa dispatch failed');
    return {
      execution_id: '',
      agent: 'bento',
      status: 'failed',
      answer: null,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: message2,
    };
  }
}

const AGENTES_ASK_DEFAULT_URL: Record<'jarbas' | 'suzy', string> = {
  jarbas: 'http://100.118.12.97:3102',
  suzy: 'http://100.86.237.73:3102',
};

function failedAgentResponse(agent: AgentName, error: string): ExecuteResponse {
  return {
    execution_id: '',
    agent,
    status: 'failed',
    answer: null,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    error,
  };
}

/**
 * Jarbas e Suzy reais via POST /internal/ask do agentes-desigual. O token é
 * único e compartilhado (API_KEYS do serviço, permission "internal_ask"),
 * mesma filosofia do BENTO_QA_TOKEN. sessionId = conversa, pra o agente
 * manter histórico entre mensagens da mesma thread do chat.
 */
async function callAgentesDesigual(
  agent: 'jarbas' | 'suzy',
  message: string,
  sessionId: string,
  logger: Logger,
): Promise<ExecuteResponse> {
  const url = process.env[agent === 'jarbas' ? 'JARBAS_ASK_URL' : 'SUZY_ASK_URL'] ?? AGENTES_ASK_DEFAULT_URL[agent];
  const token = process.env.AGENTES_ASK_TOKEN;
  if (!token) {
    return failedAgentResponse(agent, 'AGENTES_ASK_TOKEN not configured on the Orchestrator worker');
  }

  try {
    const answer = await askAgent({ url, token, agent, timeoutMs: AGENT_TIMEOUT_MS[agent] }, message, sessionId);
    return {
      execution_id: '',
      agent,
      status: 'completed',
      answer,
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  } catch (error) {
    const detail = error instanceof AgentAskError ? error.message : error instanceof Error ? error.message : String(error);
    logger.error({ agent, error: detail }, 'agentes-desigual dispatch failed');
    return failedAgentResponse(agent, detail);
  }
}

async function callNode(
  agent: AgentName,
  executionId: string,
  message: string,
  contextRefs: string[],
  logger: Logger,
  sessionId?: string,
): Promise<ExecuteResponse> {
  if (agent === 'bento') {
    const result = await callBento(message, logger);
    return { ...result, execution_id: executionId };
  }

  if (agent === 'jarbas' || agent === 'suzy') {
    const result = await callAgentesDesigual(agent, message, sessionId ?? executionId, logger);
    return { ...result, execution_id: executionId };
  }

  const node = await findHealthyNodeForAgent(agent);
  if (!node) {
    throw new Error(`Agent '${agent}' has no healthy node at dispatch time`);
  }

  const timeoutMs = AGENT_TIMEOUT_MS[agent];
  const url = `${buildNodeUrl(node.privateHost)}/execute`;
  logger.info({ executionId, agent, url }, 'Dispatching execution to node');

  const nodeSecret = process.env.NODE_SECRET;
  if (!nodeSecret) {
    throw new Error('NODE_SECRET not configured on the Orchestrator worker');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nodeSecret}` },
    body: JSON.stringify({ execution_id: executionId, message, context_refs: contextRefs }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Node returned ${response.status}: ${await response.text()}`);
  }

  return executeResponseSchema.parse(await response.json());
}

async function recordAuditLog(agent: AgentName, executionId: string, result: ExecuteResponse): Promise<void> {
  await db.insert(schema.auditLogs).values({
    action: result.status === 'completed' ? 'execution.completed' : 'execution.node_failure',
    agent,
    result: result.status,
    metadata: { execution_id: executionId, sources: result.sources, error: result.error ?? null },
  });
}

/** Fecha o ciclo User -> Conversation da seção 6.3: a resposta final também vira mensagem. */
async function recordAssistantMessage(conversationId: string | null, agent: AgentName, content: string | null): Promise<void> {
  if (!conversationId || !content) return;
  await db.insert(schema.messages).values({ conversationId, role: 'assistant', agent, content });
}

/**
 * Notificação de "terminei" pro dono da execution (pedido do usuário,
 * 2026-09-03): com chat compartilhado e várias conversas rodando em
 * paralelo em background, é assim que ele sabe que o Bento/Jarbas/Suzy
 * terminou sem precisar ficar com a aba daquela conversa aberta. Só faz
 * sentido pra execution de CHAT (tem conversationId) — jobs do Studio já
 * notificam por conta própria (nodes/studio-node), não duplicar aqui.
 */
async function notifyChatCompletion(
  userId: string | undefined,
  agent: AgentName,
  conversationId: string | null,
  status: 'completed' | 'failed',
  answer: string | null,
): Promise<void> {
  if (!userId || !conversationId) return;
  const label = agent.charAt(0).toUpperCase() + agent.slice(1);
  const title = status === 'completed' ? `${label} respondeu` : `${label} não conseguiu responder`;
  const body =
    status === 'completed'
      ? (answer ?? '').slice(0, 140)
      : 'Tente reformular a pergunta ou mandar de novo.';
  await db.insert(schema.notifications).values({
    userId,
    type: 'chat.execution_completed',
    title,
    body,
    link: `/chat?agent=${agent}&conversation=${conversationId}`,
  });
}

export async function processAgentJob(job: Job<AgentJobData>, logger: Logger): Promise<void> {
  if (job.data.workflowId !== undefined && job.data.stepIndex !== undefined) {
    await processWorkflowStep(job.data, logger);
  } else {
    await processSingleAgentJob(job.data, logger);
  }
}

async function processSingleAgentJob(data: AgentJobData, logger: Logger): Promise<void> {
  const { executionDbId, executionId, agent, message, contextRefs, conversationId } = data;

  const [runningExecution] = await db
    .update(schema.executions)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.executions.id, executionDbId))
    .returning({ userId: schema.executions.userId });
  await publishWsEvent({ type: 'execution.progress', payload: { execution_id: executionId, agent, status: 'running' } });

  let result: ExecuteResponse;
  try {
    result = await callNode(agent, executionId, message, contextRefs, logger, conversationId ?? undefined);
  } catch (error) {
    await failExecution(executionDbId, error instanceof Error ? error.message : String(error));
    await publishWsEvent({ type: 'execution.completed', payload: { execution_id: executionId, agent, status: 'failed' } });
    await notifyChatCompletion(runningExecution?.userId, agent, conversationId, 'failed', null);
    throw error;
  }

  const now = new Date();
  const [execution] = await db
    .update(schema.executions)
    .set({
      status: result.status,
      completedAt: now,
      tokensInput: result.usage.input_tokens,
      tokensOutput: result.usage.output_tokens,
    })
    .where(eq(schema.executions.id, executionDbId))
    .returning();

  await recordTokenUsage(executionDbId, result);
  await recordAuditLog(agent, executionId, result);
  await recordAssistantMessage(conversationId, agent, result.answer);
  // Sem isso, GET /executions/:id sempre devolvia steps: [] pro caminho de
  // agente único (só processWorkflowStep grava execution_steps) — o balão
  // do chat lê execution.steps.at(-1) e ficava vazio mesmo quando o agente
  // respondeu certo (a resposta existia em `messages`, só não chegava aqui).
  // onConflictDoUpdate porque este job roda com attempts: MAX_ATTEMPTS (2) —
  // uma 2ª tentativa reexecuta esta função inteira e um insert puro bateria
  // na unique(executionId, stepIndex) da 1ª tentativa.
  await db
    .insert(schema.executionSteps)
    .values({
      executionId: executionDbId,
      stepIndex: 0,
      agent,
      status: result.status,
      output: { answer: result.answer, sources: result.sources },
      startedAt: now,
      completedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.executionSteps.executionId, schema.executionSteps.stepIndex],
      set: { status: result.status, output: { answer: result.answer, sources: result.sources }, completedAt: now },
    });
  if (execution) {
    await recordCostForStep(execution.clientId, execution.userId, executionDbId, agent, result.usage);
    await finalizeExecutionCost(executionDbId);
  }
  await publishWsEvent({ type: 'execution.completed', payload: { execution_id: executionId, agent, status: result.status } });
  await notifyChatCompletion(execution?.userId, agent, conversationId, result.status === 'failed' ? 'failed' : 'completed', result.answer);

  if (result.status === 'failed') {
    throw new Error(result.error ?? 'Node reported failure');
  }
}

async function recordCostForStep(
  clientId: string | null,
  userId: string,
  executionDbId: string,
  agent: AgentName,
  usage: { input_tokens: number; output_tokens: number },
): Promise<void> {
  await recordCostEvent({
    executionDbId,
    clientId,
    userId,
    agent,
    model: 'unknown',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  });
}

/**
 * Etapa de um workflow multi agente (Fase 10). Cada etapa some no seu
 * próprio job; ao terminar, encadeia a próxima (mesmo execution_id, mesma
 * linha em executions até a última etapa) ou fecha o workflow inteiro.
 */
async function processWorkflowStep(data: AgentJobData, logger: Logger): Promise<void> {
  const { executionDbId, executionId, agent, message, contextRefs, conversationId, workflowId, stepIndex } = data;
  if (workflowId === undefined || stepIndex === undefined) {
    throw new Error('processWorkflowStep called without workflowId/stepIndex');
  }

  await db
    .update(schema.executionSteps)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(schema.executionSteps.executionId, executionDbId), eq(schema.executionSteps.stepIndex, stepIndex)));
  await db
    .update(schema.workflowSteps)
    .set({ status: 'running' })
    .where(and(eq(schema.workflowSteps.workflowId, workflowId), eq(schema.workflowSteps.stepIndex, stepIndex)));
  if (stepIndex === 0) {
    await db.update(schema.executions).set({ status: 'running', startedAt: new Date() }).where(eq(schema.executions.id, executionDbId));
  }
  await publishWsEvent({ type: 'execution.progress', payload: { execution_id: executionId, agent, step_index: stepIndex, status: 'running' } });

  let result: ExecuteResponse;
  try {
    result = await callNode(agent, executionId, message, contextRefs, logger, conversationId ?? undefined);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await failWorkflowStep(executionDbId, workflowId, stepIndex, reason);
    await publishWsEvent({ type: 'execution.completed', payload: { execution_id: executionId, agent, step_index: stepIndex, status: 'failed' } });
    throw error;
  }

  const now = new Date();
  await db
    .update(schema.executionSteps)
    .set({ status: result.status, output: { answer: result.answer, sources: result.sources }, completedAt: now })
    .where(and(eq(schema.executionSteps.executionId, executionDbId), eq(schema.executionSteps.stepIndex, stepIndex)));
  await db
    .update(schema.workflowSteps)
    .set({ status: result.status })
    .where(and(eq(schema.workflowSteps.workflowId, workflowId), eq(schema.workflowSteps.stepIndex, stepIndex)));

  await recordTokenUsage(executionDbId, result);
  await recordAuditLog(agent, executionId, result);

  const [execution] = await db.select().from(schema.executions).where(eq(schema.executions.id, executionDbId));
  if (execution) {
    await recordCostForStep(execution.clientId, execution.userId, executionDbId, agent, result.usage);
  }

  if (result.status === 'failed') {
    await failWorkflowStep(executionDbId, workflowId, stepIndex, result.error ?? 'Node reported failure');
    await publishWsEvent({ type: 'execution.completed', payload: { execution_id: executionId, agent, step_index: stepIndex, status: 'failed' } });
    throw new Error(result.error ?? 'Node reported failure');
  }
  await publishWsEvent({ type: 'execution.progress', payload: { execution_id: executionId, agent, step_index: stepIndex, status: result.status } });

  const [workflow] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, workflowId));
  const definition = (workflow?.definition ?? []) as AgentName[];
  const nextIndex = stepIndex + 1;
  const nextAgent = definition[nextIndex];

  if (nextAgent) {
    const chainedMessage = `${message}\n\nResultado da etapa anterior (${agent}):\n${result.answer ?? ''}`;
    const queue = getAgentQueue(nextAgent);
    await queue.add(
      'execute',
      {
        executionDbId,
        executionId,
        agent: nextAgent,
        message: chainedMessage,
        contextRefs,
        conversationId,
        workflowId,
        stepIndex: nextIndex,
      },
      // Antes hardcoded em P1: uma execution 'low' criada como P3 virava a
      // prioridade máxima do BullMQ assim que a 2ª etapa era encadeada,
      // contradizendo a prioridade que o Router/complexidade calculou pra
      // ela na 1ª etapa (workflow-service.ts).
      { priority: PRIORITY_VALUE[execution?.priority ?? 'P2'], attempts: MAX_ATTEMPTS, backoff: { type: 'fixed', delay: 2000 } },
    );
    logger.info({ executionId, nextAgent, nextIndex }, 'Chained next workflow step');
  } else {
    // Última etapa: soma o consumo de todas as etapas do workflow pro total
    // da execution (cada etapa já gravou a própria linha em token_usage).
    const usageRows = await db
      .select({ inputTokens: schema.tokenUsage.inputTokens, outputTokens: schema.tokenUsage.outputTokens })
      .from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.executionId, executionDbId));
    const totalInput = usageRows.reduce((sum, row) => sum + row.inputTokens, 0);
    const totalOutput = usageRows.reduce((sum, row) => sum + row.outputTokens, 0);

    await db
      .update(schema.executions)
      .set({ status: 'completed', completedAt: now, tokensInput: totalInput, tokensOutput: totalOutput })
      .where(eq(schema.executions.id, executionDbId));
    await db.update(schema.workflows).set({ status: 'completed' }).where(eq(schema.workflows.id, workflowId));
    await finalizeExecutionCost(executionDbId);
    await recordAssistantMessage(conversationId, agent, result.answer);
    await publishWsEvent({ type: 'execution.completed', payload: { execution_id: executionId, agent, status: 'completed' } });
    await notifyChatCompletion(execution?.userId, agent, conversationId, 'completed', result.answer);
    logger.info({ executionId, totalInput, totalOutput }, 'Workflow completed');
  }
}

async function recordTokenUsage(executionDbId: string, result: ExecuteResponse): Promise<void> {
  if (result.usage.input_tokens > 0 || result.usage.output_tokens > 0) {
    await db.insert(schema.tokenUsage).values({
      executionId: executionDbId,
      model: 'unknown', // Node ainda não devolve qual modelo o OpenClaw usou; ver Fase 04.
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    });
  }
}

async function failExecution(executionDbId: string, reason: string): Promise<void> {
  await db
    .update(schema.executions)
    .set({ status: 'failed', completedAt: new Date() })
    .where(eq(schema.executions.id, executionDbId));

  await db.insert(schema.auditLogs).values({
    action: 'execution.failed',
    result: 'failed',
    metadata: { execution_db_id: executionDbId, reason },
  });
}

async function failWorkflowStep(executionDbId: string, workflowId: string, stepIndex: number, reason: string): Promise<void> {
  const now = new Date();
  await db
    .update(schema.executionSteps)
    .set({ status: 'failed', completedAt: now })
    .where(and(eq(schema.executionSteps.executionId, executionDbId), eq(schema.executionSteps.stepIndex, stepIndex)));
  await db
    .update(schema.workflowSteps)
    .set({ status: 'failed' })
    .where(and(eq(schema.workflowSteps.workflowId, workflowId), eq(schema.workflowSteps.stepIndex, stepIndex)));
  await db.update(schema.executions).set({ status: 'failed', completedAt: now }).where(eq(schema.executions.id, executionDbId));
  await db.update(schema.workflows).set({ status: 'failed' }).where(eq(schema.workflows.id, workflowId));

  await db.insert(schema.auditLogs).values({
    action: 'execution.failed',
    result: 'failed',
    metadata: { execution_db_id: executionDbId, workflow_id: workflowId, step_index: stepIndex, reason },
  });
}
