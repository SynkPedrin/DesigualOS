import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

/**
 * classifyWithLLM nunca foi validado contra a API real da Anthropic (ver
 * comentário no próprio arquivo). O que este teste garante é o contrato: com
 * chave ausente, resposta mal formada ou resposta que não bate no schema,
 * o classifier sempre devolve `null` (fallback seguro pro rule engine em
 * route.ts) e nunca lança nem finge confiança que não tem.
 */

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock },
  })),
}));

function fakeLogger(): FastifyBaseLogger {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;
}

const VALID_RESULT = {
  intent: 'campaign_analysis',
  primary_agent: 'jarbas',
  required_tools: [],
  estimated_complexity: 'medium',
  workflow: null,
};

describe('classifyWithLLM', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createMock.mockReset();
  });

  it('devolve null sem chamar a API quando ANTHROPIC_API_KEY está ausente', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    const result = await classifyWithLLM('crie uma campanha', logger);

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('devolve o resultado parseado quando a resposta é um JSON válido do schema', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-de-teste');
    createMock.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(VALID_RESULT) }] });
    const { classifyWithLLM } = await import('./classifier.js');

    const result = await classifyWithLLM('crie uma campanha', fakeLogger());

    expect(result).toEqual(VALID_RESULT);
  });

  it('devolve null quando a resposta não é JSON válido', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-de-teste');
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'isso não é json' }] });
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    const result = await classifyWithLLM('crie uma campanha', logger);

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('devolve null quando o JSON é válido mas não bate no schema (ex: primary_agent desconhecido)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-de-teste');
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ ...VALID_RESULT, primary_agent: 'agente_que_nao_existe' }) }],
    });
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    const result = await classifyWithLLM('crie uma campanha', logger);

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('devolve null quando a resposta não tem bloco de texto nenhum', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-de-teste');
    createMock.mockResolvedValue({ content: [{ type: 'tool_use' }] });
    const { classifyWithLLM } = await import('./classifier.js');

    const result = await classifyWithLLM('crie uma campanha', fakeLogger());

    expect(result).toBeNull();
  });
});
