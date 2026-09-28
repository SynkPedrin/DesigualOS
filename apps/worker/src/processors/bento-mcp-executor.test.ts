import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@desigual-os/openai-provider', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/openai-provider')>('@desigual-os/openai-provider');
  return { ...actual, callResponses: vi.fn() };
});
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return {
    ...actual,
    getClickUpMcpAccessToken: vi.fn(),
    getTask: vi.fn(),
    getTaskComments: vi.fn(),
    queryOperationTasks: vi.fn(),
    resolveMemberByName: vi.fn(),
  };
});

import { callResponses } from '@desigual-os/openai-provider';
import { getClickUpMcpAccessToken, getTask, getTaskComments, queryOperationTasks, resolveMemberByName } from '@desigual-os/tool-gateway';
import { executeViaMcp, selectWriteProvider, type ExecuteViaMcpParams } from './bento-mcp-executor.js';
import type { StructuredAction } from '@desigual-os/bento-core';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

function action(over: Partial<StructuredAction> = {}): StructuredAction {
  return { intent: 'update_task', target: null, changes: { title: 'Novo título' }, requestedCardinality: 0, reasoning: 'r', ...over };
}

function params(over: Partial<ExecuteViaMcpParams> = {}): ExecuteViaMcpParams {
  return {
    action: action(),
    resolvedResourceId: 'T1',
    listId: null,
    mcpToken: 'tok',
    legacyReadConfig: { apiKey: 'k', teamId: 't' },
    operationId: 'bento-op:test',
    logger: fakeLogger,
    ...over,
  };
}

/** TaskDetail completo, como o getTask real devolve. */
function taskDetail(over: Record<string, unknown> = {}) {
  return { id: 'T1', name: 'Novo título', status: null, priority: null, dueDate: null, listId: 'L1', assignees: [], description: '', attachments: [], ...over } as never;
}

function responsesOk(output: string | null, outputText = 'Feito.') {
  return {
    responseId: 'r1',
    outputText,
    toolCalls: [],
    mcpCalls: [{ id: 'c1', serverLabel: 'clickup', name: 'create_task', arguments: '{}', output, error: null }],
    usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 5 },
    model: 'test-model',
  } as never;
}

describe('selectWriteProvider (§2 — MCP primary, legacy só sem autorização)', () => {
  beforeEach(() => vi.mocked(getClickUpMcpAccessToken).mockReset());

  it('escolhe MCP quando o usuário já autorizou (token presente)', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('token-real');
    const selection = await selectWriteProvider('update_task', 'user-1');
    expect(selection.provider).toBe('MCP');
  });

  it('cai pra LEGACY_GATEWAY quando não há token MCP', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue(null);
    const selection = await selectWriteProvider('update_task', 'user-1');
    expect(selection.provider).toBe('LEGACY_GATEWAY');
  });

  it('nunca chama os dois: UNSUPPORTED para intent sem executor verificado', async () => {
    vi.mocked(getClickUpMcpAccessToken).mockResolvedValue('token-real');
    const selection = await selectWriteProvider('read_tasks', 'user-1');
    expect(selection.provider).toBe('UNSUPPORTED');
  });
});

describe('executeViaMcp (mockado — zero chamada real a OpenAI/ClickUp MCP)', () => {
  beforeEach(() => {
    vi.mocked(callResponses).mockReset();
    vi.mocked(getTask).mockReset();
    vi.mocked(getTaskComments).mockReset();
    vi.mocked(queryOperationTasks).mockReset();
    vi.mocked(resolveMemberByName).mockReset();
    vi.mocked(getTaskComments).mockResolvedValue([]);
    vi.mocked(queryOperationTasks).mockResolvedValue({ tasks: [], truncated: false, pagesFetched: 1 });
    vi.mocked(resolveMemberByName).mockResolvedValue({ status: 'not_found' } as never);
  });

  it('monta a tool MCP com o token e envia SEM allowed_tools hardcoded', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk(JSON.stringify({ id: 'T1' })));
    vi.mocked(getTask).mockResolvedValue(taskDetail());

    const envelope = await executeViaMcp(params());

    expect(envelope.success).toBe(true);
    expect(envelope.provider).toBe('MCP');
    expect(envelope.resourceIds).toEqual(['T1']);
    expect(envelope.verified).toBe(true);
    const call = vi.mocked(callResponses).mock.calls[0]![0];
    expect(call.tools?.[0]).toMatchObject({ type: 'mcp', server_url: 'https://mcp.clickup.com/mcp' });
    expect((call.tools?.[0] as { allowed_tools?: unknown }).allowed_tools).toBeUndefined();
  });

  it('a instrução exige output estruturado (TASK_ID/TASK_URL) e a chave da operação vai no input', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk(JSON.stringify({ id: 'T1' })));
    vi.mocked(getTask).mockResolvedValue(taskDetail());

    await executeViaMcp(params({ operationId: 'bento-op:abc123' }));

    const call = vi.mocked(callResponses).mock.calls[0]![0];
    expect(call.instructions).toContain('TASK_ID:');
    expect(call.instructions).toContain('nunca invente um id');
    expect(call.input).toContain('bento-op:abc123');
    expect(call.input).toContain('NÃO inclua este identificador');
  });

  it('reporta falha quando a tool MCP devolve erro — nunca finge sucesso', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r2',
      outputText: '',
      toolCalls: [],
      mcpCalls: [{ id: 'c1', serverLabel: 'clickup', name: 'update_task', arguments: '{}', output: null, error: 'task not found' }],
      usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 0 },
      model: 'gpt-5.6-terra',
    });

    const envelope = await executeViaMcp(params({ legacyReadConfig: null }));
    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('task not found');
  });

  it('reporta falha quando o modelo não chama nenhuma tool MCP (nenhuma mutação real aconteceu)', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r3',
      outputText: 'Não consigo fazer isso.',
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 5 },
      model: 'gpt-5.6-terra',
    });

    const envelope = await executeViaMcp(params({ legacyReadConfig: null }));
    expect(envelope.success).toBe(false);
    expect(envelope.resourceIds).toEqual([]);
  });

  it('verified fica false com degradação explícita quando não há config legado pra reler (não inventa confirmação)', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk(JSON.stringify({ id: 'T1' })));

    const envelope = await executeViaMcp(params({ legacyReadConfig: null }));
    expect(envelope.success).toBe(true);
    expect(envelope.verified).toBe(false);
    expect(envelope.readback?.unavailable).toBe(true);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- */
  /* D.3/F-03 — create idempotente (reconcile-first)                   */
  /* ---------------------------------------------------------------- */

  const createAction = () => action({ intent: 'create_task', changes: { title: 'Post X' } });

  it('D.3: reconcile-first acha task existente → devolve ela SEM instruir create ao MCP', async () => {
    vi.mocked(queryOperationTasks).mockResolvedValue({
      tasks: [{ id: 'T-OLD', name: 'Post X', createdAt: Date.now() - 60_000 } as never],
      truncated: false,
      pagesFetched: 1,
    });
    vi.mocked(getTask).mockResolvedValue(taskDetail({ id: 'T-OLD', name: 'Post X' }));

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));

    expect(envelope.success).toBe(true);
    expect(envelope.wasExisting).toBe(true);
    expect(envelope.resourceIds).toEqual(['T-OLD']);
    expect(envelope.verified).toBe(true);
    expect(callResponses).not.toHaveBeenCalled(); // nenhum create instruído
  });

  it('D.3: checagem de duplicata FALHOU → erro retryable, NUNCA create no escuro (lição P1-01)', async () => {
    vi.mocked(queryOperationTasks).mockRejectedValue(new Error('ClickUp 429'));

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));

    expect(envelope.success).toBe(false);
    expect(envelope.retryable).toBe(true);
    expect(envelope.error).toContain('duplicata');
    expect(callResponses).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- */
  /* D.5/F-08 — task_id robusto em camadas                             */
  /* ---------------------------------------------------------------- */

  it('D.5 camada 1/2: id sai do formato TASK_ID: do texto final quando o output da tool é texto livre', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk('Task criada com sucesso ✅', 'TASK_ID: T-TAGGED\nTASK_URL: https://app.clickup.com/t/T-TAGGED'));
    vi.mocked(getTask).mockResolvedValue(taskDetail({ id: 'T-TAGGED', name: 'Post X' }));

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));
    expect(envelope.resourceIds).toEqual(['T-TAGGED']);
    expect(envelope.verified).toBe(true);
  });

  it('D.5 camada 2: id sai de URL ClickUp no output da tool', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk('veja em https://app.clickup.com/t/T-URL-1'));
    vi.mocked(getTask).mockResolvedValue(taskDetail({ id: 'T-URL-1', name: 'Post X' }));

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));
    expect(envelope.resourceIds).toEqual(['T-URL-1']);
  });

  it('D.5 camada 3: sem id no retorno → fallback reconcile casa título exato criado há < 10 min', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk('texto livre sem id', 'Prontinho!'));
    // 1ª chamada = reconcile-first (vazio), 2ª = fallback pós-create (acha a task recém-criada)
    vi.mocked(queryOperationTasks)
      .mockResolvedValueOnce({ tasks: [], truncated: false, pagesFetched: 1 })
      .mockResolvedValueOnce({ tasks: [{ id: 'T-NEW', name: 'Post X', createdAt: Date.now() - 5_000 } as never], truncated: false, pagesFetched: 1 });
    vi.mocked(getTask).mockResolvedValue(taskDetail({ id: 'T-NEW', name: 'Post X' }));

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));
    expect(envelope.success).toBe(true);
    expect(envelope.resourceIds).toEqual(['T-NEW']);
  });

  it('D.5 camada 3: título idêntico mas criado há HORAS não é desta operação → PARTIAL/UNKNOWN (nunca foco falso)', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk('texto livre', 'ok'));
    // 1ª consulta = reconcile-first (nada — a task antiga já foi fechada/
    // saiu da página); 2ª = fallback pós-create, que acha só a task ANTIGA.
    // A janela de 10 min protege: título idêntico antigo NÃO é desta operação.
    vi.mocked(queryOperationTasks)
      .mockResolvedValueOnce({ tasks: [], truncated: false, pagesFetched: 1 })
      .mockResolvedValueOnce({
        tasks: [{ id: 'T-ANCIENT', name: 'Post X', createdAt: Date.now() - 3_600_000 } as never],
        truncated: false,
        pagesFetched: 1,
      });

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));
    expect(envelope.success).toBe(false);
    expect(envelope.error).toMatch(/^write_unconfirmed_resource/);
    expect(envelope.retryable).toBe(false); // re-executar create não identificado = duplicata (F-03)
  });

  it('D.5 camada 4: nada resolve o id → PARTIAL/UNKNOWN honesto, não-retryable', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk('texto livre', 'Prontinho!'));

    const envelope = await executeViaMcp(params({ action: createAction(), resolvedResourceId: null, listId: 'L1' }));
    expect(envelope.success).toBe(false);
    expect(envelope.verified).toBe(false);
    expect(envelope.resourceIds).toEqual([]);
    expect(envelope.retryable).toBe(false);
    expect(envelope.error).toContain('não consegui identificar a task criada');
  });

  /* ---------------------------------------------------------------- */
  /* D.6/F-08 — read-back real (campos, não só existência)             */
  /* ---------------------------------------------------------------- */

  it('D.6: update confere o campo alterado — título divergente → verified=false com mismatch legível', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk(JSON.stringify({ id: 'T1' })));
    vi.mocked(getTask).mockResolvedValue(taskDetail({ name: 'Título velho que não mudou' }));

    const envelope = await executeViaMcp(params());
    expect(envelope.success).toBe(true); // a mutação foi enviada…
    expect(envelope.verified).toBe(false); // …mas NUNCA success pleno sem conferir
    expect(envelope.readback?.unavailable).toBe(false);
    expect(envelope.readback?.mismatches.join(' ')).toContain('Título velho');
  });

  it('D.6: update de responsável (remove) confere ausência na releitura', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk(JSON.stringify({ id: 'T1' })));
    vi.mocked(resolveMemberByName).mockResolvedValue({ status: 'resolved', member: { id: 7, username: 'Matheus', email: 'm@m' } } as never);
    vi.mocked(getTask).mockResolvedValue(taskDetail({ assignees: [{ id: 7, username: 'Matheus' }] }));

    const envelope = await executeViaMcp(params({ action: action({ changes: { assignee: 'Matheus', assigneeOperation: 'remove' } }) }));
    expect(envelope.verified).toBe(false);
    expect(envelope.readback?.mismatches.join(' ')).toContain('continua responsável');
  });

  it('D.6: comment confere o texto na releitura dos comentários', async () => {
    vi.mocked(callResponses).mockResolvedValue(responsesOk(JSON.stringify({ id: 'T1' })));
    vi.mocked(getTaskComments).mockResolvedValue([{ id: 'c1', text: 'observação importante do usuário', userId: 1, username: 'u', date: '1' }]);

    const envelope = await executeViaMcp(params({ action: action({ intent: 'comment_task', changes: { comment: 'observação importante do usuário' } }) }));
    expect(envelope.verified).toBe(true);
    expect(envelope.readback?.checked).toContain('comentário');
  });
});
