import { runAgentLoop, TERMINAL_PHASES, type ActResult, type AgentExecutionState, type TaskClass } from '@desigual-os/agent-runtime';
import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import type { AgentJobData } from '@desigual-os/orchestrator';
import { publishWsEvent, recallMemories, rememberFact } from '@desigual-os/orchestrator';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { ClientBrandKit, ClientFeedbackEntry } from '@desigual-os/node-protocol';
import type { AgentName } from '@desigual-os/types';
import { classifyTask, evaluatorFor, goalFor, successCriteriaFor } from './agentic-profiles';
import type { Logger } from '@desigual-os/logging';

interface DispatchParams {
  data: AgentJobData;
  userId: string | null;
  clientId: string | null;
  clientBrandKit: ClientBrandKit | undefined;
  clientFeedbackHistory: ClientFeedbackEntry[];
  logger: Logger;
  callAgent: (message: string) => Promise<ExecuteResponse>;
}

interface LoopContext {
  episodeHints: string[];
  userPreferences: string[];
}

const PHASE_LABELS: Record<string, string> = {
  UNDERSTANDING: 'Entendendo o pedido',
  GATHERING_CONTEXT: 'Buscando contexto e memória',
  PLANNING: 'Planejando',
  ACTING: 'Executando',
  OBSERVING: 'Analisando o resultado',
  EVALUATING: 'Validando a resposta',
  REPLANNING: 'Ajustando a estratégia',
  FINALIZING: 'Finalizando',
};

/**
 * Caminho agêntico (AGENT_LOOP_V2) do dispatch single-agent. O agente remoto
 * continua sendo quem "pensa"; o runtime ao redor garante objetivo,
 * contexto, plano, observação, avaliação, replan com estratégia diferente,
 * checkpoint e outcome - tudo rastreável (spec V2 seções 8-12, 66-70).
 */
export async function dispatchWithAgentLoop(params: DispatchParams): Promise<ExecuteResponse> {
  const { data, userId, clientId, logger, callAgent } = params;
  const taskClass: TaskClass = classifyTask(data.message, data.agent);

  // Metadata do node capturada na ÚLTIMA chamada (timings de fase do Otto:
  // classify_ms/retrieval_ms/llm_ms) e propagada na resposta final - sem
  // isto, o caminho V2 descartava a única medição interna do agente.
  let lastNodeMetadata: Record<string, unknown> | undefined;

  // Memórias escopadas por agente usam o uuid da tabela agents, não o nome.
  const [agentRow] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.name, data.agent))
    .catch(() => [] as { id: string }[]);
  const agentUuid = agentRow?.id ?? null;

  const persistCheckpoint = async (state: AgentExecutionState) => {
    await publishWsEvent({
      type: 'agent.phase',
      payload: {
        execution_id: data.executionId,
        conversation_id: data.conversationId,
        agent: data.agent,
        phase: state.phase,
        label: PHASE_LABELS[state.phase] ?? null,
        attempt: state.iterations,
      },
    });
    await db
      .insert(schema.agentExecutionStates)
      .values({
        executionId: data.executionId,
        agent: data.agent,
        userId,
        clientId,
        conversationId: data.conversationId,
        phase: state.phase,
        taskClass,
        iterations: state.iterations,
        evaluatorScore: state.evaluatorScore != null ? String(state.evaluatorScore) : null,
        state: state as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: schema.agentExecutionStates.executionId,
        set: {
          phase: state.phase,
          iterations: state.iterations,
          evaluatorScore: state.evaluatorScore != null ? String(state.evaluatorScore) : null,
          state: state as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });
  };

  const result = await runAgentLoop<LoopContext>(
    {
      understand: async () => ({
        // O goal usa a mensagem ORIGINAL do usuário: data.message chega com
        // os blocos de contexto anexados pela API ("\n\n---\n"), que não
        // fazem parte do pedido.
        goal: goalFor(data.agent, data.message.split('\n\n---\n')[0] ?? data.message),
        successCriteria: successCriteriaFor(data.agent),
        taskClass,
      }),
      gatherContext: async () => {
        // Experience replay (seção 63) + user memory (seção 19): episódios
        // passados do mesmo agente/cliente e preferências do usuário entram
        // no loop. Escopo obrigatório: clientId e userId separam os mundos
        // (seção 48).
        const [episodes, preferences] = await Promise.all([
          recallMemories({ clientId, agentId: agentUuid, kinds: ['agent.episode'], limit: 3 }).catch(() => []),
          userId
            ? recallMemories({ userId, kinds: ['user.preference'], limit: 5 }).catch(() => [])
            : Promise.resolve([]),
        ]);
        return {
          episodeHints: episodes.map((m) => m.content),
          userPreferences: preferences.map((m) => m.content),
        };
      },
      plan: async () => ['entender', 'buscar contexto', 'consultar agente', 'validar resposta', 'entregar'],
      evaluate: evaluatorFor(data.agent),
      act: async (_state, _ctx, attempt): Promise<ActResult> => {
        const startedAt = performance.now();
        // Estratégia 2 é materialmente diferente (seção 11): a mensagem perde
        // os blocos de contexto anexados ("---"), que em Jarbas/Suzy disparam
        // o edge case de classificação de job e no Bento poluem a busca
        // vetorial. É a recuperação de menor custo antes de desistir.
        const message =
          attempt === 1 ? data.message : (data.message.split('\n\n---\n')[0] ?? data.message);
        const strategy = attempt === 1 ? 'dispatch_completo' : 'dispatch_reduzido';
        try {
          const response = await callAgent(message);
          lastNodeMetadata = response.metadata;
          const ok = response.status === 'completed' && Boolean(response.answer?.trim());
          return {
            strategy,
            ok,
            observation: response.answer ?? '',
            toolCalls: [
              {
                tool: `agent:${data.agent}`,
                input_summary: message.slice(0, 120),
                ok,
                duration_ms: Math.round(performance.now() - startedAt),
                ...(response.error ? { error: response.error } : {}),
              },
            ],
            ...(response.error ? { error: response.error } : {}),
            recoverable: true,
          };
        } catch (error) {
          return {
            strategy,
            ok: false,
            observation: '',
            error: error instanceof Error ? error.message : String(error),
            recoverable: true,
          };
        }
      },
      finalize: async (state) => ({
        answer: state.observations.at(-1)?.text ?? '',
      }),
      onPhaseChange: async (state) => {
        // Latência (14/09/2026): cada transição fazia 1 publish WS + 1 upsert
        // no Postgres remoto (~130ms cada) EM SÉRIE com o loop - ~8 fases
        // custavam ~1-2s de overhead por turno. Só fases terminais são
        // aguardadas (o estado final é o que importa pra auditoria); as
        // intermediárias são fire-and-forget.
        const terminal = TERMINAL_PHASES.includes(state.phase);
        const write = persistCheckpoint(state).catch((error: unknown) => {
          logger.warn({ error, executionId: data.executionId }, 'Falha ao persistir checkpoint do agent loop');
        });
        if (terminal) await write;
      },
    },
    {
      executionId: data.executionId,
      requestId: data.executionId,
      agentId: data.agent,
      userId: userId ?? 'unknown',
      clientId,
      conversationId: data.conversationId ?? null,
      originalRequest: data.message,
    },
  );

  const { state, answer, evaluation } = result;
  const completed = state.phase === 'COMPLETED' && answer;

  // Outcome real por execução (seções 66-68): é a fonte dos KPIs de
  // qualidade/aprendizado. Nunca inventado: só existe porque o loop rodou.
  // Fire-and-forget (14/09/2026): a resposta já foi produzida; a gravação
  // analítica não pode atrasar a entrega ao usuário. Falhas vão pro log.
  void db
    .insert(schema.agentOutcomes)
    .values({
      executionId: data.executionId,
      agent: data.agent,
      userId,
      clientId,
      conversationId: data.conversationId,
      goalCompletion: Boolean(completed),
      firstAttemptSuccess: Boolean(completed) && state.iterations === 1,
      iterations: state.iterations,
      toolFailures: state.toolCalls.filter((call) => !call.ok).length,
      evaluatorScore: evaluation != null ? String(evaluation.score) : null,
      latencyMs: Math.round(new Date(state.updatedAt).getTime() - new Date(state.startedAt).getTime()),
      taskClass,
    })
    .onConflictDoNothing()
    .catch((error: unknown) => {
      logger.warn({ error, executionId: data.executionId }, 'Falha ao gravar outcome do agent loop');
    });

  // Episódio (seção 24): o que era o objetivo, qual estratégia funcionou,
  // quantas tentativas. Recuperado no gatherContext de execuções futuras.
  if (completed) {
    void rememberFact({
      kind: 'agent.episode',
      agentId: agentUuid,
      clientId,
      userId,
      content: `Objetivo: ${state.interpretedGoal ?? data.message.slice(0, 200)}. Estratégia vencedora: ${state.strategiesTried.at(-1) ?? 'desconhecida'}. Tentativas: ${state.iterations}. Score: ${state.evaluatorScore ?? 'n/a'}.`,
      sourceType: 'agent',
      sourceId: data.executionId,
      confidence: 0.9,
      importance: state.iterations > 1 ? 0.7 : 0.4,
      subject: `episode:${data.agent}:${(state.interpretedGoal ?? '').slice(0, 80)}`,
    }).catch((error: unknown) => {
      logger.warn({ error, executionId: data.executionId }, 'Falha ao gravar episódio do agent loop');
    });
  }

  const response: ExecuteResponse = {
    execution_id: data.executionId,
    agent: data.agent as AgentName,
    status: completed ? 'completed' : 'failed',
    answer: completed ? answer : null,
    sources: [],
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(completed
      ? {}
      : { error: evaluation?.failures.join('; ') || 'o agente não conseguiu completar o objetivo' }),
    metadata: {
      ...(lastNodeMetadata ? { node: lastNodeMetadata } : {}),
      agentic: {
        task_class: taskClass,
        iterations: state.iterations,
        strategies_tried: state.strategiesTried,
        evaluator_score: state.evaluatorScore,
        phase: state.phase,
      },
    },
  };
  return response;
}
