import { describe, expect, it } from 'vitest';
import { runStepLoop, nextRunnableStep, type StepHandler, type StepLoopHooks, type StepLoopLimits, type StepResult } from './step-loop';
import { createInitialState, type AgentExecutionState } from './state';
import type { AgentPlan, PlanStep } from './planner';

function state(plan: AgentPlan): AgentExecutionState {
  const s = createInitialState({
    executionId: 'EXE-1', requestId: 'r', agentId: 'bento', userId: 'u',
    clientId: null, conversationId: null, originalRequest: 'x',
  });
  s.structuredPlan = plan;
  return s;
}
function step(id: string, type: PlanStep['type'], extra: Partial<PlanStep> = {}): PlanStep {
  return { id, type, objective: `obj-${id}`, status: 'pending', ...extra };
}
function plan(steps: PlanStep[]): AgentPlan {
  return { objective: 'o', steps, knowledgeGaps: [], status: 'active' };
}
const ok = (obs: string): StepResult => ({ ok: true, observation: obs });
const fail = (extra: Partial<StepResult> = {}): StepResult => ({ ok: false, observation: 'falhou', ...extra });

const FAST: StepLoopLimits = { maxSteps: 12, maxToolCalls: 8, maxRetriesPerStep: 2, maxDurationMs: 120_000, repeatedToolThreshold: 3 };
const fakeClock = (times: number[]) => { let i = 0; return { now: () => times[Math.min(i++, times.length - 1)]! }; };

describe('nextRunnableStep — respeita dependsOn', () => {
  it('não roda passo cujo dependsOn ainda não concluiu', () => {
    const p = plan([step('a', 'retrieve'), step('b', 'analyze', { dependsOn: ['a'] })]);
    expect(nextRunnableStep(p)?.id).toBe('a');
    p.steps[0]!.status = 'completed';
    expect(nextRunnableStep(p)?.id).toBe('b');
  });
});

describe('runStepLoop — progressão multi-step real', () => {
  it('executa todos os passos em ordem e conclui', async () => {
    const seen: string[] = [];
    const h: StepHandler = async ({ step }) => { seen.push(step.id); return ok(`ran ${step.id}`); };
    const hooks: StepLoopHooks = {
      handlers: { retrieve: h, analyze: h, tool: h, verify: h, evaluate: h },
      finalize: async (_s, obs) => ({ answer: `done:${obs.length}` }),
    };
    const r = await runStepLoop(hooks, state(plan([step('a', 'retrieve'), step('b', 'tool'), step('c', 'verify')])), FAST);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(r.completed).toBe(true);
    expect(r.terminationReason).toBe('plan_completed');
    expect(r.answer).toBe('done:3');
  });

  it('a observação de um passo alimenta o próximo (§70)', async () => {
    let passedPrev = -1;
    const hooks: StepLoopHooks = {
      handlers: {
        retrieve: async () => ok('achei 6 tarefas'),
        analyze: async ({ previousObservations }) => { passedPrev = previousObservations.length; return ok('analisei'); },
      },
      finalize: async () => ({ answer: 'ok' }),
    };
    await runStepLoop(hooks, state(plan([step('a', 'retrieve'), step('b', 'analyze', { dependsOn: ['a'] })])), FAST);
    expect(passedPrev).toBe(1); // o analyze viu a observação do retrieve
  });

  it('critérios de sucesso controlam o término (§18-19)', async () => {
    let ran = 0;
    const hooks: StepLoopHooks = {
      handlers: { retrieve: async () => { ran++; return ok('r'); }, analyze: async () => { ran++; return ok('a'); } },
      // sucesso já satisfeito depois do 1º passo:
      checkSuccess: () => ({ satisfied: ran >= 1, missing: ran >= 1 ? [] : ['algo'] }),
      finalize: async () => ({ answer: 'entregue' }),
    };
    const r = await runStepLoop(hooks, state(plan([step('a', 'retrieve'), step('b', 'analyze'), step('c', 'analyze')])), FAST);
    expect(r.terminationReason).toBe('success_criteria_met');
    expect(r.completed).toBe(true);
    expect(ran).toBe(1); // parou cedo: passo comum pendente pode ser pulado
  });

  /**
   * Regressão do achado do release gate (15/09/2026): o término antecipado
   * pulava verify/evaluate, que ficavam 'pending' para sempre. Na prática o
   * grounding e o evaluator do Bento NUNCA rodavam — toda execução fechava
   * com score 1.0 sem verificação nenhuma.
   */
  it('término antecipado NÃO pula verify nem evaluate (§25)', async () => {
    const rodados: string[] = [];
    const hooks: StepLoopHooks = {
      handlers: {
        retrieve: async () => { rodados.push('retrieve'); return ok('r'); },
        analyze: async () => { rodados.push('analyze'); return ok('a'); },
        verify: async () => { rodados.push('verify'); return ok('v'); },
        evaluate: async () => { rodados.push('evaluate'); return ok('e'); },
      },
      checkSuccess: () => ({ satisfied: true, missing: [] }), // sempre satisfeito
      finalize: async () => ({ answer: 'entregue' }),
    };
    const p = plan([step('a', 'retrieve'), step('b', 'analyze'), step('c', 'verify'), step('d', 'evaluate')]);
    const r = await runStepLoop(hooks, state(p), FAST);
    expect(rodados).toEqual(['retrieve', 'analyze', 'verify', 'evaluate']);
    expect(r.completed).toBe(true);
    expect(p.steps.every((x) => x.status === 'completed')).toBe(true);
  });

  it('verify que reprova derruba o término antecipado e força replan', async () => {
    let replanejou = false;
    const hooks: StepLoopHooks = {
      handlers: {
        analyze: async () => ok('a'),
        verify: async () => ({ ok: false, observation: 'contagem inconsistente', recoverable: true }),
      },
      checkSuccess: () => ({ satisfied: true, missing: [] }),
      replan: async () => { replanejou = true; return null; },
      finalize: async () => ({ answer: 'entregue' }),
    };
    const r = await runStepLoop(hooks, state(plan([step('a', 'analyze'), step('b', 'verify')])), FAST);
    expect(replanejou).toBe(true);
    expect(r.completed).toBe(false);
  });

  it('NÃO conclui se o plano acaba sem satisfazer critérios (e sem replan)', async () => {
    const hooks: StepLoopHooks = {
      handlers: { analyze: async () => ok('a') },
      checkSuccess: () => ({ satisfied: false, missing: ['task exists'] }),
      finalize: async () => ({ answer: 'nunca' }),
    };
    const r = await runStepLoop(hooks, state(plan([step('a', 'analyze')])), FAST);
    expect(r.completed).toBe(false);
    expect(r.terminationReason).toBe('replan_exhausted');
    expect(r.answer).toBeNull();
  });

  it('replaneja quando um passo falha de forma recuperável', async () => {
    let firstPlanTried = false;
    const hooks: StepLoopHooks = {
      handlers: {
        tool: async () => { firstPlanTried = true; return fail({ recoverable: true, error: 'not found' }); },
        analyze: async () => ok('achei por outro caminho'),
      },
      replan: async () => plan([step('b2', 'analyze')]),
      checkSuccess: () => ({ satisfied: true, missing: [] }),
      finalize: async () => ({ answer: 'recuperado' }),
    };
    const r = await runStepLoop(hooks, state(plan([step('a', 'tool')])), { ...FAST, maxRetriesPerStep: 1 });
    expect(firstPlanTried).toBe(true);
    expect(r.completed).toBe(true);
    expect(r.answer).toBe('recuperado');
  });

  it('dead-end (recoverable=false) encerra sem replanejar', async () => {
    const hooks: StepLoopHooks = {
      handlers: { tool: async () => fail({ recoverable: false, error: 'permissão negada' }) },
      replan: async () => plan([step('x', 'analyze')]),
      finalize: async () => ({ answer: 'no' }),
    };
    const r = await runStepLoop(hooks, state(plan([step('a', 'tool')])), FAST);
    expect(r.terminationReason).toBe('dead_end');
    expect(r.completed).toBe(false);
  });

  it('maxSteps corta a execução', async () => {
    const loopingPlan = plan(Array.from({ length: 20 }, (_, i) => step(`s${i}`, 'analyze')));
    const hooks: StepLoopHooks = { handlers: { analyze: async () => ok('a') }, finalize: async () => ({ answer: 'x' }) };
    const r = await runStepLoop(hooks, state(loopingPlan), { ...FAST, maxSteps: 3 });
    expect(r.terminationReason).toBe('max_steps');
  });

  it('maxToolCalls corta a execução', async () => {
    const toolPlan = plan(Array.from({ length: 10 }, (_, i) => step(`t${i}`, 'tool')));
    const hooks: StepLoopHooks = { handlers: { tool: async () => ok('t') }, finalize: async () => ({ answer: 'x' }) };
    const r = await runStepLoop(hooks, state(toolPlan), { ...FAST, maxToolCalls: 2 });
    expect(r.terminationReason).toBe('max_tool_calls');
  });

  it('detecção de tool repetida aborta (§71): mesma tool+args N vezes', async () => {
    // A patologia real: o agente CHAMA a mesma tool com os mesmos args de novo
    // e de novo (mesmo "tendo sucesso"), sem progredir. Trip no threshold.
    const toolPlan = plan(Array.from({ length: 10 }, (_, i) => step(`t${i}`, 'tool')));
    const hooks: StepLoopHooks = {
      handlers: { tool: async () => ({ ok: true, observation: 'mesmo resultado', toolSignature: 'clickup.getTask({id:1})' }) },
      checkSuccess: () => ({ satisfied: false, missing: ['nunca satisfeito'] }),
      finalize: async () => ({ answer: 'x' }),
    };
    const r = await runStepLoop(hooks, state(toolPlan), { ...FAST, repeatedToolThreshold: 3 });
    expect(r.terminationReason).toBe('repeated_tool');
  });

  it('timeout corta a execução', async () => {
    const p = plan([step('a', 'analyze'), step('b', 'analyze')]);
    const hooks: StepLoopHooks = { handlers: { analyze: async () => ok('a') }, finalize: async () => ({ answer: 'x' }) };
    // clock: start=0, então já passou do maxDuration na 1ª checagem de limite
    const r = await runStepLoop(hooks, state(p), { ...FAST, maxDurationMs: 10 }, fakeClock([0, 1000, 2000]));
    expect(r.terminationReason).toBe('timeout');
  });
});
