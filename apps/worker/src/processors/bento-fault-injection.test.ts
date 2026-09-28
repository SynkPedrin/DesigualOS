import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * bento-fault-injection.test.ts — FASE B.8 (fault injection) + parte da B.6
 * da auditoria forense do caminho NOVO do Bento (bento-openai-core).
 *
 * Filosofia: estes testes documentam o comportamento REAL do código sob
 * falha. Quando o comportamento real é ruim, o teste asserta o comportamento
 * ATUAL marcado com "COMPORTAMENTO ATUAL (bug)" — nunca força verde.
 *
 * O que roda DE VERDADE aqui (sem mock):
 *   - runBentoOpenAiCore (o orquestrador sob teste)
 *   - validateBentoAction / resolveTargetResourceId (policy real, determinística)
 *   - selectWriteProvider / executeViaMcp (bento-mcp-executor.ts real)
 *   - applyExecutionToState / parseResourceState (bento-resource-state.ts real,
 *     com load/persist apoiados num store em memória que reproduz a semântica
 *     append-only de conversation_context)
 *   - executionStateFromGuardMetadata / sameExecutionAlreadyDone
 *     (execution-record.ts real, com loadLatestExecutionState apoiado numa
 *     tabela fake de metadata de mensagens)
 *
 * O que é mockado (todo I/O externo):
 *   - proposeBentoAction (planner OpenAI) — devolve a ação estruturada desejada
 *   - callResponses/buildClickUpMcpTool/pickModel (OpenAI Responses + tool MCP)
 *   - getClickUpMcpAccessToken (DB), getTask (read-back ClickUp REST),
 *     createVerifiedSeniorTask / createTaskComment / getTaskComments (gateway legado)
 *   - getClickUpConfigOrNull, loadSelectionSnapshot, resolveWriteTarget, executeTaskUpdate
 */

// ---------------------------------------------------------------------------
// Stores fake (semântica append-only, igual conversation_context / messages)
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  /** conversationId → linhas append-only de conversation_context (payload jsonb). */
  resourceRows: new Map<string, Array<Record<string, unknown>>>(),
  /** metadata das mensagens da conversa, mais recente primeiro (como ORDER BY created_at DESC). */
  messageRows: [] as Array<Record<string, unknown> | null>,
}));

vi.mock('@desigual-os/bento-core', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/bento-core')>('@desigual-os/bento-core');
  // Policy (validateBentoAction/resolveTargetResourceId) roda REAL — só o
  // planner (I/O OpenAI) é mockado.
  return { ...actual, proposeBentoAction: vi.fn() };
});

vi.mock('@desigual-os/openai-provider', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/openai-provider')>('@desigual-os/openai-provider');
  return {
    ...actual,
    callResponses: vi.fn(),
    buildClickUpMcpTool: vi.fn((token: string) => ({ type: 'mcp', server_label: 'clickup', authorization: token }) as never),
    pickModel: vi.fn(() => ({ model: 'test-model' }) as never),
  };
});

vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return {
    ...actual,
    createVerifiedSeniorTask: vi.fn(),
    createTaskComment: vi.fn(),
    getTaskComments: vi.fn(),
    getClickUpMcpAccessToken: vi.fn(),
    getTask: vi.fn(),
    queryOperationTasks: vi.fn(),
    resolveMemberByName: vi.fn(),
  };
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

vi.mock('./write-target', () => ({
  resolveWriteTarget: vi.fn(async () => ({ status: 'resolved', clientId: 'c1', clientName: 'Cliente', listId: 'L1', candidates: [], reason: 'ok' })),
}));

vi.mock('./bento-update-executor', () => ({ executeTaskUpdate: vi.fn() }));

// load/persist apoiados no store fake; parse/apply rodam o código REAL.
vi.mock('./bento-resource-state', async () => {
  const actual = await vi.importActual<typeof import('./bento-resource-state')>('./bento-resource-state');
  const { emptyResourceState } = await import('@desigual-os/bento-core');
  return {
    ...actual,
    loadResourceState: vi.fn(async (conversationId: string) => {
      const rows = h.resourceRows.get(conversationId) ?? [];
      return rows.length > 0 ? actual.parseResourceState(rows[rows.length - 1]) : emptyResourceState();
    }),
    persistResourceState: vi.fn(async (conversationId: string, state: import('@desigual-os/bento-core').ConversationResourceState) => {
      const rows = h.resourceRows.get(conversationId) ?? [];
      rows.push({ ...state, updatedAt: new Date().toISOString() } as Record<string, unknown>);
      h.resourceRows.set(conversationId, rows);
    }),
  };
});

// loadLatestExecutionState apoiado na tabela fake de metadata; o PARSER
// (executionStateFromGuardMetadata) e sameExecutionAlreadyDone rodam de verdade.
vi.mock('./execution-record', async () => {
  const actual = await vi.importActual<typeof import('./execution-record')>('./execution-record');
  return {
    ...actual,
    loadLatestExecutionState: vi.fn(async (_conversationId: string) => {
      for (const metadata of h.messageRows) {
        if (!metadata) continue;
        const estado = actual.executionStateFromGuardMetadata(metadata);
        if (estado) return estado;
      }
      return null;
    }),
  };
});

// ATENÇÃO: './bento-mcp-executor' NÃO é mockado — selectWriteProvider e
// executeViaMcp rodam de verdade contra os mocks de OpenAI/tool-gateway acima.

import { proposeBentoAction, validateBentoAction, resolveTargetResourceId, emptyResourceState, type StructuredAction, type WriteEnvelope } from '@desigual-os/bento-core';
import { callResponses } from '@desigual-os/openai-provider';
import { createVerifiedSeniorTask, getClickUpMcpAccessToken, getTask, queryOperationTasks, resolveMemberByName } from '@desigual-os/tool-gateway';
import { executeTaskUpdate } from './bento-update-executor.js';
import { loadResourceState, persistResourceState } from './bento-resource-state.js';
import { executionStateFromGuardMetadata } from './execution-record.js';
import { runBentoOpenAiCore, type BentoOpenAiCoreParams } from './bento-openai-core.js';

const CONV = 'conv-fault-1';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

const seniorCtx = { executionId: 'e1', userId: 'u1', organizationId: 'org1', agent: 'bento' as const, permissions: [{ resource: 'clickup', action: 'write' }] };

function act(intent: StructuredAction['intent'], over: Partial<StructuredAction> = {}): StructuredAction {
  return {
    intent,
    target: null,
    changes: null,
    requestedCardinality: intent === 'create_task' ? 1 : 0,
    reasoning: 'fault-injection',
    ...over,
  };
}

function run(over: Partial<BentoOpenAiCoreParams> & { message: string }) {
  return runBentoOpenAiCore({
    conversationId: CONV,
    organizationId: 'org1',
    clientId: 'c1',
    seniorToolContext: seniorCtx,
    logger: fakeLogger,
    ...over,
  });
}

function envelopeOf(result: Awaited<ReturnType<typeof runBentoOpenAiCore>>): WriteEnvelope {
  return (result?.metadata as { write_envelope: WriteEnvelope } | undefined)?.write_envelope as WriteEnvelope;
}

function mcpCallOk(output: string | null) {
  return { id: 'mcpcall_1', serverLabel: 'clickup', name: 'create_task', arguments: '{}', output, error: null };
}

/** TaskDetail completo como o getTask real devolve — o read-back D.6 confere campos, não só existência. */
function taskDetail(over: Record<string, unknown> = {}) {
  return { id: 'T9', name: 'Task 9', status: null, priority: null, dueDate: null, listId: 'L1', assignees: [], description: '', attachments: [], ...over } as never;
}

/** Prazo "2026-09-28" como o parse do read-back interpreta (meio-dia local). */
const DUE_28 = new Date(2026, 8, 28, 12).getTime();

beforeEach(() => {
  process.env.BENTO_OPENAI_CORE_ENABLED = 'true';
  h.resourceRows.clear();
  h.messageRows.length = 0;
  vi.clearAllMocks();
  // Default: sem token OAuth → provider LEGACY_GATEWAY (Caso 4 é o inverso).
  vi.mocked(getClickUpMcpAccessToken).mockResolvedValue(null);
  // Defaults do I/O REST de leitura (reconcile-first D.3 / read-back D.6):
  // lista vazia, pessoa não encontrada.
  vi.mocked(queryOperationTasks).mockResolvedValue({ tasks: [], truncated: false, pagesFetched: 1 });
  vi.mocked(resolveMemberByName).mockResolvedValue({ status: 'not_found' } as never);
});

afterEach(() => {
  delete process.env.BENTO_OPENAI_CORE_ENABLED;
});

/* ====================================================================== */
/* CASO 1 — CREATE com timeout na resposta (task criada, resposta perdida) */
/* ====================================================================== */
describe('CASO 1 — create com resposta perdida + retry do job', () => {
  it('1a LEGACY: retry re-executa o executor, que reconcilia antes de criar (wasExisting) → 1 task', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Post X' } }));

    // Tentativa 1: o POST commitou no ClickUp mas a resposta se perdeu.
    vi.mocked(createVerifiedSeniorTask).mockResolvedValueOnce({
      success: false, errorCode: 'write_failed', message: 'Request timeout', retryable: true,
    });
    const attempt1 = await run({ message: 'cria a task Post X' });
    expect(attempt1?.status).toBe('failed');
    expect(envelopeOf(attempt1).retryable).toBe(true);
    // Estado NÃO persistido em falha (bento-openai-core.ts:236-238) — correto.
    expect(persistResourceState).not.toHaveBeenCalled();
    // status 'failed' → execute-job.ts:2016-2027 faz throw → o BullMQ
    // re-tenta o JOB INTEIRO (não existe retry parcial dentro do core).

    // Tentativa 2 (retry BullMQ): o executor legado tem reconcile-first
    // (senior-operation.ts:114-136 — cobertura direta em
    // packages/tool-gateway/src/senior-operation.test.ts "RECONCILE FIRST"):
    // acha a task da tentativa 1 por (lista, título) e devolve wasExisting.
    vi.mocked(createVerifiedSeniorTask).mockResolvedValueOnce({
      success: true, resourceId: 'T1', resourceUrl: 'https://app.clickup.com/t/T1', verified: true, data: {} as never, assignedTo: null, wasExisting: true,
    });
    const attempt2 = await run({ message: 'cria a task Post X' });
    expect(attempt2?.status).toBe('completed');
    expect(attempt2?.answer).toContain('já existia');
    expect(envelopeOf(attempt2).resourceIds).toEqual(['T1']);
    // ESPERADO = REAL aqui: 1 task. A proteção NÃO está no core — está no
    // executor legado. O core em si re-executaria cegamente.
    expect(createVerifiedSeniorTask).toHaveBeenCalledTimes(2);
  });

  it('1b MCP: retry re-executa, mas o reconcile-first (D.3/F-03) acha a task da tentativa 1 → 1 task (REGRESSÃO: era duplicata)', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Post X' } }));

    // Tentativa 1: o servidor MCP executou o create, mas a resposta se perdeu.
    // (reconcile-first rodou ANTES e não achou nada — lista vazia.)
    vi.mocked(callResponses).mockRejectedValueOnce(new Error('Request timed out.'));
    const attempt1 = await run({ message: 'cria a task Post X' });
    expect(attempt1?.status).toBe('failed');
    expect(envelopeOf(attempt1).retryable).toBe(true);
    expect(persistResourceState).not.toHaveBeenCalled();

    // Tentativa 2 (retry BullMQ): o reconcile-first (read-only, REST legado)
    // acha a task que a tentativa 1 commitou — mesmo título na mesma lista —
    // e devolve a EXISTENTE sem instruir create nenhum ao MCP.
    vi.mocked(queryOperationTasks).mockResolvedValueOnce({
      tasks: [{ id: 'T-MCP-1', name: 'Post X', createdAt: Date.now() - 30_000 } as never],
      truncated: false,
      pagesFetched: 1,
    });
    vi.mocked(getTask).mockResolvedValue(taskDetail({ id: 'T-MCP-1', name: 'Post X' }));
    const attempt2 = await run({ message: 'cria a task Post X' });
    expect(attempt2?.status).toBe('completed');
    expect(attempt2?.answer).toContain('já existia');
    const env2 = envelopeOf(attempt2);
    expect(env2.resourceIds).toEqual(['T-MCP-1']);
    expect((env2 as { wasExisting?: boolean }).wasExisting).toBe(true);

    // REGRESSÃO (INV-002): UMA instrução de create no total (a da tentativa 1,
    // que timeoutou DEPOIS de enviada). Antes da correção eram 2 creates
    // reais no ClickUp para 1 pedido (P0 F-03).
    const createInstructions = vi.mocked(callResponses).mock.calls.filter(
      ([input]) => typeof (input as { input?: string }).input === 'string' && (input as { input: string }).input.includes('Crie EXATAMENTE UMA task'),
    );
    expect(createInstructions).toHaveLength(1);
    // A operação lógica tem chave estável e foi pra instrução (trace).
    expect((createInstructions[0]?.[0] as { input: string }).input).toContain('bento-op:');
  });
});

/* ====================================================================== */
/* CASO 2 — operação repetida na mesma conversa (sameExecutionAlreadyDone) */
/* ====================================================================== */
describe('CASO 2 — idempotência por ExecutionRecord', () => {
  it('2a UPDATE repetido COM ExecutionRecord legado presente → dedup funciona (executor não é chamado)', async () => {
    // Um recibo no formato estruturado (`metadata.execucao`) — produzido pelo
    // guard ANTIGO. O parser real (execution-record.ts:90-92) reconhece.
    h.messageRows.unshift({
      execucao: {
        executionId: 'e-prev', operation: 'update_task', taskIds: ['T9'], targetPerson: null,
        successIds: ['T9'], failedIds: [], timestamp: new Date().toISOString(), verification: [],
      },
    });
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { dueDate: '2026-09-28' } }),
    );

    const result = await run({ message: 'atualiza o prazo da T9 pra dia 28' });
    expect(result?.status).toBe('completed');
    expect(result?.answer).toContain('Já tinha feito isso');
    expect(executeTaskUpdate).not.toHaveBeenCalled();
    expect(callResponses).not.toHaveBeenCalled();
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
  });

  it('2b create_task repetido com ExecutionRecord de create confirmado → dedup por (operação, título normalizado) — REGRESSÃO: o filtro não exige mais resolvedResourceId (F-05)', async () => {
    // Recibo de create_task bem-sucedido nesta conversa (com títulos — o
    // caminho novo grava, ver execução do turno no CASO 2c/legacy create).
    h.messageRows.unshift({
      execucao: {
        executionId: 'e-prev', operation: 'create_task', taskIds: ['T1'], targetPerson: null,
        successIds: ['T1'], failedIds: [], timestamp: new Date().toISOString(), verification: [],
        titles: { T1: 'Post X' },
      },
    });
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Post X' } }));

    const result = await run({ message: 'cria a task Post X' });
    expect(result?.status).toBe('completed');
    expect(result?.answer).toContain('Já tinha criado essa task');
    // Dedup vivo: nenhum executor chamado, nenhuma task nova.
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(callResponses).not.toHaveBeenCalled();
  });

  it('2c caminho NOVO grava ExecutionRecord (D.4/F-04) → o dedup de 2a fica VIVO pra escritas do próprio core (REGRESSÃO)', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { dueDate: '2026-09-28' } }),
    );
    vi.mocked(callResponses).mockResolvedValue({ outputText: 'ok', mcpCalls: [mcpCallOk(JSON.stringify({ id: 'T9' }))] } as never);
    // Read-back D.6 confere o prazo de verdade — devolve a task COM o prazo aplicado.
    vi.mocked(getTask).mockResolvedValue(taskDetail({ dueDate: DUE_28 }));

    const turn1 = await run({ message: 'atualiza o prazo da T9 pra dia 28' });
    expect(turn1?.status).toBe('completed');
    expect(envelopeOf(turn1).verified).toBe(true);

    // envelopeToExecuteResponse grava `execucao` (ExecutionRecord com
    // operationId/provider/argsHash) — o PARSER REAL reconhece:
    const parsed = executionStateFromGuardMetadata(turn1!.metadata as Record<string, unknown>);
    expect(parsed?.kind).toBe('executed');
    if (parsed?.kind === 'executed') {
      expect(parsed.record.operation).toBe('update_task');
      expect(parsed.record.successIds).toEqual(['T9']);
      expect(parsed.record.operationId).toMatch(/^bento-op:/);
      expect(parsed.record.provider).toBe('MCP');
      expect(parsed.record.argsHash).toBeTruthy();
    }

    // Mesma metadata persistida + MESMO update no turno seguinte: o dedup
    // dispara do registro e o MCP NÃO executa de novo.
    h.messageRows.unshift(turn1!.metadata as Record<string, unknown>);
    const turn2 = await run({ message: 'atualiza o prazo da T9 pra dia 28' });
    expect(turn2?.status).toBe('completed');
    expect(turn2?.answer).toContain('Já tinha feito isso');
    // REGRESSÃO (INV-002): callResponses rodou 1× no total (só o turno 1).
    // Antes da correção eram 2 execuções — o dedup só protegia escritas do
    // guard ANTIGO (fault-injection original, F-04).
    expect(callResponses).toHaveBeenCalledTimes(1);
  });

  it('2d QA 28/09/2026: UPDATE diferente sobre a MESMA task (add assignee, depois due date) NÃO é engolido pelo dedup — cada mutação real acontece', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(callResponses).mockResolvedValue({ outputText: 'ok', mcpCalls: [mcpCallOk(JSON.stringify({ id: 'T9' }))] } as never);
    vi.mocked(getTask).mockResolvedValue(taskDetail({ dueDate: DUE_28 }));

    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { assignee: 'Jamile Galdino', assigneeOperation: 'add' } }),
    );
    const turn1 = await run({ message: 'coloca a Jamile Galdino' });
    expect(turn1?.status).toBe('completed');
    expect(turn1?.answer).not.toContain('Já tinha feito isso');

    h.messageRows.unshift(turn1!.metadata as Record<string, unknown>);
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { dueDate: '2026-09-28' } }),
    );
    const turn2 = await run({ message: 'muda o prazo pra sexta' });
    // Achado ao vivo (teste de aceite 28/09/2026): antes da correção este
    // turno respondia "Já tinha feito isso" e NUNCA aplicava a data — o
    // dedup comparava só operação+recurso, não o conteúdo do pedido.
    expect(turn2?.answer).not.toContain('Já tinha feito isso');
    expect(callResponses).toHaveBeenCalledTimes(2);
  });
});

/* ====================================================================== */
/* CASO 3 — MCP indisponível depois do planejamento                        */
/* ====================================================================== */
describe('CASO 3 — MCP falha após o planner propor update_task', () => {
  beforeEach(() => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { dueDate: '2026-09-28' } }),
    );
  });

  it('3a rede/500 na chamada Responses+MCP: erro controlado, retryable, NUNCA converte em CREATE nem cai pro legacy', async () => {
    vi.mocked(callResponses).mockRejectedValue(new Error('ClickUp MCP 500 Internal Server Error'));

    const result = await run({ message: 'muda o prazo da T9' });
    expect(result?.status).toBe('failed');
    expect(envelopeOf(result).success).toBe(false);
    expect(envelopeOf(result).retryable).toBe(true); // classificação: retryable (bento-mcp-executor.ts:111)
    expect(envelopeOf(result).error).toContain('500');
    // A instrução mandada ao MCP era explicitamente "NÃO crie uma task nova"…
    const input = (vi.mocked(callResponses).mock.calls[0]?.[0] as { input: string }).input;
    expect(input).toContain('Atualize a task de id "T9"');
    expect(input).toContain('NÃO crie uma task nova');
    // …e a falha NÃO virou create nem caiu pro gateway legado (não há
    // cross-provider fallback em runtime — a seleção de provider é feita uma
    // única vez, antes, em bento-openai-core.ts:178).
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(executeTaskUpdate).not.toHaveBeenCalled();
    // status 'failed' → execute-job.ts:2016-2027 throw → retry BullMQ do job.
    // Como update via MCP é naturalmente idempotente (mesmo alvo, mesmo
    // campo), o retry aqui é seguro — diferente do CASO 1b (create).
  });

  it('3b a tool MCP retornou erro estruturado: erro controlado, retryable, sem create', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      text: '', mcpCalls: [{ id: 'm1', serverLabel: 'clickup', name: 'update_task', arguments: '{}', output: null, error: 'Task not found' }],
    } as never);

    const result = await run({ message: 'muda o prazo da T9' });
    expect(result?.status).toBe('failed');
    expect(envelopeOf(result).retryable).toBe(true); // bento-mcp-executor.ts:128-131
    expect(envelopeOf(result).error).toContain('Task not found');
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(executeTaskUpdate).not.toHaveBeenCalled();
  });

  it('3c o modelo não chamou nenhuma tool MCP: success=false — COMPORTAMENTO ATUAL: marcado retryable:true (discutível)', async () => {
    vi.mocked(callResponses).mockResolvedValue({ text: 'não vou chamar tool', mcpCalls: [] } as never);

    const result = await run({ message: 'muda o prazo da T9' });
    expect(result?.status).toBe('failed');
    expect(envelopeOf(result).error).toContain('nenhuma mutação real aconteceu');
    // COMPORTAMENTO ATUAL (discutível): falha de COMPORTAMENTO DO MODELO é
    // classificada retryable:true (bento-mcp-executor.ts:114-126). O retry do
    // BullMQ pode reproduzir o mesmo resultado (o modelo pode recusar de
    // novo), gastando tentativas — mas nunca corrompe estado, porque nenhuma
    // mutação aconteceu. Documentado, não forçado.
    expect(envelopeOf(result).retryable).toBe(true);
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
  });
});

/* ====================================================================== */
/* CASO 4 — OAuth MCP ausente/expirado                                     */
/* ====================================================================== */
describe('CASO 4 — seleção de provider e token OAuth', () => {
  it('4a token ausente: selectWriteProvider cai pra LEGACY silenciosamente — sem log, sem aviso ao usuário', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue(null); // sem autorização
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Post X' } }));
    vi.mocked(createVerifiedSeniorTask).mockResolvedValue({
      success: true, resourceId: 'T1', resourceUrl: 'https://app.clickup.com/t/T1', verified: true, data: {} as never, assignedTo: null, wasExisting: false,
    });

    const result = await run({ message: 'cria a task Post X' });
    expect(result?.status).toBe('completed');
    expect(envelopeOf(result).provider).toBe('LEGACY_GATEWAY');
    expect(callResponses).not.toHaveBeenCalled(); // MCP nem tentado

    // COMPORTAMENTO ATUAL: a queda é SILENCIOSA. selectWriteProvider
    // (bento-mcp-executor.ts:40-47) nem recebe logger — é estruturalmente
    // impossível logar o downgrade ali. Nenhum warn/info/error menciona
    // provider/MCP…
    const logged = [fakeLogger.warn, fakeLogger.info, fakeLogger.error].flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.flat());
    expect(logged.filter((x) => typeof x === 'string' && /mcp|provider|fallback|legado/i.test(x))).toHaveLength(0);
    // …e a resposta ao usuário ("Criei a task: …") não informa que o provedor
    // primário foi substituído. Observação: o doc de getClickUpMcpAccessToken
    // (clickup-mcp-oauth.ts:160-162) diz que null deveria ser tratado como
    // "AUTH REQUIRED, nunca fallback silencioso" — o selectWriteProvider faz
    // exatamente o fallback silencioso que o doc proíbe.
    // A asserção é sobre o que a resposta NÃO diz (a troca de provider), não
    // sobre o texto exato: desde 28/09/2026 a confirmação de criação também
    // informa briefing/anexo, e travar a string inteira fazia este teste
    // falhar por um enriquecimento que não tem nada a ver com o que ele prova.
    expect(result?.answer).toContain('https://app.clickup.com/t/T1');
    expect(result?.answer).not.toMatch(/mcp|provider|fallback|legado/i);
  });

  it('4b token presente mas inválido/expirado: MCP 401 → FALHA, sem fallback pro legacy — COMPORTAMENTO ATUAL (bug)', async () => {
    // getClickUpMcpAccessToken (clickup-mcp-oauth.ts:164-171) NÃO confere
    // expiração — devolve o token decifrado se status='connected'. O
    // refresh_token é capturado no exchange (:142-146) mas não existe fluxo
    // de refresh em lugar nenhum.
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-expirado');
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' }, changes: { dueDate: '2026-09-28' } }),
    );
    vi.mocked(callResponses).mockRejectedValue(new Error('ClickUp MCP 401 Unauthorized'));

    const result = await run({ message: 'muda o prazo da T9' });
    expect(result?.status).toBe('failed');
    expect(envelopeOf(result).retryable).toBe(true);
    // COMPORTAMENTO ATUAL (bug): o fallback MCP→LEGACY só existe na SELEÇÃO
    // (token ausente). Um token presente porém expirado gera falha com retry —
    // e o retry vai falhar de novo (401 é determinístico até re-autorizar),
    // estourando as tentativas do BullMQ, enquanto o gateway legado
    // funcional ficava disponível. 401 deveria ser NÃO-retryable + re-auth.
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(executeTaskUpdate).not.toHaveBeenCalled();
  });
});

/* ====================================================================== */
/* CASO 5 — resposta MCP sem task_id parseável                             */
/* ====================================================================== */
describe('CASO 5 — output MCP sem task_id identificável → PARTIAL/UNKNOWN honesto (D.5/F-08)', () => {
  it('5a create via MCP sem id em NENHUMA camada → sem success pleno, sem foco falso, não-retryable (REGRESSÃO)', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Post X' } }));
    // Output texto livre: camada 1 (TASK_ID:) ausente, camada 2 (JSON/URL)
    // sem id, camada 3 (fallback reconcile por título recente) lista vazia.
    vi.mocked(callResponses).mockResolvedValue({ outputText: 'Prontinho!', mcpCalls: [mcpCallOk('Task criada com sucesso no ClickUp ✅')] } as never);

    const result = await run({ message: 'cria a task Post X' });
    const env = envelopeOf(result);
    // REGRESSÃO: antes era success=true com resourceIds=[] (falso sucesso) e
    // o estado era persistido SEM foco (foco perdido provado no 6b).
    expect(env.success).toBe(false);
    expect(env.verified).toBe(false);
    expect(env.error).toMatch(/^write_unconfirmed_resource/);
    expect(env.retryable).toBe(false); // re-executar create não identificado = duplicata (F-03)
    expect(result?.answer).toContain('não consegui identificar a task criada');
    expect(getTask).not.toHaveBeenCalled(); // sem id, não há o que reler

    // Sem foco falso: o estado NÃO é persistido sem resourceIds reais.
    expect(persistResourceState).not.toHaveBeenCalled();
    expect(h.resourceRows.get(CONV) ?? []).toHaveLength(0);
  });

  it('5b turno seguinte "atualiza a task" → target_unresolved (policy), nunca update cego nem create', async () => {
    // Turno 1: igual a 5a — create via MCP sem id identificável (PARTIAL).
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValueOnce(act('create_task', { changes: { title: 'Post X' } }));
    vi.mocked(callResponses).mockResolvedValueOnce({ outputText: 'Prontinho!', mcpCalls: [mcpCallOk('texto livre')] } as never);
    await run({ message: 'cria a task Post X' });

    // Turno 2: "atualiza a task" — nenhum estado foi persistido no turno 1.
    vi.mocked(proposeBentoAction).mockResolvedValueOnce(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: { dueDate: '2026-09-28' } }),
    );
    const turn2 = await run({ message: 'atualiza o prazo dessa task pra dia 28' });
    expect(turn2?.status).toBe('failed');
    expect(envelopeOf(turn2).error).toMatch(/^target_unresolved/);
    expect(turn2?.answer).toContain('Não identifiquei de qual task');
    // Nenhuma escrita aconteceu no turno 2 (INV-001: esclarecimento, nunca create).
    expect(callResponses).toHaveBeenCalledTimes(1); // só o create do turno 1
    expect(executeTaskUpdate).not.toHaveBeenCalled();
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
  });

  it('5c fallback reconcile (D.5 camada 3): output livre MAS título exato criado há < 10 min → id recuperado, foco registrado', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValue(act('create_task', { changes: { title: 'Post X' } }));
    vi.mocked(callResponses).mockResolvedValue({ outputText: 'Prontinho!', mcpCalls: [mcpCallOk('texto livre sem id')] } as never);
    // 1ª consulta = reconcile-first (nada), 2ª = fallback pós-create (acha).
    vi.mocked(queryOperationTasks)
      .mockResolvedValueOnce({ tasks: [], truncated: false, pagesFetched: 1 })
      .mockResolvedValueOnce({ tasks: [{ id: 'T-FOUND', name: 'Post X', createdAt: Date.now() - 8_000 } as never], truncated: false, pagesFetched: 1 });
    vi.mocked(getTask).mockResolvedValue(taskDetail({ id: 'T-FOUND', name: 'Post X' }));

    const result = await run({ message: 'cria a task Post X' });
    const env = envelopeOf(result);
    expect(env.success).toBe(true);
    expect(env.verified).toBe(true);
    expect(env.resourceIds).toEqual(['T-FOUND']);
    // Foco REAL registrado — o turno seguinte resolve "essa task".
    expect(persistResourceState).toHaveBeenCalledTimes(1);
    const rows = h.resourceRows.get(CONV)!;
    expect((rows[0]!.focusedResource as { resourceId: string }).resourceId).toBe('T-FOUND');
  });
});

/* ====================================================================== */
/* CASO 6 — worker restart entre CREATE e a mensagem seguinte              */
/* ====================================================================== */
describe('CASO 6 — restart: foco sobrevive só se foi persistido com id', () => {
  it('6a LEGACY create com id → estado em conversation_context (append-only) → pós-restart "atualiza" resolve o foco', async () => {
    // Turno 1 (instância A): create legado verificado.
    vi.mocked(proposeBentoAction).mockResolvedValueOnce(act('create_task', { changes: { title: 'Post X' } }));
    vi.mocked(createVerifiedSeniorTask).mockResolvedValueOnce({
      success: true, resourceId: 'T1', resourceUrl: 'https://app.clickup.com/t/T1', verified: true, data: {} as never, assignedTo: null, wasExisting: false,
    });
    const turn1 = await run({ message: 'cria a task Post X' });
    expect(turn1?.status).toBe('completed');
    expect(persistResourceState).toHaveBeenCalledTimes(1);

    // RESTART: "nova instância" = nova chamada a runBentoOpenAiCore — ela só
    // conhece o que está no store (loadResourceState relê a linha mais
    // recente e reparseia com parseResourceState REAL, como seria o jsonb do
    // banco). Nada em memória vaza entre os turns neste teste além do store.
    vi.mocked(proposeBentoAction).mockResolvedValueOnce(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: { dueDate: '2026-09-28' } }),
    );
    vi.mocked(executeTaskUpdate).mockResolvedValueOnce({
      execution_id: '', agent: 'bento', status: 'completed', answer: 'Prazo atualizado.', sources: [],
      tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, metadata: {},
    });
    const turn2 = await run({ message: 'atualiza o prazo dessa task pra dia 28' });
    expect(turn2?.status).toBe('completed');
    // O foco sobreviveu ao restart: a policy REAL resolveu T1 do estado lido.
    expect(vi.mocked(executeTaskUpdate).mock.calls[0]?.[0]).toMatchObject({ taskId: 'T1' });

    // Append-only confirmado: 2 linhas, nunca update in-place
    // (bento-resource-state.ts:59-65).
    expect(h.resourceRows.get(CONV)).toHaveLength(2);
  });

  it('6b MCP create sem id identificável (CASO 5) → PARTIAL já no turno 1, NENHUM estado persistido → pós-restart target_unresolved honesto', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('tok-oauth');
    vi.mocked(proposeBentoAction).mockResolvedValueOnce(act('create_task', { changes: { title: 'Post X' } }));
    vi.mocked(callResponses).mockResolvedValueOnce({ outputText: 'ok', mcpCalls: [mcpCallOk('confirmado em texto livre')] } as never);
    const turn1 = await run({ message: 'cria a task Post X' });
    // REGRESSÃO: o turno 1 já admite a incerteza (antes: "completed" com
    // estado persistido vazio de foco — o usuário só descobria a perda no
    // turno seguinte).
    expect(turn1?.status).toBe('failed');
    expect(envelopeOf(turn1).error).toMatch(/^write_unconfirmed_resource/);

    // RESTART + turno seguinte: nada foi persistido (sem id real, sem foco
    // falso) — o estado lido é o vazio.
    const statePosRestart = await vi.mocked(loadResourceState)(CONV);
    expect(statePosRestart.focusedResource).toBeNull();

    vi.mocked(proposeBentoAction).mockResolvedValueOnce(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: { title: 'Novo título' } }),
    );
    const turn2 = await run({ message: 'muda o título dessa task' });
    // A task pode existir no ClickUp (o create foi enviado) mas é inalcançável
    // pela conversa — a resposta do turno 1 já pediu pra conferir a lista, e
    // aqui a policy pede o alvo em vez de inventar um (INV-001).
    expect(turn2?.status).toBe('failed');
    expect(envelopeOf(turn2).error).toMatch(/^target_unresolved/);
  });
});

/* ====================================================================== */
/* CASO 7 — UPDATE sem alvo (INV-001) e prova de "nunca busca global"      */
/* ====================================================================== */
describe('CASO 7 — update sem alvo: esclarecimento, nunca create, nunca busca global', () => {
  const policyCtx = {
    actorHasClickUpWrite: true,
    agentHasClickUpWrite: true,
    mutationsThisExecution: 0,
    maxMutationsPerExecution: 10,
    explicitMultiActionConfirmed: false,
  };

  it('7a estado vazio + update_task sem alvo → target_unresolved → pede esclarecimento; ZERO I/O de escrita/leitura', async () => {
    vi.mocked(proposeBentoAction).mockResolvedValue(
      act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: null }, changes: { dueDate: '2026-09-28' } }),
    );

    const result = await run({ message: 'atualiza o prazo dela pra dia 28' });
    expect(result?.status).toBe('failed');
    expect(envelopeOf(result).error).toMatch(/^target_unresolved/);
    expect(envelopeOf(result).retryable).toBe(false); // esclarecimento não é retry
    expect(result?.answer).toContain('pode me lembrar qual é');
    // INV-001: nunca converteu em create, nunca executou update, nunca falou
    // com OpenAI/MCP nem com o ClickUp — a policy decidiu sozinha.
    expect(createVerifiedSeniorTask).not.toHaveBeenCalled();
    expect(executeTaskUpdate).not.toHaveBeenCalled();
    expect(callResponses).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
  });

  it('7b resolveTargetResourceId (policy REAL) nunca inventa alvo: ambiguidade → null; e a policy não recebe nenhum canal de I/O', () => {
    const updateSemAlvo = act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: null } });

    // Estado vazio → null.
    expect(resolveTargetResourceId(updateSemAlvo, emptyResourceState())).toBeNull();

    // Seleção AMBÍGUA (2 tasks) → null. A policy prefere esclarecimento a
    // escolher uma — e não tem NENHUM mecanismo de busca global: sua assinatura
    // recebe apenas (action, state, ctx) — sem config, sem db, sem executor.
    const ambiguo = {
      ...emptyResourceState(),
      selectedResources: [
        { resourceType: 'CLICKUP_TASK' as const, resourceId: 'T1', title: 'a' },
        { resourceType: 'CLICKUP_TASK' as const, resourceId: 'T2', title: 'b' },
      ],
    };
    expect(resolveTargetResourceId(updateSemAlvo, ambiguo)).toBeNull();
    expect(validateBentoAction(updateSemAlvo, ambiguo, policyCtx).reason).toMatch(/^target_unresolved/);

    // lastExecution com 2 ids também é ambíguo → null.
    const multiExec = {
      ...emptyResourceState(),
      lastExecution: { operation: 'update_task', resourceIds: ['T1', 'T2'], verified: true, at: new Date().toISOString() },
    };
    expect(resolveTargetResourceId(updateSemAlvo, multiExec)).toBeNull();

    // Prioridade correta quando o alvo EXISTE no estado: id explícito > foco
    // > seleção única > lastExecution único (policy.ts:33-40).
    const comFoco = { ...emptyResourceState(), focusedResource: { resourceType: 'CLICKUP_TASK' as const, resourceId: 'T7', title: 'x' } };
    expect(resolveTargetResourceId(updateSemAlvo, comFoco)).toBe('T7');
    expect(
      resolveTargetResourceId(act('update_task', { target: { resourceType: 'CLICKUP_TASK', resourceId: 'T9' } }), comFoco),
    ).toBe('T9');

    // Prova estrutural do "nunca busca global": validateBentoAction é função
    // pura de 3 argumentos — nenhum parâmetro de I/O existe para ela usar.
    expect(validateBentoAction.length).toBe(3);
    expect(getTask).not.toHaveBeenCalled();
  });
});
