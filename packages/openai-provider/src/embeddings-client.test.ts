/**
 * embeddings-client.test.ts — contrato do cliente de embeddings com client
 * OpenAI FAKE injetado (regra do repo: zero custo OpenAI em teste). Cobre o
 * que diferencia este módulo do responses-client: falha NUNCA lança, devolve
 * null — embedding é enriquecimento, quem degrada é o chamador.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';

vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  __setEmbeddingsClientForTest,
  embedBatch,
  embedText,
} from './embeddings-client';

const create = vi.fn();
const fakeClient = { embeddings: { create } } as unknown as OpenAI;

beforeEach(() => {
  create.mockReset();
  __setEmbeddingsClientForTest(fakeClient);
});

afterEach(() => {
  __setEmbeddingsClientForTest(null);
});

describe('embedBatch', () => {
  it('1 request por lote, com modelo e dimensões do módulo', async () => {
    create.mockResolvedValue({
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 1, embedding: [0, 1] },
      ],
    });
    const out = await embedBatch(['texto a', 'texto b']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: ['texto a', 'texto b'],
      dimensions: EMBEDDING_DIMENSIONS,
    });
    expect(out).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('ordena pela chave `index` da resposta, não pela ordem de chegada', async () => {
    create.mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    const out = await embedBatch(['a', 'b']);
    expect(out).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('lote vazio => [] sem bater na API', async () => {
    expect(await embedBatch([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('falha da API => null, nunca lança', async () => {
    create.mockRejectedValue(new Error('429 quota'));
    await expect(embedBatch(['x'])).resolves.toBeNull();
  });

  it('resposta incompleta (menos vetores que inputs) => null', async () => {
    create.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
    await expect(embedBatch(['a', 'b'])).resolves.toBeNull();
  });
});

describe('embedText', () => {
  it('devolve o vetor do texto', async () => {
    create.mockResolvedValue({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
    expect(await embedText('oi')).toEqual([0.1, 0.2]);
  });

  it('falha => null', async () => {
    create.mockRejectedValue(new Error('network'));
    await expect(embedText('oi')).resolves.toBeNull();
  });

  it('sem credencial configurada => null, nunca lança', async () => {
    __setEmbeddingsClientForTest(null);
    const salva = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(embedText('oi')).resolves.toBeNull();
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (salva !== undefined) process.env.OPENAI_API_KEY = salva;
    }
  });
});
