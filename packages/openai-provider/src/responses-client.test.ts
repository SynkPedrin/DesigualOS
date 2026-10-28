import { afterEach, describe, expect, it, vi } from 'vitest';

// Toda chamada bem-sucedida grava no ledger de custo (ledger.ts). Rodado na
// máquina com o .env de produção, este teste gravaria uso falso lá: o banco
// é forçado para um endereço inalcançável e o ledger é substituído.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
});
const gravarUso = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./ledger.js', () => ({ recordOpenAIUsage: gravarUso }));
import type OpenAI from 'openai';
const { __setOpenAIClientForTest, callResponses } = await import('./responses-client');

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function clientFalso() {
  const create = vi.fn(async () => ({ id: 'r1', output_text: 'ok', output: [], usage: { input_tokens: 1, output_tokens: 1 } }));
  __setOpenAIClientForTest({ responses: { create } } as unknown as OpenAI);
  return create;
}

afterEach(() => __setOpenAIClientForTest(null));

/** Análise de documento longo (Jarbas, 28/10/2026) precisa de mais que os 30s padrão do client. */
describe('prazo por chamada', () => {
  it('sem timeoutMs, a chamada usa o padrão do client (nenhuma opção extra)', async () => {
    const create = clientFalso();
    await callResponses({ model: 'gpt-5.6-terra', instructions: 'i', input: 'x', maxOutputTokens: 10 }, logger);
    expect(create.mock.calls[0]).toHaveLength(2);
    expect((create.mock.calls[0] as unknown[])[1]).toBeUndefined();
  });

  it('com timeoutMs, ele vai como opção da requisição', async () => {
    const create = clientFalso();
    await callResponses({ model: 'gpt-5.6-terra', instructions: 'i', input: 'x', maxOutputTokens: 10, timeoutMs: 150_000 }, logger);
    expect((create.mock.calls[0] as unknown[])[1]).toEqual({ timeout: 150_000 });
    expect(gravarUso).not.toHaveBeenCalled(); // fora de contexto de job, nada vai ao ledger
  });
});
