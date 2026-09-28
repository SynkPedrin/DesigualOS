import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@desigual-os/bento-core', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/bento-core')>('@desigual-os/bento-core');
  return { ...actual, proposeBentoAction: vi.fn(), validateBentoAction: vi.fn() };
});
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  // createTaskComment precisa devolver promessa: desde 28/09/2026 o core
  // registra procedência também em mudança de RESPONSÁVEL, não só de status.
  return { ...actual, createVerifiedSeniorTask: vi.fn(), createTaskComment: vi.fn(async () => ({ id: 'c1' })), getTaskComments: vi.fn(async () => []) };
});
vi.mock('./bento-action-guard', () => ({
  // A cerca de QA (write-scope) vive no guard; o core consulta estes dois pra
  // decidir se a escrita é da operação ou do bot de QA. Ver
  // tammy-regression-20260928-escopo-de-escrita.test.ts.
  ehQaBot: (email: string | null) => email === 'qa-bot@institutoalmada.org',
  podeEscreverEmProducao: () => true,

  getClickUpConfigOrNull: vi.fn(() => ({ apiKey: 'k', teamId: 't' })),
  loadSelectionSnapshot: vi.fn(async () => null),
  // Mapeador real de status (hint pt-BR -> coluna da lista); o core passa ele
  // pro executeTaskUpdate desde o destravamento da conclusão (28/09/2026).
  mapStatusHintToRealStatus: (hint: string, statuses: string[]) =>
    /(pront|conclu|feito|encerr)/i.test(hint)
      ? statuses.find((s: string) => /(pront|conclu|feito|encerr|complet|done|closed)/i.test(s))
      : undefined,
}));
vi.mock('./bento-resource-state', () => ({
  loadResourceState: vi.fn(async () => ({
    version: 1,
    focusedResource: null,
    selectedResources: [],
    recentCreatedResources: [],
    recentUpdatedResources: [],
    lastExecution: null,
    client: null,
    assignee: null,
    dueDate: null,
    sources: [],
    updatedAt: 'now',
  })),
  persistResourceState: vi.fn(async () => undefined),
  applyExecutionToState: vi.fn((state) => state),
}));
vi.mock('./execution-record', () => ({ loadLatestExecutionState: vi.fn(async () => null), sameExecutionAlreadyDone: vi.fn(() => false) }));
vi.mock('./write-target', () => ({
  resolveWriteTarget: vi.fn(async () => ({ status: 'resolved', clientId: 'c1', clientName: 'Cliente', listId: 'L1', candidates: [], reason: 'ok' })),
}));
vi.mock('./bento-update-executor', () => ({ executeTaskUpdate: vi.fn() }));
// selectWriteProvider bate no banco real (getClickUpMcpAccessToken) — mockado
// pra LEGACY_GATEWAY aqui, que é o comportamento coberto por este arquivo de
// teste. O caminho MCP tem suíte própria em bento-mcp-executor.test.ts.
vi.mock('./bento-mcp-executor', () => ({
  selectWriteProvider: vi.fn(async () => ({ provider: 'LEGACY_GATEWAY' })),
  executeViaMcp: vi.fn(),
  parseDueDateMs: (raw: string) => {
    const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (isoDay) return new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]), 12).getTime();
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },
}));

import { proposeBentoAction, validateBentoAction } from '@desigual-os/bento-core';
import { createVerifiedSeniorTask } from '@desigual-os/tool-gateway';
import { loadSelectionSnapshot } from './bento-action-guard.js';
import { executeTaskUpdate } from './bento-update-executor.js';
import { bentoOpenAiCoreEnabled, runBentoOpenAiCore } from './bento-openai-core.js';
import type { SelectionSnapshot } from '@desigual-os/context-engine';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

const seniorCtx = { executionId: 'e1', userId: 'u1', organizationId: 'org1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };

describe('bentoOpenAiCoreEnabled', () => {
  it('desligado por padrão (env ausente)', () => {
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
    expect(bentoOpenAiCoreEnabled()).toBe(false);
  });
});

describe('runBentoOpenAiCore', () => {
  beforeEach(() => {
    vi.mocked(proposeBentoAction).mockReset();
    vi.mocked(validateBentoAction).mockReset();
    vi.mocked(createVerifiedSeniorTask).mockReset();
  });

  it('flag desligada: devolve null sem chamar o planner', async () => {
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
    const result = await runBentoOpenAiCore({ message: 'oi', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: null, logger: fakeLogger });
    expect(result).toBeNull();
    expect(proposeBentoAction).not.toHaveBeenCalled();
  });

  it('flag ligada, delete_task: devolve null (defere pro guard legado, que já tem confirmação + read-back de ausência) sem chamar policy nem executor', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'delete_task', target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: null, requestedCardinality: 0, reasoning: 'pedido de exclusão' });
    const result = await runBentoOpenAiCore({ message: 'apaga essa task', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: seniorCtx, logger: fakeLogger });
    expect(result).toBeNull();
    expect(validateBentoAction).not.toHaveBeenCalled();
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('flag ligada, sem seniorToolContext: falha explícita, nunca executa a escrita', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'create_task', target: null, changes: { title: 'X' }, requestedCardinality: 1, reasoning: 'r' });
    const result = await runBentoOpenAiCore({ message: 'cria uma task X', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: null, logger: fakeLogger });
    expect(result?.status).toBe('failed');
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('flag ligada, policy bloqueia: não chama o executor', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'create_task', target: null, changes: { title: 'X' }, requestedCardinality: 0, reasoning: 'r' });
    vi.mocked(validateBentoAction).mockReturnValue({ allowed: false, reason: 'cardinalidade bloqueada', cardinality: { requestedCardinality: 0, plannedCardinality: 1, executedCardinality: 0, blocked: true, blockReason: 'x' }, resolvedResourceId: null, possibleDuplicate: false });
    const result = await runBentoOpenAiCore({ message: 'cria uma task X', conversationId: 'conv1', organizationId: null, clientId: null, seniorToolContext: seniorCtx, logger: fakeLogger });
    expect(result?.status).toBe('failed');
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('flag ligada, create_task aprovado: executa via createVerifiedSeniorTask (LEGACY_GATEWAY) e reporta sucesso', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({ intent: 'create_task', target: null, changes: { title: 'Post X' }, requestedCardinality: 1, reasoning: 'r' });
    vi.mocked(validateBentoAction).mockReturnValue({ allowed: true, reason: 'ok', cardinality: { requestedCardinality: 1, plannedCardinality: 1, executedCardinality: 0, blocked: false, blockReason: null }, resolvedResourceId: null, possibleDuplicate: false });
    vi.mocked(createVerifiedSeniorTask).mockResolvedValue({ success: true, resourceId: 'T1', resourceUrl: 'https://clickup/T1', verified: true, data: {} as never, assignedTo: null, wasExisting: false });

    const result = await runBentoOpenAiCore({ message: 'cria uma task X', conversationId: 'conv1', organizationId: 'org1', clientId: 'c1', seniorToolContext: seniorCtx, logger: fakeLogger });
    expect(result?.status).toBe('completed');
    expect(createVerifiedSeniorTask).toHaveBeenCalledTimes(1);
    const envelope = (result?.metadata as { write_envelope?: { provider?: string; resourceIds?: string[] } })?.write_envelope;
    expect(envelope?.provider).toBe('LEGACY_GATEWAY');
    expect(envelope?.resourceIds).toEqual(['T1']);
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('QA 28/09/2026: create_task com assignee + dueDate repassa os DOIS campos pro createVerifiedSeniorTask (achado ao vivo: task nascia só com título)', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({
      intent: 'create_task',
      target: null,
      changes: { title: 'Post X', assignee: 'Matheus Sain', dueDate: '2026-10-02' },
      requestedCardinality: 1,
      reasoning: 'r',
    });
    vi.mocked(validateBentoAction).mockReturnValue({ allowed: true, reason: 'ok', cardinality: { requestedCardinality: 1, plannedCardinality: 1, executedCardinality: 0, blocked: false, blockReason: null }, resolvedResourceId: null, possibleDuplicate: false });
    vi.mocked(createVerifiedSeniorTask).mockResolvedValue({ success: true, resourceId: 'T1', resourceUrl: 'https://clickup/T1', verified: true, data: {} as never, assignedTo: null, wasExisting: false });

    await runBentoOpenAiCore({ message: 'cria uma task X pro Matheus, prazo pra sexta', conversationId: 'conv1', organizationId: 'org1', clientId: 'c1', seniorToolContext: seniorCtx, logger: fakeLogger });

    const params = vi.mocked(createVerifiedSeniorTask).mock.calls[0]?.[2];
    expect(params?.assigneeName).toBe('Matheus Sain');
    expect(params?.dueDate).toBe(new Date(2026, 9, 2, 12).getTime());
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  it('QA 28/09/2026: update_task com dueDate repassa a data pro executeTaskUpdate (achado ao vivo: "muda o prazo" respondia "já estava assim" sem nunca aplicar a mudança)', async () => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockResolvedValue({
      intent: 'update_task',
      target: { resourceType: 'CLICKUP_TASK', resourceId: 'T1' },
      changes: { dueDate: '2026-10-02' },
      requestedCardinality: 1,
      reasoning: 'r',
    });
    vi.mocked(validateBentoAction).mockReturnValue({ allowed: true, reason: 'ok', cardinality: { requestedCardinality: 1, plannedCardinality: 0, executedCardinality: 0, blocked: false, blockReason: null }, resolvedResourceId: 'T1', possibleDuplicate: false });
    vi.mocked(executeTaskUpdate).mockResolvedValue({ execution_id: '', agent: 'bento', status: 'completed', answer: 'ok', sources: [], tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 } });

    await runBentoOpenAiCore({ message: 'muda o prazo pra sexta', conversationId: 'conv1', organizationId: 'org1', clientId: 'c1', seniorToolContext: seniorCtx, logger: fakeLogger });

    const params = vi.mocked(executeTaskUpdate).mock.calls[0]?.[0];
    expect(params?.fields.dueDate).toBe(new Date(2026, 9, 2, 12).getTime());
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });
});

/**
 * D.11/F-17 — wiring do assigneeOperation (schema novo da policy) pro
 * executor legado: remove → removePersonName, replace → replacePersonName,
 * ausente/add → personName (comportamento histórico).
 */
describe('assigneeOperation wiring (D.11/F-17)', () => {
  beforeEach(() => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockReset();
    vi.mocked(validateBentoAction).mockReset();
    vi.mocked(executeTaskUpdate).mockReset();
    vi.mocked(validateBentoAction).mockReturnValue({
      allowed: true,
      reason: 'ok',
      cardinality: { requestedCardinality: 0, plannedCardinality: 0, executedCardinality: 0, blocked: false, blockReason: null },
      resolvedResourceId: 'T9',
      possibleDuplicate: false,
    });
    vi.mocked(executeTaskUpdate).mockResolvedValue({
      execution_id: '', agent: 'bento', status: 'completed', answer: 'ok', sources: [],
      tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, metadata: {},
    });
  });

  afterEach(() => {
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
  });

  function updateCom(assignee: string, assigneeOperation?: 'add' | 'remove' | 'replace') {
    vi.mocked(proposeBentoAction).mockResolvedValue({
      intent: 'update_task',
      target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' },
      changes: { assignee, ...(assigneeOperation ? { assigneeOperation } : {}) },
      requestedCardinality: 0,
      reasoning: 'r',
    });
    return runBentoOpenAiCore({ message: 'mexe no responsável', conversationId: 'conv-op', organizationId: 'org1', clientId: 'c1', seniorToolContext: seniorCtx, logger: fakeLogger });
  }

  it('remove → removePersonName (nunca personName)', async () => {
    await updateCom('Matheus', 'remove');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].fields).toEqual({ removePersonName: 'Matheus' });
  });

  it('replace → replacePersonName (adiciona e remove os outros, sem remover ela mesma)', async () => {
    await updateCom('Sofia', 'replace');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].fields).toEqual({ replacePersonName: 'Sofia' });
  });

  it('ausente → personName (default semântico add, compatível com o histórico)', async () => {
    await updateCom('Sofia');
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0].fields).toEqual({ personName: 'Sofia' });
  });
});

/**
 * P0 25/09/2026 — incidente D. Carvalho "item 11". A ponte
 * (bento-legacy-selection-bridge.ts) roda de VERDADE nestes testes — só o
 * que ela CONSULTA (loadSelectionSnapshot) é mockado. Prova que, com o
 * ConversationResourceState novo vazio, "item 11" ainda resolve pro id REAL
 * da task via o snapshot antigo, antes da policy decidir.
 */
describe('PONTE COM SNAPSHOT ANTIGO — item 11 nunca vira task_id literal', () => {
  function snapshot15(): SelectionSnapshot {
    return {
      version: 1,
      reason: 'operational_listing',
      reasonLabel: 'tasks abertas da D. Carvalho',
      source: 'clickup_operational_tasks',
      capturedAt: new Date().toISOString(),
      focusTaskId: null,
      tasks: Array.from({ length: 15 }, (_, i) => ({
        id: `t${i + 1}`,
        title: i === 10 ? 'DC_Agrishow_Edições_Pacotes Pós-Vendas' : `Task ${i + 1}`,
        clientName: 'D. Carvalho',
        listId: 'L1',
        assignees: ['Bruna Baldacini'],
        dueDate: null,
        status: 'aberto',
        priority: 'normal',
        url: `https://app.clickup.com/t/t${i + 1}`,
      })),
    };
  }

  beforeEach(() => {
    process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
    vi.mocked(proposeBentoAction).mockReset();
    vi.mocked(validateBentoAction).mockReset();
    vi.mocked(createVerifiedSeniorTask).mockReset();
    vi.mocked(proposeBentoAction).mockResolvedValue({
      intent: 'update_task',
      target: { resourceType: 'CLICKUP_TASK', resourceId: null },
      changes: { dueDate: '2026-09-28' },
      requestedCardinality: 0,
      reasoning: 'item 11',
    });
    vi.mocked(loadSelectionSnapshot).mockResolvedValue(snapshot15());
    vi.mocked(executeTaskUpdate).mockResolvedValue({
      execution_id: '',
      agent: 'bento',
      status: 'completed',
      answer: 'Prazo atualizado.',
      sources: [],
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      metadata: {},
    });
  });

  afterEach(() => {
    delete process.env.BENTO_OPENAI_CORE_ENABLED;
    vi.mocked(loadSelectionSnapshot).mockReset();
    vi.mocked(executeTaskUpdate).mockReset();
  });

  it('TESTE 1: "altere o item 11" — validateBentoAction recebe o estado JÁ hidratado com o id real (t11), nunca "11"', async () => {
    vi.mocked(validateBentoAction).mockReturnValue({
      allowed: true,
      reason: 'ok',
      cardinality: { requestedCardinality: 0, plannedCardinality: 0, executedCardinality: 0, blocked: false, blockReason: null },
      resolvedResourceId: 't11',
      possibleDuplicate: false,
    });

    await runBentoOpenAiCore({
      message: 'Altere a data de entrega do item 11, para o dia 28 de setembro',
      conversationId: 'conv-real-1',
      organizationId: 'org1',
      clientId: 'c1',
      seniorToolContext: seniorCtx,
      logger: fakeLogger,
    });

    const [, stateRecebido] = vi.mocked(validateBentoAction).mock.calls[0]!;
    expect(stateRecebido.focusedResource?.resourceId).toBe('t11');
    expect(stateRecebido.focusedResource?.resourceId).not.toBe('11');
    expect(stateRecebido.focusedResource?.title).toBe('DC_Agrishow_Edições_Pacotes Pós-Vendas');
  });

  it('UPDATE INVARIANT: resource resolvido + verbo de atualização nunca chama createVerifiedSeniorTask', async () => {
    vi.mocked(validateBentoAction).mockReturnValue({
      allowed: true,
      reason: 'ok',
      cardinality: { requestedCardinality: 0, plannedCardinality: 0, executedCardinality: 0, blocked: false, blockReason: null },
      resolvedResourceId: 't11',
      possibleDuplicate: false,
    });

    await runBentoOpenAiCore({
      message: 'Altere a data de entrega do item 11, para o dia 28 de setembro',
      conversationId: 'conv-real-1',
      organizationId: 'org1',
      clientId: 'c1',
      seniorToolContext: seniorCtx,
      logger: fakeLogger,
    });

    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(executeTaskUpdate).toHaveBeenCalledOnce();
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0]).toMatchObject({ taskId: 't11' });
  });

  it('TESTE 5: índice inexistente ("item 99") não resolve — policy recebe estado sem foco, nunca inventa alvo', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue({
      intent: 'update_task',
      target: { resourceType: 'CLICKUP_TASK', resourceId: null },
      changes: { dueDate: '2026-09-28' },
      requestedCardinality: 0,
      reasoning: 'item 99',
    });
    vi.mocked(validateBentoAction).mockReturnValue({
      allowed: false,
      reason: 'target_unresolved',
      cardinality: { requestedCardinality: 0, plannedCardinality: 0, executedCardinality: 0, blocked: false, blockReason: null },
      resolvedResourceId: null,
      possibleDuplicate: false,
    });

    await runBentoOpenAiCore({
      message: 'item 99',
      conversationId: 'conv-real-1',
      organizationId: 'org1',
      clientId: 'c1',
      seniorToolContext: seniorCtx,
      logger: fakeLogger,
    });

    const [, stateRecebido] = vi.mocked(validateBentoAction).mock.calls[0]!;
    expect(stateRecebido.focusedResource).toBeNull();
    expect(executeTaskUpdate).not.toHaveBeenCalled();
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
  });

  it('TESTE 7: referência por nome completo da task ("altere a data da DC_Agrishow...") resolve pro mesmo id', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue({
      intent: 'update_task',
      target: { resourceType: 'CLICKUP_TASK', resourceId: null },
      changes: { dueDate: '2026-09-28' },
      requestedCardinality: 0,
      reasoning: 'nome completo',
    });
    vi.mocked(validateBentoAction).mockReturnValue({
      allowed: true,
      reason: 'ok',
      cardinality: { requestedCardinality: 0, plannedCardinality: 0, executedCardinality: 0, blocked: false, blockReason: null },
      resolvedResourceId: 't11',
      possibleDuplicate: false,
    });

    await runBentoOpenAiCore({
      message: 'altere a data da DC_Agrishow_Edições_Pacotes Pós-Vendas para dia 28',
      conversationId: 'conv-real-1',
      organizationId: 'org1',
      clientId: 'c1',
      seniorToolContext: seniorCtx,
      logger: fakeLogger,
    });

    const [, stateRecebido] = vi.mocked(validateBentoAction).mock.calls[0]!;
    expect(stateRecebido.focusedResource?.resourceId).toBe('t11');
  });
});
