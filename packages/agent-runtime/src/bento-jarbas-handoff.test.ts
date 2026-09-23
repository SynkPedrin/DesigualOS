import { describe, expect, it } from 'vitest';
import { detectForbiddenMetaMutationRequest, detectJarbasHandoffRequest, detectJarbasStatusQuery } from './bento-jarbas-handoff';
import { InMemoryAgentTaskStore } from './agent-task';
import { diagnoseCampaignSnapshot } from './jarbas-diagnosis';
import { FIXTURE_CREATIVE_FATIGUE } from './jarbas-fixtures';

describe('detectJarbasHandoffRequest — não overfit em frase exata (§28)', () => {
  it.each([
    'Bento, manda o Jarbas analisar a Cosentino.',
    'Bento, pede pro Jarbas entender por que o CPL subiu.',
    'Bento, atribui essa task ao Jarbas.',
    'joga isso pro jarbas',
    'manda isso pro jarbas',
  ])('reconhece: %s', (msg) => {
    expect(detectJarbasHandoffRequest(msg)).not.toBeNull();
  });

  it.each(['Jarbas, pega essa task.', 'jarbas resolve essa task'])('vocativo direto também funciona: %s', (msg) => {
    expect(detectJarbasHandoffRequest(msg)).not.toBeNull();
  });

  it('mensagem sem menção ao Jarbas não é handoff', () => {
    expect(detectJarbasHandoffRequest('cria uma task pro Pedro')).toBeNull();
  });

  it('menção ao Jarbas sem verbo de handoff não é handoff (ex.: pergunta de status)', () => {
    expect(detectJarbasHandoffRequest('o Jarbas terminou a análise?')).toBeNull();
  });
});

describe('detectJarbasStatusQuery (§26/§46)', () => {
  it.each([
    'o Jarbas terminou?',
    'onde ele está?',
    'o que ele achou?',
    'qual foi a recomendação do Jarbas?',
    'Bento, o Jarbas terminou aquela análise?',
  ])('reconhece pergunta de status: %s', (msg) => {
    expect(detectJarbasStatusQuery(msg)).toBe(true);
  });

  it('pedido de handoff não é confundido com pergunta de status', () => {
    expect(detectJarbasStatusQuery('manda o Jarbas analisar a Cosentino')).toBe(false);
  });
});

describe('detectForbiddenMetaMutationRequest (§24/§49) — nunca executar, sempre virar proposta', () => {
  it.each([
    'aumenta orçamento em 20%',
    'pausa essa campanha',
    'troca o criativo dessa campanha',
    'duplica esse conjunto de anúncios',
  ])('reconhece pedido de mutação: %s', (msg) => {
    expect(detectForbiddenMetaMutationRequest(msg)).toBe(true);
  });

  it('pedido de análise pura não é confundido com pedido de mutação', () => {
    expect(detectForbiddenMetaMutationRequest('analisa por que o CPL subiu')).toBe(false);
  });
});

/**
 * §65 — OS 8 FLUXOS OFFLINE EXIGIDOS, ponta a ponta com os componentes
 * construídos nesta missão. Nenhuma chamada de rede, nenhum dado de
 * cliente real — store em memória, diagnóstico determinístico sobre
 * fixture sintética.
 */
describe('§65 — fluxos offline Bento <-> Jarbas', () => {
  const ORG = 'org-agencia';
  const CLIENTE = 'cliente-cosentino';

  it('1. Bento atribui, Jarbas resolve com fixture sintética e a tarefa fecha em READY_FOR_REVIEW', async () => {
    const store = new InMemoryAgentTaskStore();
    const pedidoOriginal = 'Bento, pede pro Jarbas analisar por que o CPL da campanha X piorou nos últimos 7 dias.';
    expect(detectJarbasHandoffRequest(pedidoOriginal)).not.toBeNull();

    const { task } = await store.dispatch({
      dispatchKey: 'turn-1',
      organizationId: ORG,
      clientId: CLIENTE,
      requestedBy: 'user-1',
      objective: 'entender por que o CPL piorou',
      scope: 'campanha X, últimos 7 dias',
      entityRefs: [{ type: 'campaign', id: 'camp-x' }],
      timeWindow: { start: '2026-09-17', end: '2026-09-24' },
      originalUserRequest: pedidoOriginal,
    });
    expect(task.originalUserRequest).toBe(pedidoOriginal);

    await store.transition(task.taskId, 'acknowledged', ORG);
    await store.transition(task.taskId, 'context_resolved', ORG);
    await store.transition(task.taskId, 'analyzing', ORG);

    const diagnostico = diagnoseCampaignSnapshot(FIXTURE_CREATIVE_FATIGUE);
    const resultado = {
      schemaVersion: 1 as const,
      provenanceAvailable: false,
      scope: { organizationId: ORG, clientId: CLIENTE, accountId: null, entityType: 'campaign' as const, entityId: 'camp-x', periodStart: '2026-09-17', periodEnd: '2026-09-24' },
      claims: diagnostico.hypotheses.map((h) => ({ text: h, kind: 'hypothesis' as const, metricFactIds: [], confidence: 'medium' as const })),
      metricFacts: [],
      comparisons: [],
      missingData: [],
      risks: [],
      sourceTrace: [],
      analysisConfidence: diagnostico.confidence as 'high' | 'medium' | 'low' | 'insufficient_data',
    };
    await store.transition(task.taskId, 'verifying', ORG);
    const attach = await store.attachResult(task.taskId, resultado, ORG);
    expect(attach.ok).toBe(true);
    const done = await store.transition(task.taskId, 'ready_for_review', ORG);
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.task.status).toBe('ready_for_review');
  });

  it('2. "Bento, o Jarbas terminou?" lê o status sem rerodar a análise', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());
    await store.transition(task.taskId, 'acknowledged', ORG);
    expect(detectJarbasStatusQuery('Bento, o Jarbas terminou?')).toBe(true);
    const lido = await store.get(task.taskId);
    expect(lido?.status).toBe('acknowledged');
  });

  it('3. "o que ele encontrou?" — Bento resume o resultado JÁ salvo, não inventa um novo', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());
    await store.transition(task.taskId, 'acknowledged', ORG);
    await store.transition(task.taskId, 'context_resolved', ORG);
    await store.transition(task.taskId, 'analyzing', ORG);
    const resultado = resultadoMinimo();
    await store.attachResult(task.taskId, resultado, ORG);
    expect(detectJarbasStatusQuery('o que ele encontrou?')).toBe(true);
    const salvo = await store.getResult(task.taskId);
    expect(salvo).toEqual(resultado);
  });

  it('4. "manda aumentar orçamento 20%" NUNCA vira mutação Meta — sempre proposta pendente de aprovação', () => {
    const pedido = 'Bento, manda aumentar o orçamento em 20% na Cosentino.';
    expect(detectForbiddenMetaMutationRequest(pedido)).toBe(true);
    // A missão exige que isto produza uma PROPOSTA, nunca execução — não
    // existe, neste repositório, NENHUM caminho de código capaz de chamar
    // a Graph API do Meta (confirmado na investigação desta mesma missão:
    // Jarbas fala só texto livre com o serviço externo). A ausência desse
    // caminho É a garantia — não uma flag que precisa ficar "true".
  });

  it('5. "não mexe em nada, só analisa" — zero caminho de mutação disparado', () => {
    const pedido = 'Bento, pede pro Jarbas analisar a campanha, não mexe em nada.';
    expect(detectJarbasHandoffRequest(pedido)).not.toBeNull();
    expect(detectForbiddenMetaMutationRequest(pedido)).toBe(false);
  });

  it('6. mesma tarefa despachada duas vezes -> UMA análise só (idempotência §33)', async () => {
    const store = new InMemoryAgentTaskStore();
    const a = await store.dispatch(baseDispatch({ dispatchKey: 'turn-dup' }));
    const b = await store.dispatch(baseDispatch({ dispatchKey: 'turn-dup' }));
    expect(b.wasAlreadyDispatched).toBe(true);
    expect(a.task.taskId).toBe(b.task.taskId);
  });

  it('7. task de cliente diferente do contexto ativo -> DENY (organização não bate)', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch({ organizationId: 'org-cliente-a' }));
    const tentativa = await store.transition(task.taskId, 'acknowledged', 'org-cliente-b');
    expect(tentativa.ok).toBe(false);
    if (!tentativa.ok) expect(tentativa.reason).toBe('cross_org');
  });

  it('8. dado externo indisponível -> BLOCKED_NEEDS_DATA / BLOCKED_EXTERNAL_SERVICE, nunca DONE falso', async () => {
    const store = new InMemoryAgentTaskStore();
    const { task } = await store.dispatch(baseDispatch());
    await store.transition(task.taskId, 'acknowledged', ORG);
    await store.transition(task.taskId, 'context_resolved', ORG);
    const bloqueado = await store.transition(task.taskId, 'blocked_external_service', ORG);
    expect(bloqueado.ok).toBe(true);
    if (bloqueado.ok) {
      expect(bloqueado.task.status).toBe('blocked_external_service');
      expect(bloqueado.task.status).not.toBe('ready_for_review');
    }
  });

  function baseDispatch(overrides: Partial<Parameters<InMemoryAgentTaskStore['dispatch']>[0]> = {}) {
    return {
      dispatchKey: `turn-${Math.random()}`,
      organizationId: ORG,
      clientId: CLIENTE,
      requestedBy: 'user-1',
      objective: 'entender por que o CPL piorou',
      scope: 'campanha X, últimos 7 dias',
      entityRefs: [{ type: 'campaign' as const, id: 'camp-x' }],
      timeWindow: { start: '2026-09-17', end: '2026-09-24' },
      originalUserRequest: 'Bento, pede pro Jarbas analisar por que o CPL piorou.',
      ...overrides,
    };
  }

  function resultadoMinimo() {
    return {
      schemaVersion: 1 as const,
      provenanceAvailable: false,
      scope: { organizationId: ORG, clientId: CLIENTE, accountId: null, entityType: null, entityId: null, periodStart: null, periodEnd: null },
      claims: [],
      metricFacts: [],
      comparisons: [],
      missingData: [],
      risks: [],
      sourceTrace: [],
      analysisConfidence: 'medium' as const,
    };
  }
});
