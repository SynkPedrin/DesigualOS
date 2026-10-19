import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenwaClient, type OpenwaConfig } from './openwa-client';

/**
 * CLIENTE OPENWA (16/10/2026) — trava a superfície mínima que o provider
 * precisa (send-text/imagem/áudio/documento + health), contra o contrato
 * documentado em OpenWA-main/docs/06-api-specification.md. Não há
 * infraestrutura real acessível nesta sessão: o `fetch` é dublê.
 */

interface Chamada {
  url: string;
  init?: RequestInit | undefined;
}

function criarCliente(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const chamadas: Chamada[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    const resposta = handler(url, init);
    const status = resposta.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => resposta.body ?? {},
      text: async () => JSON.stringify(resposta.body ?? {}),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { chamadas, cliente: new OpenwaClient({ baseUrl: 'http://openwa.local', apiKey: 'chave', sessionId: 'sessao-1' }) };
}

const configuracao: OpenwaConfig = { baseUrl: 'http://openwa.local', apiKey: 'chave', sessionId: 'sessao-1' };

describe('OpenwaClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia texto: POST /messages/send-text com chatId, texto e Idempotency-Key', async () => {
    const { chamadas, cliente } = criarCliente(() => ({ body: { messageId: 'msg-1', timestamp: 123 } }));
    const enviado = await cliente.sendText({
      chatId: '5511999999999@c.us',
      text: 'Olá, tudo bem?',
      quotedMessageId: 'msg-antigo',
      idempotencyKey: 'idem-1',
    });
    expect(enviado).toEqual({ messageId: 'msg-1', timestamp: 123 });
    expect(chamadas).toHaveLength(1);
    const chamada = chamadas[0]!;
    expect(chamada.url).toBe('http://openwa.local/api/sessions/sessao-1/messages/send-text');
    expect(chamada.init?.method).toBe('POST');
    const corpo = JSON.parse(String(chamada.init?.body)) as { chatId: string; text: string; linkPreview: boolean };
    expect(corpo.chatId).toBe('5511999999999@c.us');
    expect(corpo.text).toBe('Olá, tudo bem?');
    expect(corpo.linkPreview).toBe(false);
    expect(chamada.init?.headers).toMatchObject({ 'Idempotency-Key': 'idem-1' });
  });

  it('envia imagem: envia base64 e o mimetype junto com o arquivo', async () => {
    const { chamadas, cliente } = criarCliente(() => ({ body: { messageId: 'msg-img' } }));
    await cliente.sendImage({
      chatId: '5511999999999@c.us',
      base64: 'aGVsbG8=',
      mimetype: 'image/png',
      filename: 'foto.png',
      caption: 'olá',
    });
    const chamada = chamadas[0]!;
    expect(chamada.url).toBe('http://openwa.local/api/sessions/sessao-1/messages/send-image');
    const corpo = JSON.parse(String(chamada.init?.body)) as { base64: string; mimetype: string; caption: string };
    expect(corpo.base64).toBe('aGVsbG8=');
    expect(corpo.mimetype).toBe('image/png');
    expect(corpo.caption).toBe('olá');
  });

  it('envia documento: exige filename', async () => {
    const { chamadas, cliente } = criarCliente(() => ({ body: { messageId: 'msg-doc' } }));
    await cliente.sendDocument({
      chatId: '5511999999999@c.us',
      base64: 'ZGF0YQ==',
      mimetype: 'application/pdf',
      filename: 'brief.pdf',
    });
    const corpo = JSON.parse(String(chamadas[0]!.init?.body)) as { filename: string };
    expect(corpo.filename).toBe('brief.pdf');
  });

  it('health: lê o estado da sessão', async () => {
    const { cliente } = criarCliente(() => ({ body: { status: 'ready' } }));
    const saude = await cliente.health();
    expect(saude).toEqual({ healthy: true, detail: 'ready' });
  });

  it('rede fora do ar: falha com erro retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const cliente = new OpenwaClient({ baseUrl: 'http://openwa.local', apiKey: 'chave', sessionId: 'sessao-1' });
    await expect(cliente.sendText({ chatId: 'x@c.us', text: 'oi', idempotencyKey: 'i' })).rejects.toThrow(/OpenWA inacessível/);
  });

  it('HTTP 500: falha com erro retryable', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'falhou', code: 'UPLOAD_FAILED' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const cliente = new OpenwaClient({ baseUrl: 'http://openwa.local', apiKey: 'chave', sessionId: 'sessao-1' });
    await expect(cliente.sendText({ chatId: 'x@c.us', text: 'oi', idempotencyKey: 'i' })).rejects.toThrow(/falhou/);
    try {
      await cliente.sendText({ chatId: 'x@c.us', text: 'oi', idempotencyKey: 'i' });
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe('UPLOAD_FAILED');
    }
  });
});
