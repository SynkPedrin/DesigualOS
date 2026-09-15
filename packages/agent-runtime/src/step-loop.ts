import { createLogger } from '@desigual-os/logging';
import type { AgentExecutionState, Evidence, ToolCallRecord } from './state';
import type { AgentPlan, PlanStep, PlanStepType } from './planner';
import { deterministicEvaluator, type Evaluation, type Evaluator } from './evaluator';

const logger = createLogger({ service: 'agent-runtime:step-loop' });

/**
 * step-loop.ts — o controlador MULTI-STEP real do Agent Runtime (§ FASE 1).
 *
 * O runtime deixa de ser "callAgent() e pronto": agora ELE controla a
 * progressão — escolhe o próximo passo do plano, executa via handler, coleta
 * observação, anexa evidência, verifica, avalia, e só encerra quando os
 * critérios de sucesso são satisfeitos OU a execução esbarra num limite. O
 * node/LLM continua sendo a inteligência DENTRO dos passos 'analyze'/'tool';
 * o runtime é quem manda no estado e na ordem. Tudo aqui é testável com
 * handlers injetados (sem rede), que é como as proteções de loop são provadas.
 */

export interface StepObservation {
  stepId: string;
  type: PlanStepType;
  ok: boolean;
  text: string;
  attempt: number;
}

export interface StepContext {
  state: AgentExecutionState;
  step: PlanStep;
  attempt: number;
  /** Observações já produzidas neste run — o passo atual USA o resultado do anterior (§70). */
  previousObservations: StepObservation[];
}

export interface StepResult {
  ok: boolean;
  observation: string;
  evidence?: Evidence[];
  toolCalls?: ToolCallRecord[];
  /** Assinatura da ação (tool+args) — base da detecção de tool repetida (§71). */
  toolSignature?: string;
  error?: string;
  /** false = falha terminal (permissão negada, recurso ausente): não replaneja. */
  recoverable?: boolean;
  /** Resposta parcial/final que o passo produziu (usada no finalize). */
  answer?: string;
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;

export interface SuccessCheck {
  satisfied: boolean;
  /** Critérios obrigatórios ainda não satisfeitos (vazio quando satisfied). */
  missing: string[];
}

export interface StepLoopLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxRetriesPerStep: number;
  maxDurationMs: number;
  /** Mesma assinatura de tool repetida esse número de vezes → aborta (§71). */
  repeatedToolThreshold: number;
}

export const DEFAULT_STEP_LIMITS: StepLoopLimits = {
  maxSteps: 12,
  maxToolCalls: 8,
  maxRetriesPerStep: 2,
  maxDurationMs: 120_000,
  repeatedToolThreshold: 3,
};

export interface StepLoopHooks {
  /** Um handler por TIPO de passo. 'tool' pode ser reusado por vários passos tool. */
  handlers: Partial<Record<PlanStepType, StepHandler>>;
  /** Checagem determinística de critérios de sucesso — controla o término (§18-19). */
  checkSuccess?: (state: AgentExecutionState) => SuccessCheck;
  evaluate?: Evaluator;
  /** Replan quando um passo falha de forma recuperável: devolve NOVO plano ou null. */
  replan?: (state: AgentExecutionState, failure: string) => Promise<AgentPlan | null>;
  /** Produz a resposta final a partir do estado + observações. */
  finalize: (state: AgentExecutionState, observations: StepObservation[]) => Promise<{ answer: string }>;
  /** Notificado a cada passo concluído (para checkpoint/observabilidade). */
  onStep?: (state: AgentExecutionState, step: PlanStep, result: StepResult) => void | Promise<void>;
}

export type TerminationReason =
  | 'success_criteria_met'
  | 'plan_completed'
  | 'max_steps'
  | 'max_tool_calls'
  | 'timeout'
  | 'repeated_tool'
  | 'dead_end'
  | 'replan_exhausted'
  | 'no_runnable_step';

export interface StepLoopResult {
  state: AgentExecutionState;
  answer: string | null;
  evaluation: Evaluation | null;
  terminationReason: TerminationReason;
  observations: StepObservation[];
  completed: boolean;
}

/** Próximo passo pendente cujas dependências já foram concluídas. */
export function nextRunnableStep(plan: AgentPlan): PlanStep | null {
  const done = new Set(plan.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').map((s) => s.id));
  for (const step of plan.steps) {
    if (step.status !== 'pending') continue;
    const deps = step.dependsOn ?? [];
    if (deps.every((d) => done.has(d))) return step;
  }
  return null;
}

interface Clock {
  now(): number;
}
const REAL_CLOCK: Clock = { now: () => Date.now() };

/**
 * Executa o plano passo a passo. Retorna o motivo do término explícito — é o
 * que torna a execução diagnosticável e o que prova, no teste, que cada
 * proteção (maxSteps, maxToolCalls, timeout, tool repetida, dead-end) dispara.
 */
export async function runStepLoop(
  hooks: StepLoopHooks,
  state: AgentExecutionState,
  limits: StepLoopLimits = DEFAULT_STEP_LIMITS,
  clock: Clock = REAL_CLOCK,
): Promise<StepLoopResult> {
  const evaluate = hooks.evaluate ?? deterministicEvaluator;
  const observations: StepObservation[] = [];
  const startedAt = clock.now();
  const signatureCounts = new Map<string, number>();
  let stepsExecuted = 0;
  let toolCalls = 0;
  let lastEvaluation: Evaluation | null = null;

  const finish = async (reason: TerminationReason, completed: boolean): Promise<StepLoopResult> => {
    let answer: string | null = null;
    if (completed) {
      const final = await hooks.finalize(state, observations);
      answer = final.answer;
    }
    return { state, answer, evaluation: lastEvaluation, terminationReason: reason, observations, completed };
  };

  const successSatisfied = (): boolean => {
    if (!hooks.checkSuccess) return false;
    return hooks.checkSuccess(state).satisfied;
  };

  /**
   * Passos de PORTA: verificação e avaliação. Término antecipado por critério
   * de sucesso NÃO pode pular estes — eles são justamente o que decide se a
   * resposta pode ser entregue.
   *
   * Sem isto o loop fechava em 'success_criteria_met' logo depois do passo de
   * análise (o critério típico é "tem resposta + tem evidência", satisfeito
   * assim que o node responde), e verify/evaluate ficavam 'pending' PARA
   * SEMPRE. Medido ao vivo no release gate (15/09/2026): toda execução do
   * Bento terminava com score 1.0 e os dois passos de porta nunca executados —
   * o grounding e o evaluator eram, na prática, código morto.
   */
  const portasPendentes = (): boolean =>
    (state.structuredPlan?.steps ?? []).some((s) => s.status === 'pending' && (s.type === 'verify' || s.type === 'evaluate'));

  while (true) {
    // Limites GLOBAIS antes de pegar o próximo passo (§72).
    if (clock.now() - startedAt > limits.maxDurationMs) return finish('timeout', false);
    if (stepsExecuted >= limits.maxSteps) return finish('max_steps', false);

    const plan = state.structuredPlan;
    if (!plan) return finish('no_runnable_step', false);

    const step = nextRunnableStep(plan);
    if (!step) {
      // Plano esgotado: concluído SÓ se os critérios de sucesso permitirem.
      if (!hooks.checkSuccess || successSatisfied()) return finish('plan_completed', true);
      // Faltou critério e não há passo: tenta replanejar uma vez.
      const failure = `plano terminou sem satisfazer: ${hooks.checkSuccess(state).missing.join('; ')}`;
      const replanned = hooks.replan ? await hooks.replan(state, failure) : null;
      if (replanned && replanned.steps.some((s) => s.status === 'pending')) {
        state.structuredPlan = replanned;
        state.phase = 'REPLANNING';
        continue;
      }
      return finish('replan_exhausted', false);
    }

    const handler = hooks.handlers[step.type];
    step.status = 'running';
    stepsExecuted += 1;
    if (step.type === 'tool') toolCalls += 1;
    if (toolCalls > limits.maxToolCalls) return finish('max_tool_calls', false);

    // Sem handler para o tipo → passo é pulado (não trava a execução).
    if (!handler) {
      step.status = 'skipped';
      continue;
    }

    let stepOk = false;
    let lastResult: StepResult | null = null;
    for (let attempt = 1; attempt <= limits.maxRetriesPerStep; attempt += 1) {
      const result = await handler({ state, step, attempt, previousObservations: observations });
      lastResult = result;

      if (result.toolCalls) state.toolCalls.push(...result.toolCalls);
      if (result.evidence?.length) state.evidence.push(...result.evidence);

      // Detecção de tool repetida (§71): mesma assinatura N vezes → aborta.
      if (result.toolSignature) {
        const count = (signatureCounts.get(result.toolSignature) ?? 0) + 1;
        signatureCounts.set(result.toolSignature, count);
        if (count >= limits.repeatedToolThreshold) {
          observations.push({ stepId: step.id, type: step.type, ok: false, text: result.observation, attempt });
          step.status = 'failed';
          return finish('repeated_tool', false);
        }
      }

      observations.push({ stepId: step.id, type: step.type, ok: result.ok, text: result.observation, attempt });
      await hooks.onStep?.(state, step, result);

      if (result.ok) {
        stepOk = true;
        break;
      }
      if (result.recoverable === false) {
        step.status = 'failed';
        return finish('dead_end', false);
      }
      // senão: retry deste passo (até maxRetriesPerStep).
    }

    if (stepOk) {
      step.status = 'completed';
    } else {
      // Esgotou retries do passo: replaneja se puder.
      step.status = 'failed';
      const failure = lastResult?.error ?? `passo '${step.objective}' falhou após ${limits.maxRetriesPerStep} tentativa(s)`;
      const replanned = hooks.replan ? await hooks.replan(state, failure) : null;
      if (replanned && replanned.steps.some((s) => s.status === 'pending')) {
        state.structuredPlan = replanned;
        state.phase = 'REPLANNING';
        logger.info({ executionId: state.executionId, failure }, 'Passo falhou; replanejando');
        continue;
      }
      return finish('replan_exhausted', false);
    }

    // Avaliação incremental + término por critério de sucesso (§18-19).
    const lastObs = observations[observations.length - 1]!;
    lastEvaluation = evaluate({ state, observation: { text: lastObs.text, strategy: step.type, attempt: lastObs.attempt }, actOk: true });
    state.evaluatorScore = lastEvaluation.score;

    if (successSatisfied() && !portasPendentes()) return finish('success_criteria_met', true);
  }
}
