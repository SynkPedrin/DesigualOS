import { describe, expect, it, vi } from 'vitest';
import { deterministicEvaluator } from './evaluator';
import { runAgentLoop, type ActResult, type AgentLoopHooks } from './loop';
import { createInitialState } from './state';

const baseInput = {
  executionId: 'EXE-TEST-1',
  requestId: 'req-1',
  agentId: 'bento',
  userId: 'user-1',
  clientId: null,
  conversationId: 'conv-1',
  originalRequest: 'Quais tarefas vencem amanhã?',
};

function makeHooks(overrides: Partial<AgentLoopHooks<{ data: string }>>): AgentLoopHooks<{ data: string }> {
  return {
    understand: async () => ({ goal: 'listar tarefas de amanhã', successCriteria: ['tarefas'], taskClass: 'standard' }),
    gatherContext: async () => ({ data: 'contexto' }),
    plan: async () => ['buscar tasks', 'filtrar', 'resumir'],
    act: async () => ({ strategy: 'consulta_direta', ok: true, observation: 'tarefas: A, B, C' }),
    finalize: async (state) => ({ answer: `Resposta: ${state.observations.at(-1)?.text}` }),
    ...overrides,
  };
}

describe('runAgentLoop', () => {
  it('caminho feliz: passa por todas as fases e completa com resposta', async () => {
    const phases: string[] = [];
    const result = await runAgentLoop(
      makeHooks({ onPhaseChange: (state) => void phases.push(state.phase) }),
      baseInput,
    );
    expect(result.state.phase).toBe('COMPLETED');
    expect(result.answer).toContain('tarefas');
    expect(result.state.iterations).toBe(1);
    expect(phases).toEqual([
      'UNDERSTANDING',
      'GATHERING_CONTEXT',
      'PLANNING',
      'ACTING',
      'OBSERVING',
      'EVALUATING',
      'FINALIZING',
      'COMPLETED',
    ]);
    expect(result.state.evaluatorScore).toBeGreaterThanOrEqual(0.6);
  });

  it('SELF-CORRECTION: primeira estratégia falha, segunda (diferente) entrega', async () => {
    const strategies: string[] = [];
    const result = await runAgentLoop(
      makeHooks({
        act: async (_state, _ctx, attempt): Promise<ActResult> => {
          if (attempt === 1) {
            strategies.push('consulta_ampla');
            return { strategy: 'consulta_ampla', ok: false, observation: '', error: 'timeout', recoverable: true };
          }
          strategies.push('consulta_por_cliente');
          return { strategy: 'consulta_por_cliente', ok: true, observation: 'tarefas de amanhã: criativo da Julia' };
        },
      }),
      baseInput,
    );
    expect(result.state.phase).toBe('COMPLETED');
    expect(result.state.iterations).toBe(2);
    expect(strategies).toEqual(['consulta_ampla', 'consulta_por_cliente']);
    expect(result.state.strategiesTried).toHaveLength(2);
    expect(result.answer).toContain('criativo da Julia');
  });

  it('REJEITA retry idêntico: mesma estratégia duas vezes vira FAILED, nunca loop infinito', async () => {
    const actCalls: number[] = [];
    const result = await runAgentLoop(
      makeHooks({
        act: async (_state, _ctx, attempt): Promise<ActResult> => {
          actCalls.push(attempt);
          return { strategy: 'mesma_estrategia', ok: false, observation: '', error: 'falhou', recoverable: true };
        },
      }),
      baseInput,
    );
    expect(result.state.phase).toBe('FAILED');
    expect(actCalls).toHaveLength(2); // tentou 1x, falhou, repetiu igual, cortou
    expect(result.answer).toBeNull();
  });

  it('respeita o limite de iterações por classe de tarefa', async () => {
    let calls = 0;
    const result = await runAgentLoop(
      makeHooks({
        understand: async () => ({ goal: 'x', successCriteria: [], taskClass: 'simple' }),
        act: async (_s, _c, attempt): Promise<ActResult> => {
          calls += 1;
          return { strategy: `estrategia_${attempt}`, ok: false, observation: 'parcial', recoverable: true };
        },
      }),
      baseInput,
    );
    expect(result.state.phase).toBe('FAILED');
    expect(calls).toBe(2); // MAX_ITERATIONS.simple
  });

  it('falha não recuperável encerra sem gastar iterações', async () => {
    let calls = 0;
    const result = await runAgentLoop(
      makeHooks({
        act: async (): Promise<ActResult> => {
          calls += 1;
          return { strategy: 'dispatch', ok: false, observation: '', error: 'agente offline', recoverable: false };
        },
      }),
      baseInput,
    );
    expect(result.state.phase).toBe('FAILED');
    expect(calls).toBe(1);
  });

  it('needsUserInput encerra em NEEDS_USER_INPUT com resposta do finalize', async () => {
    const result = await runAgentLoop(
      makeHooks({
        act: async (): Promise<ActResult> => ({
          strategy: 'consulta',
          ok: true,
          observation: 'faltou o cliente',
          needsUserInput: true,
        }),
        finalize: async () => ({ answer: 'De qual cliente você está falando?' }),
      }),
      baseInput,
    );
    expect(result.state.phase).toBe('NEEDS_USER_INPUT');
    expect(result.answer).toBe('De qual cliente você está falando?');
  });

  it('checkpoint: onPhaseChange recebe o estado atualizado em cada transição', async () => {
    const checkpoints: string[] = [];
    await runAgentLoop(
      makeHooks({
        onPhaseChange: (state, previous) => {
          checkpoints.push(`${previous}->${state.phase}`);
        },
      }),
      baseInput,
    );
    expect(checkpoints[0]).toBe('RECEIVED->UNDERSTANDING');
    expect(checkpoints.at(-1)).toBe('FINALIZING->COMPLETED');
    expect(checkpoints.length).toBe(8);
  });

  it('exceção não tratada no hook vira FAILED e propaga', async () => {
    await expect(
      runAgentLoop(
        makeHooks({
          gatherContext: async () => {
            throw new Error('banco fora');
          },
        }),
        baseInput,
      ),
    ).rejects.toThrow('banco fora');
  });
});

describe('deterministicEvaluator', () => {
  const state = createInitialState(baseInput);
  state.successCriteria = ['tarefas de amanhã'];

  it('reprova observação vazia', () => {
    const evaluation = deterministicEvaluator({ state, observation: { text: '', strategy: 's', attempt: 1 }, actOk: false });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failures.length).toBeGreaterThan(0);
  });

  it('reprova vazamento de mecanismo interno', () => {
    const evaluation = deterministicEvaluator({
      state,
      observation: { text: 'tarefas de amanhã: use `pergunta pro bento: tarefas`', strategy: 's', attempt: 1 },
      actOk: true,
    });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failures.join(' ')).toContain('vazamento');
  });

  it('aprova observação completa com critérios cobertos', () => {
    const evaluation = deterministicEvaluator({
      state,
      observation: { text: 'As tarefas de amanhã são: X e Y', strategy: 's', attempt: 1 },
      actOk: true,
    });
    expect(evaluation.pass).toBe(true);
    expect(evaluation.score).toBe(1);
  });
});

describe('createInitialState', () => {
  it('estado inicial coerente', () => {
    const state = createInitialState(baseInput);
    expect(state.phase).toBe('RECEIVED');
    expect(state.iterations).toBe(0);
    expect(state.strategiesTried).toEqual([]);
  });
});
