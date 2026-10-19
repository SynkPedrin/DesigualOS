import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@desigual-os/openai-provider', async () => {
  const actual = await vi.importActual<typeof import('@desigual-os/openai-provider')>('@desigual-os/openai-provider');
  return { ...actual, isOpenAICredentialConfigured: vi.fn(() => true), callResponses: vi.fn() };
});

import { callResponses, isOpenAICredentialConfigured } from '@desigual-os/openai-provider';
import { extractCampaignBriefFromMessage } from './extract.js';

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

describe('extractCampaignBriefFromMessage (mockado — zero chamada real)', () => {
  beforeEach(() => {
    vi.mocked(callResponses).mockReset();
    vi.mocked(isOpenAICredentialConfigured).mockReturnValue(true);
  });

  it('extrai o briefing sem tools (nenhuma execução real é possível a partir desta chamada)', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r1',
      outputText: JSON.stringify({ campaignName: 'Expo Agro', objective: 'Vender agora', offer: { price: 'R$ 400.000' } }),
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 },
      model: 'gpt-5.6-luna',
    });

    const brief = await extractCampaignBriefFromMessage('Crie um motion... Valor: R$ 400.000.', fakeLogger);
    expect(brief?.campaignName).toBe('Expo Agro');
    expect(brief?.offer?.price).toBe('R$ 400.000');
    const callArgs = vi.mocked(callResponses).mock.calls[0]![0];
    expect(callArgs.tools).toBeUndefined();
  });

  it('retorna null sem credencial, nunca lança e nunca chama a rede', async () => {
    vi.mocked(isOpenAICredentialConfigured).mockReturnValue(false);
    const brief = await extractCampaignBriefFromMessage('faz um motion', fakeLogger);
    expect(brief).toBeNull();
    expect(callResponses).not.toHaveBeenCalled();
  });

  it('retorna null quando o modelo devolve JSON fora do schema, sem lançar', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r2',
      outputText: JSON.stringify({ duration: 'quinze segundos' }), // duration deveria ser número
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      model: 'gpt-5.6-luna',
    });
    const brief = await extractCampaignBriefFromMessage('x', fakeLogger);
    expect(brief).toBeNull();
  });

  it('retorna null quando o modelo devolve texto que não é JSON, sem lançar', async () => {
    vi.mocked(callResponses).mockResolvedValue({
      responseId: 'r3',
      outputText: 'não consigo extrair isso',
      toolCalls: [],
      mcpCalls: [],
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      model: 'gpt-5.6-luna',
    });
    const brief = await extractCampaignBriefFromMessage('x', fakeLogger);
    expect(brief).toBeNull();
  });
});
