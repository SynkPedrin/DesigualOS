import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STEP_LIMITS, buildPlan, inferPlanSignals, runStepLoop, type StepHandler, type StepLoopHooks } from '@desigual-os/agent-runtime';
import { createInitialState } from '@desigual-os/agent-runtime';
import type { OperationTask } from '@desigual-os/tool-gateway';
import { authorizeAction, proposeActions } from './agent-actions';
import { executeAction, type ExecutionDeps } from './action-executor';

/**
 * O teste que o release gate exigia: UMA execução com MAIS DE UMA tool real,
 * observação entre elas e read-back — e não "uma chamada ao node + texto".
 */

const HOJE = new Date('2026-09-15T00:00:00').getTime();
const ONTEM = new Date('2026-09-13T12:00:00').getTime();
const QA = 'lista-qa';

function task(over: Partial<OperationTask> = {}): OperationTask {
  return {
    id: 't1', name: 'Task', description: null, status: 'aberto', statusType: 'open', priority: null,
    url: null, dueDate: null, startDate: null, createdAt: null, updatedAt: null,
    assignees: ['Ana'], tags: [], listId: QA, listName: 'QA', folderName: null, spaceId: null,
    ...over,
  };
}

describe('sinal de autonomia', () => {
  it('"resolva automaticamente" liga o modo autônomo', () => {
    expect(inferPlanSignals('organize minha operacao e resolva automaticamente o que puder').autonomous).toBe(true);
  });
  it('análise pura NÃO vira mandato de escrita', () => {
    expect(inferPlanSignals('como esta a operacao hoje').autonomous).toBe(false);
  });
  it('o plano autônomo tem passo de AÇÃO e de verificação', () => {
    const p = buildPlan({
      agent: 'bento', objective: 'organize a operacao e resolva o que puder', taskClass: 'complex',
      requiresEvidence: true, hasOperationalData: true, writeIntent: false, operationsAnalysis: true,
      creative: false, autonomous: true,
    });
    expect(p.steps.map((s) => s.type)).toEqual(['retrieve', 'analyze', 'analyze', 'tool', 'verify', 'evaluate']);
  });
});

describe('ciclo autônomo: tool A -> observação -> tool B -> read-back', () => {
  function deps(over: Partial<ExecutionDeps> = {}): ExecutionDeps {
    return {
      addComment: vi.fn(async () => ({ id: 'c1' })),
      readComments: vi.fn(async () => [{ id: 'c1', text: '[bento:atraso] ok' }]),
      readTask: (async () => ({ id: 't1', name: 'Task', status: 'aberto', assignees: [], dueDate: null })) as never,
      editTask: (async () => undefined) as never,
      ...over,
    };
  }

  it('duas tasks atrasadas produzem DUAS escritas, cada uma com read-back', async () => {
    const config = { apiKey: 'k', teamId: 't' } as Parameters<typeof executeAction>[0];
    const tasks = [task({ id: 't1', dueDate: ONTEM }), task({ id: 't2', dueDate: ONTEM })];
    const acoes = proposeActions(tasks, { startOfToday: HOJE });
    const policy = { writeScopeListId: QA, listIdPorTask: new Map(tasks.map((t) => [t.id, t.listId])) };
    const d = deps();

    const chamadas: string[] = [];
    for (const acao of acoes) {
      if (!authorizeAction(acao, policy).authorized) continue;
      const r = await executeAction(config, acao, d);
      chamadas.push(`${r.toolCall.tool}:${r.action.taskId}:${r.verified ? 'verificada' : 'nao'}`);
    }

    expect(chamadas).toEqual([
      'clickup.create_comment:t1:verificada',
      'clickup.create_comment:t2:verificada',
    ]);
    expect(d.addComment).toHaveBeenCalledTimes(2);
    expect(d.readComments).toHaveBeenCalledTimes(2);
  });

  it('o runtime progride o plano inteiro com o passo de ação no meio', async () => {
    const executadas: string[] = [];
    const plan = buildPlan({
      agent: 'bento', objective: 'organize a operacao e resolva o que puder', taskClass: 'complex',
      requiresEvidence: true, hasOperationalData: true, writeIntent: false, operationsAnalysis: true,
      creative: false, autonomous: true,
    });
    const state = createInitialState({
      executionId: 'EXE-1', requestId: 'r', agentId: 'bento', userId: 'u', clientId: null,
      conversationId: null, originalRequest: 'organize',
    });
    state.structuredPlan = plan;
    state.requiresEvidence = false;

    const h = (nome: string): StepHandler => async () => {
      executadas.push(nome);
      return nome === 'tool'
        ? {
            ok: true,
            observation: 'ações: 2 executada(s)',
            toolCalls: [
              { tool: 'clickup.query_tasks', input_summary: QA, ok: true, duration_ms: 1 },
              { tool: 'clickup.create_comment', input_summary: 't1', ok: true, duration_ms: 1 },
            ],
          }
        : { ok: true, observation: nome, ...(nome === 'evaluate' ? { answer: 'relatório' } : {}) };
    };

    const hooks: StepLoopHooks = {
      handlers: { retrieve: h('retrieve'), analyze: h('analyze'), tool: h('tool'), verify: h('verify'), evaluate: h('evaluate') },
      checkSuccess: (s) => {
        const acao = s.structuredPlan?.steps.find((x) => x.type === 'tool');
        return acao?.status === 'completed'
          ? { satisfied: true, missing: [] }
          : { satisfied: false, missing: ['ciclo de ação executado'] };
      },
      finalize: async () => ({ answer: 'relatório final' }),
    };

    const r = await runStepLoop(hooks, state, DEFAULT_STEP_LIMITS);

    expect(r.completed).toBe(true);
    expect(executadas).toEqual(['retrieve', 'analyze', 'analyze', 'tool', 'verify', 'evaluate']);
    // MAIS DE UMA tool real na MESMA execução — o critério do gate.
    expect(state.toolCalls.map((c) => c.tool)).toEqual(['clickup.query_tasks', 'clickup.create_comment']);
  });

  it('read-back que não bate NÃO conta como resolvido e força replan', async () => {
    const config = { apiKey: 'k', teamId: 't' } as Parameters<typeof executeAction>[0];
    const [acao] = proposeActions([task({ dueDate: ONTEM })], { startOfToday: HOJE });
    // escrita "aceita", releitura sem o comentário: é falha, não sucesso.
    const r = await executeAction(config, acao!, deps({ readComments: async () => [] }));
    expect(r.ok).toBe(false);
    expect(r.action.status).toBe('failed');

    let replanejou = false;
    const state = createInitialState({
      executionId: 'EXE-2', requestId: 'r', agentId: 'bento', userId: 'u', clientId: null,
      conversationId: null, originalRequest: 'organize',
    });
    state.structuredPlan = buildPlan({
      agent: 'bento', objective: 'organize a operacao e resolva o que puder', taskClass: 'complex',
      requiresEvidence: false, hasOperationalData: true, writeIntent: false, operationsAnalysis: true,
      creative: false, autonomous: true,
    });
    const hooks: StepLoopHooks = {
      handlers: {
        retrieve: async () => ({ ok: true, observation: 'estado' }),
        analyze: async () => ({ ok: true, observation: 'analisado' }),
        tool: async () => ({ ok: false, observation: 'read-back não bateu', recoverable: true }),
        verify: async () => ({ ok: true, observation: 'v' }),
        evaluate: async () => ({ ok: true, observation: 'e' }),
      },
      checkSuccess: () => ({ satisfied: false, missing: ['ação verificada'] }),
      replan: async () => { replanejou = true; return null; },
      finalize: async () => ({ answer: '' }),
    };
    const loop = await runStepLoop(hooks, state, { ...DEFAULT_STEP_LIMITS, maxRetriesPerStep: 1 });
    expect(replanejou).toBe(true);
    expect(loop.completed).toBe(false);
  });
});
