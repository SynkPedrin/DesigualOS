import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenwaGatewayClient } from './openwa-gateway';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }));
  return calls;
}

describe('OpenwaGatewayClient', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('cria sessão e chave operator restrita ao UUID da sessão', async () => {
    const calls = stub((url) => url.endsWith('/api/sessions')
      ? json({ id: 'session-uuid', name: 'desigual-test', status: 'created', engineLoaded: false }, 201)
      : json({ id: 'key-id', apiKey: 'owa_k1_scoped' }, 201));
    const admin = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'admin' });
    const session = await admin.createSession('desigual-test');
    const key = await admin.createScopedOperatorKey('desigual-test', session.id);

    expect(key.apiKey).toBe('owa_k1_scoped');
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ name: 'desigual-test' });
    expect(JSON.parse(String(calls[1]!.init?.body))).toMatchObject({ role: 'operator', allowedSessions: ['session-uuid'] });
    expect(calls.every((call) => (call.init?.headers as Record<string, string>)['X-API-Key'] === 'admin')).toBe(true);
  });

  it('inicia a sessão e devolve somente QR PNG real fornecido pelo OpenWA', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const calls = stub((url) => url.endsWith('/start')
      ? json({ id: 's1', name: 's1', status: 'initializing', engineLoaded: true })
      : json({ qrCode: png, status: 'qr_ready' }));
    const client = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'scoped', sessionId: 's1' });
    await client.startSession();
    await expect(client.getQr()).resolves.toEqual({ qrCode: png, status: 'qr_ready' });
    expect(calls.map((call) => call.url)).toEqual([
      'http://openwa.local/api/sessions/s1/start',
      'http://openwa.local/api/sessions/s1/qr',
    ]);
  });

  it('rejeita QR que não seja um data URL PNG', async () => {
    stub(() => json({ qrCode: '2@conteudo-cru', status: 'qr_ready' }));
    const client = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'scoped', sessionId: 's1' });
    await expect(client.getQr()).rejects.toMatchObject({ code: 'INVALID_QR' });
  });

  it('importa histórico nas duas direções e preserva timestamps e autores', async () => {
    stub(() => json([
      { id: 'in-1', chatId: '123@g.us', author: '5511@c.us', body: 'Recebida', type: 'text', timestamp: 100, fromMe: false, isGroup: true, kind: 'group' },
      { id: 'out-1', chatId: '123@g.us', body: 'Enviada', type: 'text', timestamp: 101, fromMe: true, isGroup: true, kind: 'group' },
    ]));
    const client = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'scoped', sessionId: 's1' });
    const messages = await client.history('123@g.us', 10);
    expect(messages.map((message) => message.direction)).toEqual(['incoming', 'outgoing']);
    expect(messages.map((message) => message.timestamp)).toEqual([100, 101]);
    expect(messages[0]?.author).toBe('5511@c.us');
  });

  it('usa o histórico persistido como fallback quando o engine não oferece histórico ao vivo', async () => {
    let index = 0;
    stub(() => {
      index += 1;
      return index === 1
        ? json({ message: 'Not implemented' }, 501)
        : json({ messages: [{ waMessageId: 'new', chatId: '55@c.us', direction: 'outgoing', timestamp: 200 }, { waMessageId: 'old', chatId: '55@c.us', direction: 'incoming', timestamp: 100 }] });
    });
    const client = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'scoped', sessionId: 's1' });
    const messages = await client.history('55@c.us', 10);
    expect(messages.map((message) => message.id)).toEqual(['old', 'new']);
  });

  it('registra webhook assinado com eventos de mensagens e sessão, sem QR no payload', async () => {
    const calls = stub(() => json({ id: 'hook-1' }, 201));
    const client = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'scoped', sessionId: 's1' });
    await client.createWebhook({ url: 'https://api.example.com/openwa/webhook', secret: 'secret-long-enough' });
    const body = JSON.parse(String(calls[0]!.init?.body)) as { secret: string; events: string[]; retryCount: number };
    expect(body.secret).toBe('secret-long-enough');
    expect(body.events).toContain('message.received');
    expect(body.events).toContain('message.sent');
    expect(body.events).toContain('session.authenticated');
    expect(body.events).not.toContain('session.qr');
    expect(body.retryCount).toBe(5);
  });

  it('baixa mídia respeitando o limite de bytes', async () => {
    stub(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/ogg' } }));
    const client = new OpenwaGatewayClient({ baseUrl: 'http://openwa.local', apiKey: 'scoped', sessionId: 's1' });
    const media = await client.downloadMedia('55@c.us', 'message-1', 3);
    expect([...media.bytes]).toEqual([1, 2, 3]);
    expect(media.mimetype).toBe('audio/ogg');
  });
});
