import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryAgentTaskStore,
  adaptJarbasResponse,
  buildProposedAction,
  detectJarbasHandoffRequest,
  detectJarbasStatusQuery,
  generateRecommendation,
  diagnoseCampaignSnapshot,
} from '@desigual-os/agent-runtime';
import type { JarbasExternalResponseV2 } from '@desigual-os/types';

const mockRememberFact = vi.fn(async () => ({ status: 'created' as const, memoryId: 'mem-1' }));
vi.mock('@desigual-os/orchestrator', () => ({ rememberFact: mockRememberFact }));

/**
 * §36 — "This is the most important integration test." Ponta a ponta,
 * 100% offline: EMPLOYEE -> BENTO -> PERSISTED* JARBAS TASK -> MOCK
 * EXTERNAL SERVICE V2 -> METRIC VERIFICATION -> ANALYSIS ->
 * RECOMMENDATIONS -> MEMORY WRITE -> RESULT PERSISTED* -> READY_FOR_REVIEW
 * -> BENTO STATUS QUERY.
 *
 * (*) "PERSISTED" aqui é o InMemoryAgentTaskStore — a única implementação
 * desta missão, por design (ver docs/coordination/JARBAS_SENIOR_HANDOFF.md
 * §7.1/§9 pelo motivo de não existir uma versão Postgres ainda).
 */
describe('§36 — fluxo offline ponta a ponta, com mock do serviço externo V2', () => {
  it('do pedido do funcionário até READY_FOR_REVIEW e a pergunta de status do Bento', async () => {
    const ORG = 'org-agencia';
    const CLIENTE = 'cliente-cosentino';
    const store = new InMemoryAgentTaskStore();

    // 1. EMPLOYEE -> BENTO
    const pedido = 'Bento, pede pro Jarbas analisar por que o CPL da campanha X piorou nos últimos 7 dias.';
    const handoff = detectJarbasHandoffRequest(pedido);
    expect(handoff).not.toBeNull();

    // 2. BENTO -> PERSISTED JARBAS TASK
    const { task } = await store.dispatch({
      dispatchKey: 'turn-e2e-1',
      organizationId: ORG,
      clientId: CLIENTE,
      requestedBy: 'user-1',
      objective: handoff!.objective,
      scope: 'campanha X, últimos 7 dias',
      entityRefs: [{ type: 'campaign', id: 'camp-x' }],
      timeWindow: { start: '2026-09-17', end: '2026-09-24' },
      originalUserRequest: pedido,
    });
    await store.transition(task.taskId, 'acknowledged', ORG);
    await store.transition(task.taskId, 'context_resolved', ORG);
    await store.transition(task.taskId, 'analyzing', ORG);

    // 3. MOCK EXTERNAL SERVICE V2 — nunca uma chamada de rede de verdade.
    const v2Mock: JarbasExternalResponseV2 = {
      schemaVersion: '2',
      ok: true,
      agent: 'jarbas',
      answer: 'CTR caiu, frequência subiu, CPM e conversão ficaram estáveis.',
      scope: { organizationId: ORG, clientId: CLIENTE, accountId: 'act_1', entityType: 'campaign', entityId: 'camp-x', entityName: 'Campanha X', periodStart: '2026-09-17', periodEnd: '2026-09-24' },
      metricFacts: [
        { metric: 'ctr', value: 0.8, unit: 'percent', entityType: 'campaign', entityId: 'camp-x', entityName: 'Campanha X', clientId: CLIENTE, accountId: 'act_1', periodStart: '2026-09-17', periodEnd: '2026-09-24', fetchedAt: '2026-09-24T10:00:00Z', source: 'meta_graph_api', provenanceId: 'mf-1' },
      ],
      comparisons: [],
      observations: [],
      hypotheses: [],
      recommendations: [],
      missingData: [],
      proposedActions: [],
      sourceTrace: [{ provider: 'meta_graph_api', requestType: 'insights', accountId: 'act_1', entityId: 'camp-x', periodStart: '2026-09-17', periodEnd: '2026-09-24', metricNames: ['ctr', 'cpm', 'frequency'], retrievedAt: '2026-09-24T10:00:00Z', freshness: 'current' }],
      toolTrace: [],
      confidence: 'medium',
    };

    // 4. ADAPTER — reconhece V2, marca proveniência real.
    const adaptado = adaptJarbasResponse(v2Mock);
    expect(adaptado.provenanceAvailable).toBe(true);
    expect(adaptado.qualityTier).toBe('senior');

    // 5. ANALYSIS — diagnóstico determinístico sobre o snapshot (não sobre
    // o texto livre do LLM).
    const diagnostico = diagnoseCampaignSnapshot({
      ctrCurrent: 0.8, ctrPrevious: 1.3,
      cpmCurrent: 30, cpmPrevious: 29.5,
      conversionRateCurrent: 3.9, conversionRatePrevious: 4.0,
      frequencyCurrent: 3.4, frequencyPrevious: 2.1,
      clicksCurrent: 640, impressionsCurrent: 80_000,
      conversions: 25, spend: 2400,
      daysSinceCreativeChange: 21,
      internallyInconsistent: false,
    });
    expect(diagnostico.class).toBe('creative_fatigue_hypothesis');

    // 6. RECOMMENDATIONS — derivada do diagnóstico, nunca genérica.
    const recomendacao = generateRecommendation(diagnostico);
    expect(recomendacao.type).toBe('review_creative');

    // "aumenta orçamento" NÃO faz parte deste pedido — nenhuma ProposedAction
    // deveria nascer daqui, confirmando que a detecção é fiel ao pedido real.
    expect(buildProposedAction({ message: pedido, entityId: 'camp-x' })).toBeNull();

    // 7. MEMORY WRITE — motor real (mockado só pra não tocar banco em teste).
    const { recordPerformanceMemory } = await import('./jarbas-performance-memory');
    await recordPerformanceMemory({
      organizationId: ORG,
      clientId: CLIENTE,
      entityType: 'campaign',
      entityId: 'camp-x',
      eventType: 'analysis_completed',
      observation: diagnostico.observations.join('; '),
      hypothesis: diagnostico.hypotheses[0] ?? null,
      recommendation: recomendacao.title,
      confidence: diagnostico.confidence === 'insufficient_data' ? 'low' : diagnostico.confidence,
      sourceRefs: [task.taskId],
      createdAt: new Date().toISOString(),
    });
    expect(mockRememberFact).toHaveBeenCalledTimes(1);

    // 8. RESULT PERSISTED -> READY_FOR_REVIEW
    await store.transition(task.taskId, 'verifying', ORG);
    const attach = await store.attachResult(task.taskId, {
      schemaVersion: 1,
      taskId: task.taskId,
      taskVersion: task.version,
      provenanceAvailable: true,
      scope: { organizationId: ORG, clientId: CLIENTE, accountId: 'act_1', entityType: 'campaign', entityId: 'camp-x', periodStart: '2026-09-17', periodEnd: '2026-09-24' },
      claims: diagnostico.hypotheses.map((h) => ({ text: h, kind: 'hypothesis' as const, metricFactIds: ['mf-1'], confidence: 'medium' as const })),
      metricFacts: v2Mock.metricFacts,
      comparisons: [],
      recommendations: [recomendacao],
      proposedActions: [],
      missingData: [],
      risks: [],
      sourceTrace: v2Mock.sourceTrace,
      analysisConfidence: diagnostico.confidence,
    }, ORG);
    expect(attach.ok).toBe(true);
    const done = await store.transition(task.taskId, 'ready_for_review', ORG);
    expect(done.ok).toBe(true);

    // 9. BENTO STATUS QUERY — lê o que já foi salvo, nunca reroda o Jarbas.
    expect(detectJarbasStatusQuery('Bento, o que ele encontrou?')).toBe(true);
    const lido = await store.get(task.taskId);
    const resultado = await store.getResult(task.taskId);
    expect(lido?.status).toBe('ready_for_review');
    expect(resultado?.recommendations[0]?.type).toBe('review_creative');
    expect(resultado?.provenanceAvailable).toBe(true);
  });
});
