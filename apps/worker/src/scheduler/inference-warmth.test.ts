import { afterEach, describe, expect, it, vi } from 'vitest';
import { estudioOcupado } from './inference-warmth.js';

const respostaDaFila = (corpo: unknown, ok = true): Response =>
  ({ ok, json: async () => corpo }) as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('studio_busy_disables_keeper', () => {
  it('reconhece render em andamento', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaDaFila({ queue_running: [['job']], queue_pending: [] })));
    await expect(estudioOcupado('http://gpu:8188')).resolves.toBe(true);
  });

  it('reconhece render enfileirado, que também vai pegar a placa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaDaFila({ queue_running: [], queue_pending: [['job']] })));
    await expect(estudioOcupado('http://gpu:8188')).resolves.toBe(true);
  });

  it('fila vazia libera o aquecimento', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaDaFila({ queue_running: [], queue_pending: [] })));
    await expect(estudioOcupado('http://gpu:8188')).resolves.toBe(false);
  });

  it('ComfyUI fora do ar NÃO conta como ocupado: silêncio desligaria o keeper pra sempre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(estudioOcupado('http://gpu:8188')).resolves.toBe(false);
  });

  it('resposta sem os campos esperados também não vira "ocupado" por acidente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaDaFila({ outra_coisa: 1 })));
    await expect(estudioOcupado('http://gpu:8188')).resolves.toBe(false);
  });
});
