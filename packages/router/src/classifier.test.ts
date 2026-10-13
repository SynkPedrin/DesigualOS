import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

/**
 * O que este teste garante é o CONTRATO do classificador, não a qualidade da
 * classificação: com credencial ausente, resposta mal formada, resposta que não
 * bate no schema, prazo estourado ou provedor fora do ar, ele sempre devolve
 * `null` — o fallback seguro para o rule engine em route.ts — e nunca lança
 * nem finge confiança que não tem.
 *
 * O PROVEDOR É MOCKADO, e isso não é zelo: em 13/10/2026, ao trocar de
 * Anthropic para GPT, os mocks antigos deixaram de interceptar e a suíte passou
 * a fazer CHAMADAS REAIS E PAGAS à OpenAI — visível nos tempos de teste, que
 * saltaram para 1,7s e 3,1s. Teste que gasta dinheiro de verdade é teste que
 * alguém vai parar de rodar.
 */

const callResponsesMock = vi.fn();
const credencialConfiguradaMock = vi.fn(() => true);

vi.mock('@desigual-os/openai-provider', () => ({
  callResponses: (...args: unknown[]) => callResponsesMock(...args),
  isOpenAICredentialConfigured: () => credencialConfiguradaMock(),
  // O roteamento é sempre o degrau mais barato; o teste fixa isso de
  // propósito, para a escolha de modelo não virar detalhe invisível.
  pickModel: () => ({ tier: 'luna', model: 'gpt-5.6-luna', downgraded: false, reason: 'teste' }),
}));

function fakeLogger(): FastifyBaseLogger {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;
}

const RESULTADO_VALIDO = {
  intent: 'campaign_analysis',
  primary_agent: 'jarbas',
  required_tools: [],
  estimated_complexity: 'medium',
  workflow: null,
};

function respostaCom(texto: string) {
  return { responseId: 'resp_1', outputText: texto, toolCalls: [], mcpCalls: [] };
}

describe('classifyWithLLM', () => {
  afterEach(() => {
    callResponsesMock.mockReset();
    credencialConfiguradaMock.mockReset();
    credencialConfiguradaMock.mockReturnValue(true);
    vi.useRealTimers();
  });

  it('devolve null SEM chamar o provedor quando não há credencial', async () => {
    credencialConfiguradaMock.mockReturnValue(false);
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    const resultado = await classifyWithLLM('crie uma campanha', logger);

    expect(resultado).toBeNull();
    expect(callResponsesMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('devolve o resultado parseado quando a resposta é um JSON válido do schema', async () => {
    callResponsesMock.mockResolvedValue(respostaCom(JSON.stringify(RESULTADO_VALIDO)));
    const { classifyWithLLM } = await import('./classifier.js');

    expect(await classifyWithLLM('crie uma campanha', fakeLogger())).toEqual(RESULTADO_VALIDO);
  });

  /**
   * O modelo é parte do contrato: classificar é tarefa pequena e tem que sair
   * no degrau mais barato. Se alguém trocar a tarefa para um tier caro, este
   * teste avisa — custo que sobe em silêncio não é achado, é fatura.
   */
  it('classifica no modelo mais barato, e manda as instruções como prefixo estável', async () => {
    callResponsesMock.mockResolvedValue(respostaCom(JSON.stringify(RESULTADO_VALIDO)));
    const { classifyWithLLM } = await import('./classifier.js');

    await classifyWithLLM('crie uma campanha', fakeLogger());

    const [pedido] = callResponsesMock.mock.calls[0] as [{ model: string; instructions: string; input: string }];
    expect(pedido.model).toBe('gpt-5.6-luna');
    expect(pedido.input).toBe('crie uma campanha');
    // O prefixo estável é o que permite o cache de prompt cobrar a fração do
    // preço nas repetições; mensagem do usuário no prefixo quebraria o cache.
    expect(pedido.instructions).not.toContain('crie uma campanha');
  });

  it('devolve null quando a resposta não é JSON válido', async () => {
    callResponsesMock.mockResolvedValue(respostaCom('isso não é json'));
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    expect(await classifyWithLLM('crie uma campanha', logger)).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('devolve null quando o JSON é válido mas não bate no schema', async () => {
    callResponsesMock.mockResolvedValue(
      respostaCom(JSON.stringify({ ...RESULTADO_VALIDO, primary_agent: 'agente_que_nao_existe' })),
    );
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    expect(await classifyWithLLM('crie uma campanha', logger)).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('devolve null quando a resposta vem vazia', async () => {
    callResponsesMock.mockResolvedValue(respostaCom(''));
    const { classifyWithLLM } = await import('./classifier.js');

    expect(await classifyWithLLM('crie uma campanha', fakeLogger())).toBeNull();
  });

  /**
   * O prazo existe porque esta chamada roda no caminho SÍNCRONO do POST /chat:
   * provedor lento segura a resposta da pessoa. O teste usa uma promessa que
   * NUNCA assenta, e não um erro de timeout — erro o código já tratava; o que
   * ele não tratava era a espera.
   */
  it('provedor que nunca responde vira null por prazo, sem derrubar o turno', async () => {
    vi.useFakeTimers();
    callResponsesMock.mockImplementation(() => new Promise(() => {}));
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    const promessa = classifyWithLLM('crie uma campanha', logger);
    await vi.advanceTimersByTimeAsync(10_001);

    expect(await promessa).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  /**
   * Credencial INVÁLIDA passa por `isOpenAICredentialConfigured()` — a chave
   * existe, só não vale. Sem registro em nível de ERRO, esse estado fica
   * indistinguível de roteamento normal: a pessoa recebe "não consegui
   * identificar", que culpa a pergunta dela por uma ambiguidade que não existe.
   * Falha de terceiro pode não derrubar o turno; não pode passar despercebida.
   */
  it('falha do provedor não lança, mas é registrada como ERRO, não como aviso', async () => {
    callResponsesMock.mockRejectedValue(Object.assign(new Error('invalid api key'), { name: 'AuthenticationError' }));
    const { classifyWithLLM } = await import('./classifier.js');
    const logger = fakeLogger();

    expect(await classifyWithLLM('crie uma campanha', logger)).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});
