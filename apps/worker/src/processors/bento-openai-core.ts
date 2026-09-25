import type { Logger } from '@desigual-os/logging';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import { createTaskComment, getTaskComments, type SeniorToolContext } from '@desigual-os/tool-gateway';
import { createVerifiedSeniorTask, MutationBudget } from '@desigual-os/tool-gateway';
import {
  proposeBentoAction,
  validateBentoAction,
  BentoPlannerError,
  type ConversationResourceState,
  type WriteEnvelope,
} from '@desigual-os/bento-core';
import { getClickUpConfigOrNull } from './bento-action-guard';
import { resolveWriteTarget } from './write-target';
import { executeTaskUpdate } from './bento-update-executor';
import { loadResourceState, persistResourceState, applyExecutionToState } from './bento-resource-state';
import { loadLatestExecutionState, sameExecutionAlreadyDone } from './execution-record';

/**
 * bento-openai-core.ts — o loop novo pedido em "BENTO CORE CUTOVER":
 *
 *   USER MESSAGE → ConversationResourceState → OpenAI Responses (planner,
 *   sem tools) → structured action → policy determinística → single write
 *   provider (LEGACY_GATEWAY hoje — MCP fica pronto assim que o OAuth for
 *   autorizado, ver clickup-mcp-tool.ts) → executor verificado existente
 *   (createVerifiedSeniorTask / executeTaskUpdate, ambos já com read-back) →
 *   persiste resource state → responde.
 *
 * ADITIVO e ATRÁS DE FLAG (BENTO_OPENAI_CORE_ENABLED, default desligado):
 * com a flag off, `runBentoOpenAiCore` devolve `null` imediatamente e
 * `execute-job.ts` segue pro guard antigo, byte a byte como antes. Ligar a
 * flag é decisão operacional separada de este código existir — ver
 * CLAUDE_RELEASE_HANDOFF.md.
 *
 * Escopo desta primeira versão: create_task e update_task/comment_task
 * (os dois P0 da auditoria). read_tasks/get_task/analyze_tasks devolvem
 * `null` de propósito — o caminho antigo já cobre leitura/análise
 * (execution-record.ts, selection-read.ts, committed nesta mesma missão) e
 * reescrevê-los aqui seria escopo além do blocker pedido.
 */
export function bentoOpenAiCoreEnabled(): boolean {
  return process.env.BENTO_OPENAI_CORE_ENABLED === 'true';
}

function envelopeToExecuteResponse(agent: 'bento', envelope: WriteEnvelope, humanAnswer: string): ExecuteResponse {
  return {
    execution_id: '',
    agent,
    status: envelope.success ? 'completed' : 'failed',
    answer: humanAnswer,
    sources: envelope.sources,
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(envelope.success ? {} : { error: envelope.error ?? 'falha não detalhada' }),
    metadata: {
      guard: 'bento-openai-core',
      write_envelope: envelope as unknown as Record<string, unknown>,
    },
  };
}

export interface BentoOpenAiCoreParams {
  message: string;
  conversationId: string;
  organizationId: string | null;
  clientId: string | null;
  seniorToolContext: SeniorToolContext | null;
  logger: Logger;
}

export async function runBentoOpenAiCore(params: BentoOpenAiCoreParams): Promise<ExecuteResponse | null> {
  if (!bentoOpenAiCoreEnabled()) return null;

  const resourceState: ConversationResourceState = await loadResourceState(params.conversationId);

  let action;
  try {
    action = await proposeBentoAction({
      message: params.message,
      resourceState,
      clientName: null,
      logger: params.logger as never,
    });
  } catch (error) {
    // §26/§15 da missão: falha de credencial/estrutura é EXPLÍCITA, nunca cai
    // silenciosamente pro guard antigo enquanto a flag estiver ligada — quem
    // ligou a flag decidiu que este é o caminho, uma falha aqui é sinal
    // operacional, não motivo pra fingir que a flag estava desligada.
    const messageText = error instanceof BentoPlannerError ? error.message : 'Planejador OpenAI do Bento falhou';
    params.logger.warn({ error }, '[bento-openai-core] planner falhou');
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider: null, resourceIds: [], operation: 'plan', changes: {}, error: messageText, retryable: false, sources: [] }, `Não consegui planejar essa ação agora: ${messageText}`);
  }

  // Fora do escopo desta primeira wiring (ver comentário de topo) — cai pro
  // guard antigo, que já cobre leitura/análise.
  if (action.intent === 'read_tasks' || action.intent === 'get_task' || action.intent === 'analyze_tasks') {
    return null;
  }

  if (!params.seniorToolContext) {
    return envelopeToExecuteResponse(
      'bento',
      { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: 'sem contexto de autoridade resolvido (executor/organização/permissão)', retryable: false, sources: [] },
      'Não consegui confirmar sua permissão pra essa ação agora.',
    );
  }

  const decision = validateBentoAction(action, resourceState, {
    actorHasClickUpWrite: params.seniorToolContext.permissions.some((p) => p.resource === 'clickup' && p.action === 'write'),
    agentHasClickUpWrite: true, // agent_tools já checado no boot da execução (loadSeniorRuntimeContext); ver RBAC seção do handoff
    mutationsThisExecution: 0,
    maxMutationsPerExecution: 10,
    explicitMultiActionConfirmed: false,
  });

  if (!decision.allowed) {
    return envelopeToExecuteResponse(
      'bento',
      { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: decision.reason, retryable: false, sources: [] },
      decision.reason.startsWith('target_unresolved')
        ? 'Não identifiquei de qual task você está falando — pode me lembrar qual é (nome ou link)?'
        : `Não posso executar essa ação agora: ${decision.reason}`,
    );
  }

  const config = getClickUpConfigOrNull();
  if (!config) {
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: 'ClickUp não configurado (CLICKUP_API_KEY/CLICKUP_TEAM_ID ausentes)', retryable: false, sources: [] }, 'ClickUp não está configurado neste ambiente.');
  }

  // §14: idempotência — mesma operação sobre o mesmo recurso já confirmada
  // na conversa não repete a escrita.
  if (decision.resolvedResourceId) {
    const lastState = await loadLatestExecutionState(params.conversationId).catch(() => null);
    if (
      lastState?.kind === 'executed' &&
      sameExecutionAlreadyDone(lastState.record, { operation: action.intent, taskIds: [decision.resolvedResourceId], memberId: null })
    ) {
      return envelopeToExecuteResponse(
        'bento',
        { success: true, verified: true, provider: 'LEGACY_GATEWAY', resourceIds: [decision.resolvedResourceId], operation: action.intent, changes: {}, error: null, retryable: false, sources: [`CLICKUP_TASK:${decision.resolvedResourceId}`] },
        'Já tinha feito isso — não repeti a mutação pra não duplicar.',
      );
    }
  }

  // §7: single write provider. MCP fica PRONTO (buildClickUpMcpTool) mas só
  // vira o provider real depois que o OAuth do MCP for autorizado (ver
  // CLICKUP MCP AUTH REQUIRED no handoff) — até lá, LEGACY_GATEWAY é o único
  // provider que este código executa de fato, nunca os dois pra uma mesma
  // mutação.
  const provider = 'LEGACY_GATEWAY' as const;

  if (action.intent === 'create_task') {
    const target = await resolveWriteTarget({
      message: params.message,
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      executionClientId: params.clientId,
    });
    if (target.status !== 'resolved' || !target.listId) {
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [], operation: 'create_task', changes: {}, error: `write_target_${target.status}: ${target.reason}`, retryable: false, sources: [] }, 'Não consegui identificar o cliente/lista de destino dessa task.');
    }
    const result = await createVerifiedSeniorTask(
      config,
      params.seniorToolContext,
      { listId: target.listId, name: action.changes?.title ?? 'Nova demanda', description: action.changes?.description ?? '' },
      new MutationBudget(),
    );
    if (!result.success) {
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [], operation: 'create_task', changes: {}, error: result.message, retryable: result.retryable, sources: [] }, `Não consegui criar a task: ${result.message}`);
    }
    const newState = applyExecutionToState(resourceState, { operation: 'create_task', resourceIds: [result.resourceId], verified: result.verified, created: !result.wasExisting, title: action.changes?.title ?? null });
    await persistResourceState(params.conversationId, newState);
    return envelopeToExecuteResponse(
      'bento',
      { success: true, verified: result.verified, provider, resourceIds: [result.resourceId], operation: 'create_task', changes: { title: action.changes?.title ?? null }, error: null, retryable: false, sources: [`CLICKUP_TASK:${result.resourceId}`] },
      result.wasExisting ? `Essa task já existia (${result.resourceUrl}) — não criei outra.` : `Criei a task: ${result.resourceUrl}`,
    );
  }

  if (!decision.resolvedResourceId) {
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [], operation: action.intent, changes: {}, error: 'target_unresolved', retryable: false, sources: [] }, 'Não identifiquei a task alvo dessa ação.');
  }

  if (action.intent === 'comment_task') {
    const text = action.changes?.comment ?? action.changes?.description ?? '';
    if (!text.trim()) {
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [decision.resolvedResourceId], operation: 'comment_task', changes: {}, error: 'comentário vazio', retryable: false, sources: [] }, 'Não recebi o texto do comentário.');
    }
    try {
      const created = await createTaskComment(config, decision.resolvedResourceId, text);
      const comments = await getTaskComments(config, decision.resolvedResourceId).catch(() => []);
      const verified = comments.some((c) => c.id === created.id);
      const newState = applyExecutionToState(resourceState, { operation: 'comment_task', resourceIds: [decision.resolvedResourceId], verified, created: false });
      await persistResourceState(params.conversationId, newState);
      return envelopeToExecuteResponse(
        'bento',
        { success: true, verified, provider, resourceIds: [decision.resolvedResourceId], operation: 'comment_task', changes: { comment: text }, error: null, retryable: false, sources: [`CLICKUP_TASK:${decision.resolvedResourceId}`, `CLICKUP_COMMENT:${created.id}`] },
        'Comentário adicionado.',
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'falha desconhecida';
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [decision.resolvedResourceId], operation: 'comment_task', changes: {}, error: messageText, retryable: true, sources: [] }, `Não consegui comentar: ${messageText}`);
    }
  }

  // update_task
  const response = await executeTaskUpdate({
    config,
    taskId: decision.resolvedResourceId,
    knownTaskName: resourceState.focusedResource?.title ?? null,
    fields: {
      ...(action.changes?.title ? { newTitle: action.changes.title } : {}),
      ...(action.changes?.description ? { replaceDescription: action.changes.description } : {}),
      ...(action.changes?.assignee ? { personName: action.changes.assignee } : {}),
    },
    mapStatus: () => undefined,
    logger: params.logger,
  });

  const resourceIds = decision.resolvedResourceId ? [decision.resolvedResourceId] : [];
  const verified = response.status === 'completed';
  if (verified) {
    const newState = applyExecutionToState(resourceState, { operation: 'update_task', resourceIds, verified: true, created: false });
    await persistResourceState(params.conversationId, newState);
  }

  return {
    ...response,
    sources: resourceIds.map((id) => `CLICKUP_TASK:${id}`),
    metadata: { ...response.metadata, guard: 'bento-openai-core', provider },
  };
}
