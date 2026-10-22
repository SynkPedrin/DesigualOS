import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O botão "Enviar mensagem de teste" dos avisos internos.
 *
 * O que importa provar: só vai para quem está na lista cadastrada (gente da
 * equipe), só com permissão de escrita, passa pelo envio do Bento (que tem as
 * travas de sessão pronta e limite), a mensagem diz que é teste, e fica na
 * auditoria.
 */
const mocks = vi.hoisted(() => ({
  recipients: [] as Array<{ name: string; phone: string }>,
  enviarPeloBento: vi.fn(),
  auditar: vi.fn(async () => undefined),
  clienteExiste: true,
}));

vi.mock('@desigual-os/database', async () => {
  process.env.DATABASE_URL ??= 'postgres://t:t@127.0.0.1:1/t';
  const real = await vi.importActual<typeof import('@desigual-os/database')>('@desigual-os/database');
  const encadeavel: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(mocks.clienteExiste ? [{ id: 'cli-1' }] : []).then(ok) : () => encadeavel) },
  );
  return { ...real, db: { select: () => encadeavel } };
});

vi.mock('@desigual-os/tool-gateway', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/tool-gateway')>('@desigual-os/tool-gateway');
  return {
    ...real,
    enviarPeloBento: mocks.enviarPeloBento,
    getMediaSettings: async () => ({ values: { 'alerts.internalDelivery': { enabled: true, recipients: mocks.recipients } }, source: {} }),
  };
});

/** O papel vem do cabeçalho de teste: `x-papel: escrita | leitura`. */
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, string>; authUser?: unknown }, reply: { code(n: number): { send(b: unknown): void } }) => {
    const papel = request.headers['x-papel'];
    if (!papel) return reply.code(401).send({ error: 'Missing bearer token' });
    request.authUser = { id: `u-${papel}`, email: 'x@desigual.test', name: 'Teste', roles: ['colaborador'], permissions: [{ resource: 'clients', action: papel === 'escrita' ? 'write' : 'read' }] };
  },
  requirePermission: (resource: string, action: string) => async (request: { authUser?: { permissions: Array<{ resource: string; action: string }> } }, reply: { code(n: number): { send(b: unknown): void } }) => {
    if (!request.authUser?.permissions.some((p) => p.resource === resource && p.action === action)) reply.code(403).send({ error: `Missing permission ${resource}:${action}` });
  },
}));
vi.mock('../auth/require-module', () => ({ requireModule: () => async () => undefined }));
vi.mock('../lib/tenant-context', () => ({ requireTenant: async (request: { tenantContext?: unknown }) => void (request.tenantContext = { organizationId: 'org-1', actingAsProvider: false }) }));
vi.mock('../lib/auditoria', () => ({ auditarAcao: mocks.auditar }));

const { registerMediaRoutes } = await import('./routes');

async function servidor() {
  const app = Fastify();
  await app.register(registerMediaRoutes);
  await app.ready();
  return app;
}
const chamar = (app: Awaited<ReturnType<typeof servidor>>, papel?: string, body: object = {}) =>
  app.inject({ method: 'POST', url: '/media/settings/internal-delivery/test', payload: body, headers: papel ? { 'x-papel': papel } : {} });

afterEach(() => {
  vi.clearAllMocks();
  mocks.recipients = [];
  mocks.clienteExiste = true;
});

describe('mensagem de teste dos avisos internos', () => {
  it('sem login: 401; só leitura: 403; nada é enviado', async () => {
    const app = await servidor();
    expect((await chamar(app)).statusCode).toBe(401);
    expect((await chamar(app, 'leitura')).statusCode).toBe(403);
    expect(mocks.enviarPeloBento).not.toHaveBeenCalled();
    await app.close();
  });

  it('lista vazia: 409 explicando, e nada é enviado', async () => {
    const app = await servidor();
    const r = await chamar(app, 'escrita');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/Cadastre quem vai receber/);
    expect(mocks.enviarPeloBento).not.toHaveBeenCalled();
    await app.close();
  });

  it('envia SÓ para a lista cadastrada, com texto de teste e chave de idempotência por clique', async () => {
    mocks.recipients = [{ name: 'Pessoa Teste', phone: '5511900000001' }, { name: 'Outra Pessoa', phone: '5511900000002' }];
    mocks.enviarPeloBento.mockResolvedValue({ ok: true, messageId: 'm1' });
    const app = await servidor();
    const r = await chamar(app, 'escrita');
    expect(r.statusCode).toBe(200);
    expect(r.json().results).toEqual([{ name: 'Pessoa Teste', ok: true }, { name: 'Outra Pessoa', ok: true }]);
    const chamadas = mocks.enviarPeloBento.mock.calls.map((c) => c[0] as { phone: string; text: string; idempotencyKey: string });
    expect(chamadas.map((c) => c.phone)).toEqual(['5511900000001', '5511900000002']);
    expect(chamadas[0]!.text).toContain('Mensagem de teste');
    expect(chamadas[0]!.text).toContain('Pessoa Teste');
    expect(chamadas[0]!.text).toContain('Nada abaixo é real');
    expect(chamadas[0]!.idempotencyKey).toContain('media-internal-test:');
    expect(mocks.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'media.internal_delivery.tested', metadata: { recipients: 2, delivered: 2 } }));
    await app.close();
  });

  it('Bento desconectado: devolve o motivo por pessoa (a tela explica), sem derrubar a rota', async () => {
    mocks.recipients = [{ name: 'Pessoa Teste', phone: '5511900000001' }];
    mocks.enviarPeloBento.mockResolvedValue({ ok: false, motivo: 'sessao_nao_pronta', erro: 'O WhatsApp do Bento não está conectado agora.', repetivel: true });
    const app = await servidor();
    const r = await chamar(app, 'escrita');
    expect(r.statusCode).toBe(200);
    expect(r.json().results).toEqual([{ name: 'Pessoa Teste', ok: false, reason: 'sessao_nao_pronta', error: 'O WhatsApp do Bento não está conectado agora.' }]);
    await app.close();
  });

  it('cliente de outra empresa: 404, nada é enviado', async () => {
    mocks.recipients = [{ name: 'Pessoa Teste', phone: '5511900000001' }];
    mocks.clienteExiste = false;
    const app = await servidor();
    const r = await chamar(app, 'escrita', { client_id: '11111111-1111-4111-8111-111111111111' });
    expect(r.statusCode).toBe(404);
    expect(mocks.enviarPeloBento).not.toHaveBeenCalled();
    await app.close();
  });
});
