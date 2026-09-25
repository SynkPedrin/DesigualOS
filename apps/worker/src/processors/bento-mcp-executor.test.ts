import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@desigual-os/openai-provider', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/openai-provider')>('@desigual-os/openai-provider');
  return { ...actual, callResponses: vi.fn() };
});
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return { ...actual, getClickUpMcpAccessToken: vi.fn(), getTask: vi.fn() };
});

import { callResponses } from '@desigual-os/openai-provider';
import { getClickUpMcpAccessToken, getTask } from '@desigual-os/tool-gateway';
import { executeViaMcp, selectWriteProvider } from './bento-mcp-executor.js';
import type { StructuredAction } from '@desigual-os/bento-core';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

function action(over: Partial<StructuredAction> = {}): StructuredAction {
  return { intent: 'update_task', target: null, changes: { title: 'Novo título' }, requestedCardinality: 0, reasoning: 'r', ...over };
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
  });

  it('monta a tool MCP com o token e envia SEM allowed_tools hardcoded', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r1',
      outputText: 'Feito.',
      toolCalls: [],
      mcpCalls: [{ id: 'c1', serverLabel: 'clickup', name: 'update_task', arguments: '{}', output: JSON.stringify({ id: 'T1' }), error: null }],
      usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 5 },
      model: 'gpt-5.6-terra',
    });
    vi.mocked(getTask).mockResolvedValue({ id: 'T1' } as never);

    const envelope = await executeViaMcp({ action: action(), resolvedResourceId: 'T1', listId: null, mcpToken: 'tok', legacyReadConfig: { apiKey: 'k', teamId: 't' }, logger: fakeLogger });

    expect(envelope.success).toBe(true);
    expect(envelope.provider).toBe('MCP');
    expect(envelope.resourceIds).toEqual(['T1']);
    expect(envelope.verified).toBe(true);
    const call = vi.mocked(callResponses).mock.calls[0]![0];
    expect(call.tools?.[0]).toMatchObject({ type: 'mcp', server_url: 'https://mcp.clickup.com/mcp' });
    expect((call.tools?.[0] as { allowed_tools?: unknown }).allowed_tools).toBeUndefined();
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

    const envelope = await executeViaMcp({ action: action(), resolvedResourceId: 'T1', listId: null, mcpToken: 'tok', legacyReadConfig: null, logger: fakeLogger });
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

    const envelope = await executeViaMcp({ action: action(), resolvedResourceId: 'T1', listId: null, mcpToken: 'tok', legacyReadConfig: null, logger: fakeLogger });
    expect(envelope.success).toBe(false);
    expect(envelope.resourceIds).toEqual([]);
  });

  it('verified fica false quando não há config legado pra reler (não inventa confirmação)', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r4',
      outputText: 'Feito.',
      toolCalls: [],
      mcpCalls: [{ id: 'c1', serverLabel: 'clickup', name: 'update_task', arguments: '{}', output: JSON.stringify({ id: 'T1' }), error: null }],
      usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 5 },
      model: 'gpt-5.6-terra',
    });

    const envelope = await executeViaMcp({ action: action(), resolvedResourceId: 'T1', listId: null, mcpToken: 'tok', legacyReadConfig: null, logger: fakeLogger });
    expect(envelope.success).toBe(true);
    expect(envelope.verified).toBe(false);
  });
});
