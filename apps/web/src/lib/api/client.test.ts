import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';

/**
 * O caso de produção de 15/10/2026: POST sem corpo saía com
 * `Content-Type: application/json` e o Fastify recusava com 400 antes de a
 * rota rodar — Sincronizar clientes/tarefas, Rodar automação agora,
 * Sincronizar Outlook e outros botões falhavam para todo mundo.
 */
describe('apiFetch e o Content-Type', () => {
  afterEach(() => vi.unstubAllGlobals());

  function capturar() {
    const chamada = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', chamada);
    return () => new Headers((chamada.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
  }

  it('POST sem corpo não manda Content-Type', async () => {
    const headers = capturar();
    await apiFetch('/pipelines/x/sincronizar-clientes', { method: 'POST' });
    expect(headers().has('Content-Type')).toBe(false);
  });

  it('com corpo JSON, manda application/json', async () => {
    const headers = capturar();
    await apiFetch('/pipelines', { method: 'POST', body: JSON.stringify({ nome: 'X' }) });
    expect(headers().get('Content-Type')).toBe('application/json');
  });

  it('upload (FormData) deixa o navegador definir o Content-Type', async () => {
    const headers = capturar();
    await apiFetch('/uploads', { method: 'POST', body: new FormData() });
    expect(headers().has('Content-Type')).toBe(false);
  });
});
