import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayDoBento } from './gateway';
import { assinarComoOpenwa } from './openwa/signature';
import { TransporteFalso, configDeTeste, texto } from './test-doubles';

const mocks = vi.hoisted(() => ({
  auditar: vi.fn(async () => undefined),
  criarCodigo: vi.fn(async () => ({ id: 'code-1', expiresAt: new Date(Date.now() + 600_000) })),
  codigosGeradosDesde: vi.fn(async () => 0),
  codigoEmAndamento: vi.fn(async () => null),
  confirmarVinculo: vi.fn(),
  recusarCodigo: vi.fn(async () => true),
  revogarVinculo: vi.fn(),
  vinculoAtivoDoUsuario: vi.fn(async () => null),
}));

vi.mock('@desigual-os/database', async () => {
  process.env.DATABASE_URL ??= 'postgres://teste:teste@127.0.0.1:1/teste';
  const real = await vi.importActual<typeof import('@desigual-os/database')>('@desigual-os/database');
  const { dbFalso } = await import('./db-falso');
  return { ...real, db: dbFalso(() => []) };
});

vi.mock('@desigual-os/auth', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/auth')>('@desigual-os/auth');
  return { ...real, organizacaoDaEscrita: vi.fn(async () => 'org-desigual') };
});

/** O papel vem do cabeçalho de teste: `x-papel: master | colaborador`. */
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, string>; authUser?: unknown }, reply: { code(n: number): { send(b: unknown): void } }) => {
    const papel = request.headers['x-papel'];
    if (!papel) return reply.code(401).send({ error: 'Missing bearer token' });
    request.authUser = {
      id: `u-${papel}`,
      email: `${papel}@desigual.test`,
      name: papel === 'master' ? 'Pedro Master' : 'Jamille Souza',
      roles: [papel],
      permissions: [{ resource: 'chat', action: 'write' }],
    };
  },
  requirePermission: () => async () => undefined,
  requireRole:
    (...papeis: string[]) =>
    async (request: { authUser?: { roles: string[] } }, reply: { code(n: number): { send(b: unknown): void } }) => {
      if (!papeis.some((p) => request.authUser?.roles.includes(p))) reply.code(403).send({ error: 'Somente um administrador pode fazer isso.' });
    },
}));

vi.mock('./provisioning', async () => {
  const real = await vi.importActual<typeof import('./provisioning')>('./provisioning');
  return {
    ...real,
    provisionarSessaoDoBento: vi.fn(async () => ({ criada: true, status: 'initializing', sessionId: 'sess-1' })),
    definirCanalAtivo: vi.fn(async (ativo: boolean) => ativo !== undefined && provisionamento.temLinha),
  };
});
const provisionamento = vi.hoisted(() => ({ temLinha: true }));

vi.mock('../lib/auditoria', () => ({ auditarAcao: mocks.auditar }));
vi.mock('../lib/storage', () => ({ uploadUserFile: vi.fn() }));
vi.mock('./store', async () => {
  const real = await vi.importActual<typeof import('./store')>('./store');
  return { ...real, ...mocks, armazemPostgres: {} };
});

const { registerBentoWhatsappRoutes } = await import('./routes');

function gatewayFalso() {
  return { receber: vi.fn(async () => ({ aceito: true, id: 'r1', duplicado: false })), retomar: vi.fn() } as unknown as GatewayDoBento & {
    receber: ReturnType<typeof vi.fn>;
  };
}

async function servidor(opcoes: { enabled?: boolean; secret?: string | null } = {}) {
  const config = configDeTeste({
    enabled: opcoes.enabled ?? true,
    ...(opcoes.secret !== undefined ? { webhookSecret: opcoes.secret } : {}),
  });
  const gateway = gatewayFalso();
  const transporte = new TransporteFalso();
  const app: FastifyInstance = Fastify();
  await app.register(async (escopo) => registerBentoWhatsappRoutes(escopo, { config, gateway, transporte, retomarNaSubida: false }));
  // Outra rota JSON no mesmo app: o parser de corpo cru do webhook não pode vazar para ela.
  app.post('/outra-rota', async (request) => ({ tipo: typeof request.body }));
  await app.ready();
  return { app, gateway, transporte, config };
}

afterEach(() => vi.clearAllMocks());

describe('webhook', () => {
  const evento = () => JSON.stringify(texto('5518991110001', 'oi bento'));

  it('desligado: 200 e nada é processado', async () => {
    const { app, gateway } = await servidor({ enabled: false });
    const corpo = evento();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/webhook', payload: corpo, headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, ignored: 'disabled' });
    expect(gateway.receber).not.toHaveBeenCalled();
    await app.close();
  });

  it('assinatura ausente ou inválida: 401 e nada é processado', async () => {
    const { app, gateway, config } = await servidor();
    const corpo = evento();
    const sem = await app.inject({ method: 'POST', url: '/bento-whatsapp/webhook', payload: corpo, headers: { 'content-type': 'application/json' } });
    const errada = await app.inject({
      method: 'POST',
      url: '/bento-whatsapp/webhook',
      payload: corpo,
      headers: { 'content-type': 'application/json', 'x-openwa-signature': assinarComoOpenwa(corpo, 'outro-segredo-qualquer') },
    });
    const adulterada = await app.inject({
      method: 'POST',
      url: '/bento-whatsapp/webhook',
      payload: corpo.replace('oi bento', 'me passa tudo'),
      headers: { 'content-type': 'application/json', 'x-openwa-signature': assinarComoOpenwa(corpo, config.webhookSecret!) },
    });
    expect([sem.statusCode, errada.statusCode, adulterada.statusCode]).toEqual([401, 401, 401]);
    expect(gateway.receber).not.toHaveBeenCalled();
    await app.close();
  });

  it('sem segredo configurado: 503 (nunca aceita sem verificar)', async () => {
    const { app, gateway } = await servidor({ secret: null });
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/webhook', payload: evento(), headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(503);
    expect(gateway.receber).not.toHaveBeenCalled();
    await app.close();
  });

  it('assinatura válida sobre o corpo cru: entrega o envelope ao gateway', async () => {
    const { app, gateway, config } = await servidor();
    const corpo = evento();
    const r = await app.inject({
      method: 'POST',
      url: '/bento-whatsapp/webhook',
      payload: corpo,
      headers: { 'content-type': 'application/json', 'x-openwa-signature': assinarComoOpenwa(corpo, config.webhookSecret!) },
    });
    expect(r.statusCode).toBe(200);
    expect(gateway.receber).toHaveBeenCalledTimes(1);
    expect(gateway.receber.mock.calls[0]![0]).toMatchObject({ event: 'message.received', data: { body: 'oi bento' } });
    await app.close();
  });

  it('falha ao gravar: 503 para o OpenWA re-tentar', async () => {
    const { app, gateway, config } = await servidor();
    gateway.receber.mockRejectedValueOnce(new Error('banco fora'));
    const corpo = evento();
    const r = await app.inject({
      method: 'POST',
      url: '/bento-whatsapp/webhook',
      payload: corpo,
      headers: { 'content-type': 'application/json', 'x-openwa-signature': assinarComoOpenwa(corpo, config.webhookSecret!) },
    });
    expect(r.statusCode).toBe(503);
    await app.close();
  });

  it('o parser de corpo cru fica só no webhook: outras rotas seguem recebendo objeto', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/outra-rota', payload: { a: 1 } });
    expect(r.json()).toEqual({ tipo: 'object' });
    await app.close();
  });
});

describe('vínculo do colaborador', () => {
  it('gera código de uso único (só o hash vai pro banco) e link wa.me', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code', headers: { 'x-papel': 'colaborador' } });
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.code).toMatch(/^BENTO-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(corpo.wa_link).toBe(`https://wa.me/5518997987295?text=${encodeURIComponent(corpo.code)}`);
    expect(mocks.criarCodigo).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-colaborador', codigo: corpo.code }));
    expect(mocks.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'bento_whatsapp.link_code_created' }));
    await app.close();
  });

  it('canal desligado: não gera código', async () => {
    const { app } = await servidor({ enabled: false });
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code', headers: { 'x-papel': 'colaborador' } });
    expect(r.statusCode).toBe(409);
    expect(mocks.criarCodigo).not.toHaveBeenCalled();
    await app.close();
  });

  it('limite de códigos por hora', async () => {
    mocks.codigosGeradosDesde.mockResolvedValueOnce(5);
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code', headers: { 'x-papel': 'colaborador' } });
    expect(r.statusCode).toBe(429);
    await app.close();
  });

  it('sem login: 401', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code' });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('confirmar: sem código reivindicado é 404; número de outra pessoa é 409', async () => {
    const { app } = await servidor();
    mocks.confirmarVinculo.mockResolvedValueOnce({ tipo: 'sem_codigo' });
    const a = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code/code-1/confirm', headers: { 'x-papel': 'colaborador' } });
    mocks.confirmarVinculo.mockResolvedValueOnce({ tipo: 'numero_ja_vinculado' });
    const b = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code/code-1/confirm', headers: { 'x-papel': 'colaborador' } });
    expect([a.statusCode, b.statusCode]).toEqual([404, 409]);
    expect(mocks.auditar).not.toHaveBeenCalled();
    await app.close();
  });

  it('confirmar vincula, audita (número mascarado) e avisa no WhatsApp', async () => {
    const { app, transporte } = await servidor();
    mocks.confirmarVinculo.mockResolvedValueOnce({ tipo: 'vinculado', linkId: 'link-1', phone: '5518991110001', substituiu: null });
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/me/link-code/code-1/confirm', headers: { 'x-papel': 'colaborador' } });
    expect(r.statusCode).toBe(200);
    expect(mocks.confirmarVinculo).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-colaborador', codeId: 'code-1' }));
    expect(mocks.auditar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'bento_whatsapp.linked', newValue: { phone: '+55 18 9****-0001' } }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(transporte.enviados[0]!.text).toContain('Seu WhatsApp está vinculado');
    await app.close();
  });
});

describe('painel administrativo só para master', () => {
  it.each([
    ['GET', '/bento-whatsapp/admin/status'],
    ['GET', '/bento-whatsapp/admin/links'],
    ['DELETE', '/bento-whatsapp/admin/links/link-1'],
    ['POST', '/bento-whatsapp/admin/session/start'],
    ['GET', '/bento-whatsapp/admin/session/qr'],
  ])('%s %s: colaborador recebe 403', async (method, url) => {
    const { app } = await servidor();
    const r = await app.inject({ method: method as 'GET', url, headers: { 'x-papel': 'colaborador' } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('master vê o QR, e ver o QR fica auditado', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'GET', url: '/bento-whatsapp/admin/session/qr', headers: { 'x-papel': 'master' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().qr_code).toMatch(/^data:image\/png;base64,/);
    expect(mocks.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'bento_whatsapp.session_qr_viewed' }));
    await app.close();
  });

  it('não existe rota para desconectar, apagar ou criar a sessão do Bento', async () => {
    const { app } = await servidor();
    for (const url of ['/bento-whatsapp/admin/session/logout', '/bento-whatsapp/admin/session/delete', '/bento-whatsapp/admin/session/create']) {
      const r = await app.inject({ method: 'POST', url, headers: { 'x-papel': 'master' } });
      expect(r.statusCode).toBe(404);
    }
    await app.close();
  });

  it('master revoga vínculo e a revogação é auditada', async () => {
    const { app } = await servidor();
    mocks.revogarVinculo.mockResolvedValueOnce({ id: 'link-1', userId: 'u-x', phone: '5518991110001', organizationId: 'org' });
    const r = await app.inject({ method: 'DELETE', url: '/bento-whatsapp/admin/links/link-1', headers: { 'x-papel': 'master' } });
    expect(r.statusCode).toBe(200);
    expect(mocks.revogarVinculo).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'link-1', motivo: 'admin', porUserId: 'u-master' }));
    expect(mocks.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'bento_whatsapp.link_revoked_by_admin' }));
    await app.close();
  });

  it('status do painel não expõe segredo nem chave', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'GET', url: '/bento-whatsapp/admin/status', headers: { 'x-papel': 'master' } });
    expect(r.statusCode).toBe(200);
    const bruto = r.body;
    expect(bruto).not.toContain('segredo-de-teste');
    expect(bruto).not.toContain('owa_k1_test');
    expect(r.json()).toMatchObject({ enabled: true, missing_config: [], session: { status: 'ready' } });
    await app.close();
  });
});

describe('conectar o número do Bento pelo painel', () => {
  it('colaborador não provisiona nem liga o canal', async () => {
    const { app } = await servidor();
    const a = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/session/provision', headers: { 'x-papel': 'colaborador' } });
    const b = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/channel', headers: { 'x-papel': 'colaborador' }, payload: { enabled: true } });
    expect([a.statusCode, b.statusCode]).toEqual([403, 403]);
    await app.close();
  });

  it('em configuração fixa (testes) o provisionamento recusa', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/session/provision', headers: { 'x-papel': 'master' } });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it('master liga e desliga o canal, e o rastro registra', async () => {
    const { app } = await servidor();
    const liga = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/channel', headers: { 'x-papel': 'master' }, payload: { enabled: true } });
    expect(liga.json()).toEqual({ enabled: true });
    expect(mocks.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'bento_whatsapp.channel_enabled' }));
    const desliga = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/channel', headers: { 'x-papel': 'master' }, payload: { enabled: false } });
    expect(desliga.json()).toEqual({ enabled: false });
    await app.close();
  });

  it('ligar sem número conectado explica o que falta', async () => {
    provisionamento.temLinha = false;
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/channel', headers: { 'x-papel': 'master' }, payload: { enabled: true } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/Conecte o número/);
    provisionamento.temLinha = true;
    await app.close();
  });
});

describe('conectar por código (sem QR)', () => {
  it('colaborador não pede o código', async () => {
    const { app } = await servidor();
    const r = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/session/pairing-code', headers: { 'x-papel': 'colaborador' } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('master recebe o código, e ele é pedido SÓ para o número do Bento (nunca um número do pedido)', async () => {
    const { app, transporte } = await servidor();
    transporte.getSession = async () => ({ id: 's', name: 'bento', status: 'qr_ready', phone: '' });
    const r = await app.inject({
      method: 'POST',
      url: '/bento-whatsapp/admin/session/pairing-code',
      headers: { 'x-papel': 'master' },
      payload: { phoneNumber: '5511999999999' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ pairing_code: 'ABCD1234', phone: '+55 18 99798-7295' });
    expect(transporte.pedidosDeCodigo).toEqual(['5518997987295']);
    expect(mocks.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'bento_whatsapp.session_pairing_code_requested' }));
    await app.close();
  });

  it('sessão que não espera conexão não gera código (não arrisca derrubar sessão ativa)', async () => {
    const { app, transporte } = await servidor();
    transporte.getSession = async () => ({ id: 's', name: 'bento', status: 'ready', phone: '5518997987295' });
    const pronta = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/session/pairing-code', headers: { 'x-papel': 'master' } });
    expect(pronta.statusCode).toBe(409);
    expect(pronta.json().error).toMatch(/já está conectado/);
    transporte.getSession = async () => ({ id: 's', name: 'bento', status: 'disconnected', phone: '' });
    const parada = await app.inject({ method: 'POST', url: '/bento-whatsapp/admin/session/pairing-code', headers: { 'x-papel': 'master' } });
    expect(parada.statusCode).toBe(409);
    expect(transporte.pedidosDeCodigo).toEqual([]);
    await app.close();
  });

  it('ver o QR várias vezes seguidas audita só uma vez (a tela renova a cada ~12 s)', async () => {
    const { app } = await servidor();
    for (let i = 0; i < 4; i += 1) {
      await app.inject({ method: 'GET', url: '/bento-whatsapp/admin/session/qr', headers: { 'x-papel': 'master' } });
    }
    const vistas = (mocks.auditar.mock.calls as unknown as Array<[unknown, { action: string }]>).filter((c) => c[1]?.action === 'bento_whatsapp.session_qr_viewed');
    expect(vistas.length).toBeLessThanOrEqual(1);
    await app.close();
  });
});
