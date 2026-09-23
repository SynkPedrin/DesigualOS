import { describe, expect, it } from 'vitest';
import { InMemoryAgentTaskStore, isRetryableError, isTerminalStatus, MAX_TENTATIVAS_RETRY, type DispatchAgentTaskInput } from './agent-task';

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
    const r2 = await store.attachResult(task.taskId, resultadoFake(task.taskId), org);
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
    const r = await store.attachResult(task.taskId, resultadoFake(task.taskId), task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_transition');
  });

  it('organização errada nunca consegue anexar resultado a tarefa alheia', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'acknowledged', task.organizationId);
    await store.transition(task.taskId, 'context_resolved', task.organizationId);
    await store.transition(task.taskId, 'analyzing', task.organizationId);
    const r = await store.attachResult(task.taskId, resultadoFake(task.taskId), 'org-invasora');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cross_org');
  });
});

describe('updateScope — versionamento de tarefa (§15-16/§34/§38)', () => {
  it('muda escopo em andamento e incrementa a versão', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.updateScope(task.taskId, { timeWindow: { start: '2026-08-25', end: '2026-09-24' } }, task.organizationId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.version).toBe(2);
      expect(r.task.timeWindow).toEqual({ start: '2026-08-25', end: '2026-09-24' });
    }
  });

  it('resultado anexado na versão VELHA não pode virar o resultado atual após mudança de escopo', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'acknowledged', task.organizationId);
    await store.transition(task.taskId, 'context_resolved', task.organizationId);
    await store.transition(task.taskId, 'analyzing', task.organizationId);
    // usuário muda o escopo ENQUANTO a análise (da v1) ainda está rodando
    await store.updateScope(task.taskId, { timeWindow: { start: '2026-08-25', end: '2026-09-24' } }, task.organizationId);
    // a análise antiga, que só sabia da v1, tenta terminar
    const tentativaVelha = await store.attachResult(task.taskId, resultadoFake(task.taskId, 1), task.organizationId);
    expect(tentativaVelha.ok).toBe(false);
    if (!tentativaVelha.ok) expect(tentativaVelha.reason).toBe('stale_version');
  });

  it('após mudança de escopo, getResult não devolve o resultado antigo — resultado final é só o da versão vigente', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'acknowledged', task.organizationId);
    await store.transition(task.taskId, 'context_resolved', task.organizationId);
    await store.transition(task.taskId, 'analyzing', task.organizationId);
    await store.transition(task.taskId, 'verifying', task.organizationId);
    await store.attachResult(task.taskId, resultadoFake(task.taskId, 1), task.organizationId);
    expect(await store.getResult(task.taskId)).not.toBeNull();
    await store.updateScope(task.taskId, { scope: 'últimos 30 dias' }, task.organizationId);
    expect(await store.getResult(task.taskId)).toBeNull();
  });

  it('não muda escopo de tarefa já terminal (ex.: cancelled)', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    await store.transition(task.taskId, 'cancelled', task.organizationId);
    const r = await store.updateScope(task.taskId, { scope: 'nova janela' }, task.organizationId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('terminal_task');
  });
});

describe('recordFailure / isRetryableError — retry limitado (§25-26)', () => {
  it('erro de timeout é retentável e agenda a próxima tentativa', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.recordFailure(task.taskId, 'request timeout after 180000ms', task.organizationId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.retryable).toBe(true);
      expect(r.task.retry.attemptCount).toBe(1);
      expect(r.task.retry.nextEligibleRetryAt).not.toBeNull();
      expect(r.task.status).not.toBe('blocked_external_service');
    }
  });

  it('erro de permissão NUNCA é retentado — vai direto pra bloqueado', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    const r = await store.recordFailure(task.taskId, 'permissão negada para esta organização', task.organizationId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.retryable).toBe(false);
      expect(r.task.status).toBe('blocked_external_service');
    }
  });

  it('esgotar o teto de tentativas para de retentar mesmo erro transitório', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseInput());
    // No teto (MAX_TENTATIVAS_RETRY=3), a 4ª falha já esgota — a partir daí a
    // tarefa fica BLOCKED (terminal), então uma 5ª chamada corretamente
    // devolveria not_found/terminal_task, não outra tentativa.
    let ultimo;
    for (let i = 0; i < MAX_TENTATIVAS_RETRY + 1; i += 1) {
      ultimo = await store.recordFailure(task.taskId, '503 service unavailable', task.organizationId);
    }
    expect(ultimo?.ok).toBe(true);
    if (ultimo?.ok) {
      expect(ultimo.retryable).toBe(false);
      expect(ultimo.task.status).toBe('blocked_external_service');
    }
  });

  it('isRetryableError classifica timeout/429/5xx como retentável, permissão/entidade ambígua/contrato como não', () => {
    expect(isRetryableError('timeout')).toBe(true);
    expect(isRetryableError('429 too many requests')).toBe(true);
    expect(isRetryableError('500 internal server error')).toBe(true);
    expect(isRetryableError('ECONNRESET')).toBe(true);
    expect(isRetryableError('permissão negada')).toBe(false);
    expect(isRetryableError('entidade ambígua: duas campanhas com o mesmo nome')).toBe(false);
    expect(isRetryableError('erro de validação de contrato')).toBe(false);
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

function resultadoFake(taskId = 'task-x', taskVersion = 1) {
  return {
    schemaVersion: 1 as const,
    taskId,
    taskVersion,
    provenanceAvailable: false,
    scope: { organizationId: 'org-1', clientId: 'cliente-a', accountId: null, entityType: null, entityId: null, periodStart: null, periodEnd: null },
    claims: [],
    metricFacts: [],
    comparisons: [],
    recommendations: [],
    proposedActions: [],
    missingData: [],
    risks: [],
    sourceTrace: [],
    analysisConfidence: 'insufficient_data' as const,
  };
}
