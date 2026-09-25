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
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      model: 'gpt-5.6-terra',
    });
    await expect(
      proposeBentoAction({ message: 'x', resourceState: emptyResourceState(), clientName: null, logger: fakeLogger }),
    ).rejects.toThrow(BentoPlannerError);
  });
});
