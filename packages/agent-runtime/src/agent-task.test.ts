import { describe, expect, it } from 'vitest';
import { InMemoryAgentTaskStore, isTerminalStatus, type DispatchAgentTaskInput } from './agent-task';

function baseInput(overrides: Partial<DispatchAgentTaskInput> = {}): DispatchAgentTaskInput {
  return {
    dispatchKey: 'msg-1',
    organizationId: 'org-1',
    clientId: 'cliente-a',
    requestedBy: 'user-1',
    objective: 'entender por que o CPL subiu',
    scope: 'campanha X, últimos 7 dias',
    entityRefs: [{ type: 'campaign', id: 'camp-x' }],
    timeWindow: { start: '2026-09-17', end: '2026-09-24' },
    originalUserRequest: 'Bento, pede pro Jarbas analisar por que o CPL da campanha X piorou nos últimos 7 dias.',
    ...overrides,
  };
}

describe('InMemoryAgentTaskStore.dispatch — idempotência (§33)', () => {
  it('cria a tarefa com status inicial ASSIGNED', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task, wasAlreadyDispatched } = await store.dispatch(baseInput());
    expect(task.status).toBe('assigned');
    expect(task.assignedAgent).toBe('jarbas');
    expect(wasAlreadyDispatched).toBe(false);
  });

  it('mesma dispatchKey duas vezes -> UMA tarefa lógica só, segunda chamada não cria outra', async () => {
    const store = new InMemoryAgentTaskStore();
    const primeira = await store.dispatch(baseInput());
    const segunda = await store.dispatch(baseInput());
    expect(segunda.wasAlreadyDispatched).toBe(true);
    expect(segunda.task.taskId).toBe(primeira.task.taskId);
  });

  it('dispatchKey diferente cria tarefa diferente', async () => {
    const store = new InMemoryAgentTaskStore();
    const a = await store.dispatch(baseInput({ dispatchKey: 'msg-1' }));
    const b = await store.dispatch(baseInput({ dispatchKey: 'msg-2' }));
    expect(a.task.taskId).not.toBe(b.task.taskId);
  });

  it('preserva o pedido ORIGINAL do funcionário, não uma paráfrase (§17/§29)', async () => {
    const store = new InMemoryAgentTaskStore();
    const original = 'jarbas olha isso aq, pq caiu?';
    const { task } = await store.dispatch(baseInput({ originalUserRequest: original }));
    expect(task.originalUserRequest).toBe(original);
  });
});

describe('InMemoryAgentTaskStore.transition — máquina de estado (§23)', () => {
  it('caminho feliz completo: assigned -> ... -> ready_for_review', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const org = task.organizationId;
    for (const next of ['acknowledged', 'context_resolved', 'analyzing', 'verifying'] as const) {
      const r = await store.transition(task.taskId, next, org);
      expect(r.ok).toBe(true);
    }
    const r2 = await store.attachResult(task.taskId, resultadoFake(), org);
    expect(r2.ok).toBe(true);
    const r3 = await store.transition(task.taskId, 'ready_for_review', org);
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.task.status).toBe('ready_for_review');
  });

  it('transição inválida (assigned -> ready_for_review, pulando tudo) é recusada', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.transition(task.taskId, 'ready_for_review', task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_transition');
  });

  it('nenhuma transição sai de um estado TERMINAL (cancelled)', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'cancelled', task.organizationId);
    const r = await store.transition(task.taskId, 'analyzing', task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('terminal_task');
  });

  it('cancelamento é permitido de qualquer estado não-terminal, mesmo em ANALYZING (§35)', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'acknowledged', task.organizationId);
    await store.transition(task.taskId, 'context_resolved', task.organizationId);
    const r = await store.transition(task.taskId, 'analyzing', task.organizationId);
    expect(r.ok).toBe(true);
    const cancel = await store.transition(task.taskId, 'cancelled', task.organizationId);
    expect(cancel.ok).toBe(true);
  });

  it('organização diferente da dona da tarefa é recusada (cross_org) — tenant nunca vaza', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput({ organizationId: 'org-1' }));
    const r = await store.transition(task.taskId, 'acknowledged', 'org-2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cross_org');
  });

  it('taskId inexistente é not_found, nunca lança exceção', async () => {
    const store = new InMemoryAgentTaskStore();
    const r = await store.transition('nao-existe', 'acknowledged', 'org-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });
});

describe('attachResult', () => {
  it('só aceita resultado quando a tarefa está ANALYZING ou VERIFYING', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.attachResult(task.taskId, resultadoFake(), task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_transition');
  });

  it('organização errada nunca consegue anexar resultado a tarefa alheia', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'acknowledged', task.organizationId);
    await store.transition(task.taskId, 'context_resolved', task.organizationId);
    await store.transition(task.taskId, 'analyzing', task.organizationId);
    const r = await store.attachResult(task.taskId, resultadoFake(), 'org-invasora');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cross_org');
  });
});

describe('isTerminalStatus', () => {
  it('classifica corretamente estados terminais e não-terminais', () => {
    expect(isTerminalStatus('ready_for_review')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('blocked_needs_data')).toBe(true);
    expect(isTerminalStatus('analyzing')).toBe(false);
    expect(isTerminalStatus('assigned')).toBe(false);
  });
});

function resultadoFake() {
  return {
    schemaVersion: 1 as const,
    provenanceAvailable: false,
    scope: { organizationId: 'org-1', clientId: 'cliente-a', accountId: null, entityType: null, entityId: null, periodStart: null, periodEnd: null },
    claims: [],
    metricFacts: [],
    comparisons: [],
    missingData: [],
    risks: [],
    sourceTrace: [],
    analysisConfidence: 'insufficient_data' as const,
  };
}
