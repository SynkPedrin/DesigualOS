import { describe, expect, it, vi, beforeEach } from 'vitest';
import { emptyResourceState } from './types.js';

/**
 * Mock de módulo inteiro: NENHUMA chamada de rede real à OpenAI acontece
 * nesta suíte (regra da missão). `callResponses` é substituído por um fake
 * que devolve um JSON de ação estruturada fixo por teste.
 */
vi.mock('@desigual-os/openai-provider', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/openai-provider')>('@desigual-os/openai-provider');
  return {
    ...actual,
    isOpenAICredentialConfigured: vi.fn(() => true),
    callResponses: vi.fn(),
  };
});

import { callResponses, isOpenAICredentialConfigured } from '@desigual-os/openai-provider';
import { BentoPlannerError, proposeBentoAction } from './planner.js';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('fastify').FastifyBaseLogger;

describe('proposeBentoAction (mockado — zero chamada real)', () => {
  beforeEach(() => {
    vi.mocked(callResponses).mockReset();
    vi.mocked(isOpenAICredentialConfigured).mockReturnValue(true);
  });

  it('nunca passa `tools` pro Responses — §2 da missão, modelo não muta ClickUp direto', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r1',
      outputText: JSON.stringify({
        intent: 'create_task',
        target: null,
        changes: { title: 'Post X' },
        requestedCardinality: 1,
        reasoning: 'pedido singular',
      }),
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 20 },
      model: 'gpt-5.6-terra',
    });

    const action = await proposeBentoAction({
      message: 'cria uma task de post pro Instagram',
      resourceState: emptyResourceState(),
      clientName: 'Cliente Teste',
      logger: fakeLogger,
    });

    expect(action.intent).toBe('create_task');
    expect(action.requestedCardinality).toBe(1);
    const callArgs = vi.mocked(callResponses).mock.calls[0]![0];
    expect(callArgs.tools).toBeUndefined();
  });

  it('lança BentoPlannerError sem credencial, nunca cai pra outro provider silenciosamente', async () => {
    vi.mocked(isOpenAICredentialConfigured).mockReturnValue(false);
    await expect(
      proposeBentoAction({ message: 'oi', resourceState: emptyResourceState(), clientName: null, logger: fakeLogger }),
    ).rejects.toThrow(BentoPlannerError);
    expect(callResponses).not.toHaveBeenCalled();
  });

  it('lança BentoPlannerError quando o modelo devolve JSON fora do schema', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r2',
      outputText: JSON.stringify({ intent: 'invalid_intent' }),
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      model: 'gpt-5.6-terra',
    });
    await expect(
      proposeBentoAction({ message: 'x', resourceState: emptyResourceState(), clientName: null, logger: fakeLogger }),
    ).rejects.toThrow(BentoPlannerError);
  });

  it('D.11/F-17: schema aceita assigneeOperation (remove) — "tira o Matheus dela" deixa de ser ação fora do schema', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r3',
      outputText: JSON.stringify({
        intent: 'update_task',
        target: { resourceType: 'CLICKUP_TASK', resourceId: null },
        changes: { assignee: 'Matheus', assigneeOperation: 'remove' },
        requestedCardinality: 0,
        reasoning: 'remoção de responsável sobre recurso em foco',
      }),
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 20 },
      model: 'gpt-5.6-terra',
    });

    const action = await proposeBentoAction({
      message: 'não, tira o Matheus dela',
      resourceState: emptyResourceState(),
      clientName: null,
      logger: fakeLogger,
    });

    expect(action.intent).toBe('update_task');
    expect(action.changes?.assignee).toBe('Matheus');
    expect(action.changes?.assigneeOperation).toBe('remove');
  });

  it('D.11/D.12: o prompt instrui a distinção add/remove/replace e PROÍBE placeholder de conteúdo', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r4',
      outputText: JSON.stringify({ intent: 'read_tasks', target: null, changes: null, requestedCardinality: 0, reasoning: 'r' }),
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      model: 'gpt-5.6-terra',
    });

    await proposeBentoAction({ message: 'quais tasks?', resourceState: emptyResourceState(), clientName: null, logger: fakeLogger });

    const instructions = vi.mocked(callResponses).mock.calls[0]![0].instructions ?? '';
    expect(instructions).toContain('assigneeOperation="remove"');
    expect(instructions).toContain('assigneeOperation="add"');
    expect(instructions).toContain('assigneeOperation="replace"');
    expect(instructions).toContain('tira o Matheus');
    // D.12/F-18: placeholder ("observação não especificada") é proibido no prompt
    expect(instructions).toContain('PROIBIDO');
    expect(instructions).toContain('observação não especificada');
  });

  it('QA 28/09/2026: "criadas recentemente" lista TÍTULO + ordinal de criação, não só ids — sem isto "volta na primeira" não tem como casar por nome', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r5',
      outputText: JSON.stringify({ intent: 'read_tasks', target: null, changes: null, requestedCardinality: 0, reasoning: 'r' }),
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      model: 'gpt-5.6-terra',
    });

    // applyExecutionToState prepende: index 0 é a MAIS RECENTE (B), index 1 é a mais antiga (A).
    const state = {
      ...emptyResourceState(),
      recentCreatedResources: [
        { resourceType: 'CLICKUP_TASK' as const, resourceId: 'B1', title: 'QA MEMORIA B' },
        { resourceType: 'CLICKUP_TASK' as const, resourceId: 'A1', title: 'QA MEMORIA A' },
      ],
    };
    await proposeBentoAction({ message: 'volta na primeira e muda o nome', resourceState: state, clientName: null, logger: fakeLogger });

    const input = vi.mocked(callResponses).mock.calls[0]![0].input;
    // "a primeira" (criada primeiro) precisa aparecer como [1ª] com o id A1 — ordem de criação, não ordem de inserção no array.
    expect(input).toContain('[1ª] A1 "QA MEMORIA A"');
    expect(input).toContain('[2ª] B1 "QA MEMORIA B"');

    const instructions = vi.mocked(callResponses).mock.calls[0]![0].instructions ?? '';
    expect(instructions).toContain('ORDINAL');
  });
});
