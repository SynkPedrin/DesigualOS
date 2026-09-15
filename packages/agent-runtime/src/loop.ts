import { createLogger } from '@desigual-os/logging';
import { deterministicEvaluator, type Evaluation, type Evaluator } from './evaluator';
import {
  MAX_ITERATIONS,
  TERMINAL_PHASES,
  createInitialState,
  type AgentExecutionState,
  type AgentPhase,
  type TaskClass,
  type ToolCallRecord,
} from './state';

const logger = createLogger({ service: 'agent-runtime' });

export interface UnderstandResult {
  goal: string;
  successCriteria: string[];
  constraints?: string[];
  taskClass?: TaskClass;
  /** true quando o turno afirma fato sobre estado real e exige evidência (seção 25). */
  requiresEvidence?: boolean;
}

export interface ActResult {
  /** Identificador da estratégia usada. OBRIGATÓRIO ser materialmente
   * diferente entre tentativas - o loop rejeita repetir estratégia que já
   * falhou (seção 11 da spec V2). */
  strategy: string;
  ok: boolean;
  observation: string;
  toolCalls?: ToolCallRecord[];
  artifacts?: { type: string; ref: string }[];
  /** Erro técnico, se houve. */
  error?: string;
  /** true = faz sentido tentar outra estratégia; false = falha terminal
   * (ex: agente offline, permissão negada, informação crítica ausente). */
  recoverable?: boolean;
  /** Sinal explícito de que falta informação que só o usuário tem. */
  needsUserInput?: boolean;
}

export interface AgentLoopHooks<C = unknown> {
  understand: (state: AgentExecutionState) => Promise<UnderstandResult>;
  gatherContext: (state: AgentExecutionState) => Promise<C>;
  plan: (state: AgentExecutionState, context: C) => Promise<string[]>;
  act: (state: AgentExecutionState, context: C, attempt: number) => Promise<ActResult>;
  /** Opcional: evaluator customizado (ex: por agente). Default: deterministicEvaluator. */
  evaluate?: Evaluator;
  finalize: (state: AgentExecutionState, context: C) => Promise<{ answer: string; artifacts?: { type: string; ref: string }[] }>;
  /** Chamado após TODA transição de fase (checkpoint + eventos). */
  onPhaseChange?: (state: AgentExecutionState, previous: AgentPhase) => void | Promise<void>;
}

export interface AgentLoopResult {
  state: AgentExecutionState;
  answer: string | null;
  evaluation: Evaluation | null;
}

function transition(state: AgentExecutionState, phase: AgentPhase): AgentPhase {
  const previous = state.phase;
  state.phase = phase;
  state.updatedAt = new Date().toISOString();
  return previous;
}

/**
 * O loop universal (seções 8-12 da spec V2). O runtime NÃO sabe nada de
 * LLM, ClickUp ou máquinas remotas: os hooks do host executam o trabalho;
 * o runtime garante estado, ordem das fases, limites, avaliação e a regra
 * de ouro do replan (nunca repetir a mesma estratégia).
 */
export async function runAgentLoop<C = unknown>(
  hooks: AgentLoopHooks<C>,
  input: Parameters<typeof createInitialState>[0],
): Promise<AgentLoopResult> {
  const state = createInitialState(input);
  const evaluate = hooks.evaluate ?? deterministicEvaluator;

  const go = async (phase: AgentPhase) => {
    const previous = transition(state, phase);
    await hooks.onPhaseChange?.(state, previous);
  };

  try {
    // STEP 1 - UNDERSTAND
    await go('UNDERSTANDING');
    const understood = await hooks.understand(state);
    state.interpretedGoal = understood.goal;
    state.successCriteria = understood.successCriteria;
    state.constraints = understood.constraints ?? [];
    state.requiresEvidence = understood.requiresEvidence ?? false;
    const taskClass: TaskClass = understood.taskClass ?? 'standard';
    const maxIterations = MAX_ITERATIONS[taskClass];

    // STEP 2 - CONTEXT
    await go('GATHERING_CONTEXT');
    const context = await hooks.gatherContext(state);

    // STEP 3 - PLAN
    await go('PLANNING');
    state.plan = await hooks.plan(state, context);

    // STEPS 4-7 - ACT / OBSERVE / EVALUATE / DECIDE
    let lastEvaluation: Evaluation | null = null;
    while (state.iterations < maxIterations) {
      state.iterations += 1;
      await go('ACTING');

      const result = await hooks.act(state, context, state.iterations);

      // Guard do replan honesto: estratégia repetida depois de falha é
      // loop infinito disfarçado. O runtime corta aqui (seção 11).
      if (state.strategiesTried.includes(result.strategy)) {
        logger.error(
          { executionId: state.executionId, strategy: result.strategy, attempt: state.iterations },
          'Tentativa repetiu estratégia já falha; encerrando em vez de fazer retry cego',
        );
        await go('FAILED');
        return { state, answer: null, evaluation: lastEvaluation };
      }
      state.strategiesTried.push(result.strategy);
      if (result.toolCalls) state.toolCalls.push(...result.toolCalls);
      if (result.artifacts) state.artifacts.push(...result.artifacts);

      await go('OBSERVING');
      state.observations.push({
        text: result.observation,
        strategy: result.strategy,
        attempt: state.iterations,
      });

      if (result.needsUserInput) {
        await go('NEEDS_USER_INPUT');
        const final = await hooks.finalize(state, context);
        return { state, answer: final.answer, evaluation: null };
      }

      await go('EVALUATING');
      lastEvaluation = evaluate({ state, observation: state.observations[state.observations.length - 1]!, actOk: result.ok });
      state.evaluatorScore = lastEvaluation.score;

      if (result.ok && lastEvaluation.pass) {
        await go('FINALIZING');
        const final = await hooks.finalize(state, context);
        if (final.artifacts) state.artifacts.push(...final.artifacts);
        await go('COMPLETED');
        return { state, answer: final.answer, evaluation: lastEvaluation };
      }

      if (result.recoverable === false) {
        await go('FAILED');
        return { state, answer: null, evaluation: lastEvaluation };
      }

      // DECIDE: falhou mas dá pra tentar de outro jeito.
      await go('REPLANNING');
      logger.info(
        {
          executionId: state.executionId,
          attempt: state.iterations,
          maxIterations,
          score: lastEvaluation.score,
          failures: lastEvaluation.failures,
        },
        'Tentativa reprovada; replanejando com estratégia diferente',
      );
    }

    // Limite de iterações: encerra honesto, nunca entrega o que não passou.
    await go('FAILED');
    return { state, answer: null, evaluation: lastEvaluation };
  } catch (error) {
    logger.error({ error, executionId: state.executionId, phase: state.phase }, 'Falha não tratada no agent loop');
    if (!TERMINAL_PHASES.includes(state.phase)) {
      await go('FAILED');
    }
    throw error;
  }
}
