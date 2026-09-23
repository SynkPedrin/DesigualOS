import { describe, expect, it, vi } from 'vitest';
import type * as AgentRuntime from '@desigual-os/agent-runtime';

const mockAskJarbasV2 = vi.fn();

vi.mock('@desigual-os/agent-runtime', async () => {
  const actual = await vi.importActual<typeof AgentRuntime>('@desigual-os/agent-runtime');
  return { ...actual, askJarbasV2: mockAskJarbasV2 };
});

const ORG = 'org-1';
const CLIENTE = 'cliente-a';

function baseDispatch(overrides: Record<string, unknown> = {}) {
  return {
    dispatchKey: `k-${Math.random()}`,
    organizationId: ORG,
    clientId: CLIENTE,
    requestedBy: 'user-1',
    objective: 'entender performance da conta',
    scope: 'conta X, últimos 7 dias',
    entityRefs: [{ type: 'account' as const, id: 'act_123' }],
    timeWindow: { start: '2026-09-17', end: '2026-09-24' },
    originalUserRequest: 'Bento, pede pro Jarbas ver a performance.',
    ...overrides,
  };
}

describe('runJarbasV2Task', () => {
  it('fluxo completo: V2 ok -> resultado persistido -> READY_FOR_REVIEW', async () => {
    mockAskJarbasV2.mockResolvedValueOnce({
      status: 'ok',
      durationMs: 10,
      metricVerified: true,
      raw: {},
      adapted: {
        answer: 'CTR ok',
        provenanceAvailable: true,
        metricVerified: false,
        qualityTier: 'senior',
        v2: {
          schemaVersion: '2', ok: true, agent: 'jarbas', answer: 'CTR ok', scope: {},
          metricFacts: [
            { metric: 'spend', value: 100, unit: 'currency', entityType: 'campaign', entityId: 'c1', entityName: 'X', clientId: CLIENTE, accountId: 'act_123', periodStart: '2026-09-17', periodEnd: '2026-09-24', fetchedAt: 'x', source: 'meta_graph_api', provenanceId: 'p1' },
          ],
          comparisons: [], observations: [], hypotheses: [], recommendations: [], missingData: [], proposedActions: [], sourceTrace: [], toolTrace: [], confidence: 'medium',
        },
      },
    });

    const { InMemoryAgentTaskStore } = await import('@desigual-os/agent-runtime');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());

    const outcome = await runJarbasV2Task(store, task.taskId, ORG, { url: 'http://fake/v2', token: 't' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.task.status).toBe('ready_for_review');
      expect(outcome.result.metricFacts.length).toBe(1);
      expect(outcome.answer).toMatch(/R\$100\.00/);
      expect(outcome.answer).not.toMatch(/\{|\}/); // nunca despeja JSON cru
    }
  });

  it('V2 indisponível (erro NÃO retentável) -> blocked_external_service, NUNCA finge sucesso (§9)', async () => {
    mockAskJarbasV2.mockResolvedValueOnce({ status: 'unavailable', reason: 'permissão negada pelo provedor' });
    const { InMemoryAgentTaskStore } = await import('@desigual-os/agent-runtime');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());

    const outcome = await runJarbasV2Task(store, task.taskId, ORG, { url: 'http://fake/v2', token: 't' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.task?.status).toBe('blocked_external_service');
      expect(outcome.reason).toMatch(/indisponível/);
    }
  });

  it('V2 indisponível por erro RETENTÁVEL (timeout) -> outcome ainda ok:false (nunca finge sucesso), tarefa fica elegível pra nova tentativa em vez de bloquear de primeira', async () => {
    mockAskJarbasV2.mockResolvedValueOnce({ status: 'unavailable', reason: 'timeout' });
    const { InMemoryAgentTaskStore } = await import('@desigual-os/agent-runtime');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());

    const outcome = await runJarbasV2Task(store, task.taskId, ORG, { url: 'http://fake/v2', token: 't' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.task?.status).toBe('analyzing'); // retentável: não bloqueia de cara
      expect(outcome.task?.retry.attemptCount).toBe(1);
      expect(outcome.task?.retry.nextEligibleRetryAt).not.toBeNull();
    }
  });

  it('tarefa sem accountId/timeWindow -> blocked_needs_data, nunca chama V2', async () => {
    const { InMemoryAgentTaskStore } = await import('@desigual-os/agent-runtime');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch({ entityRefs: [], timeWindow: null }));

    mockAskJarbasV2.mockClear();
    const outcome = await runJarbasV2Task(store, task.taskId, ORG, { url: 'http://fake/v2', token: 't' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.task?.status).toBe('blocked_needs_data');
    expect(mockAskJarbasV2).not.toHaveBeenCalled();
  });

  it('resultado vazio de metricFacts ainda assim persiste honestamente, sem inventar números', async () => {
    mockAskJarbasV2.mockResolvedValueOnce({
      status: 'ok', durationMs: 5, metricVerified: false, raw: {},
      adapted: {
        answer: 'sem dado nesse período', provenanceAvailable: false, metricVerified: false, qualityTier: 'beta',
        v2: { schemaVersion: '2', ok: true, agent: 'jarbas', answer: 'sem dado', scope: {}, metricFacts: [], comparisons: [], observations: [], hypotheses: [], recommendations: [], missingData: ['nenhuma linha retornada'], proposedActions: [], sourceTrace: [], toolTrace: [], confidence: 'insufficient_data' },
      },
    });
    const { InMemoryAgentTaskStore } = await import('@desigual-os/agent-runtime');
    const { runJarbasV2Task } = await import('./jarbas-v2-orchestrator');
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());

    const outcome = await runJarbasV2Task(store, task.taskId, ORG, { url: 'http://fake/v2', token: 't' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.metricFacts).toEqual([]);
      expect(outcome.answer).toMatch(/Não encontrei dado/);
    }
  });
});
