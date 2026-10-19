import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §47-A aplicado à API: com o Motion Engine desligado, TODA rota /motion
 * responde 404 com explicação — e nenhuma delas toca o banco, o Claude Code
 * ou a fila.
 *
 * O 404 é deliberado e diferente de "rota não existe": o corpo diz o motivo,
 * porque "rota inexistente" e "recurso desligado" mandam quem está depurando
 * procurar em lugares opostos.
 */
const mocks = vi.hoisted(() => ({
  ottoMotionEnabled: vi.fn(() => false),
  checkClaudeConnection: vi.fn(),
  checkChatGptConnection: vi.fn(),
  probeOpusModel: vi.fn(),
  getMotionStatus: vi.fn(),
  updateMotion: vi.fn(),
  renderMotionAgain: vi.fn(),
  select: vi.fn(),
  hasClientAccess: vi.fn(async () => true),
}));

vi.mock('@desigual-os/otto-motion', async () => {
  const real = await vi.importActual<typeof import('@desigual-os/otto-motion')>('@desigual-os/otto-motion');
  return { ...real, ...mocks };
});

vi.mock('@desigual-os/database', () => ({
  db: { select: mocks.select },
  schema: { motionSessions: { id: 'id', clientId: 'client_id' } },
}));

vi.mock('../lib/access', () => ({ hasClientAccess: mocks.hasClientAccess }));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', email: 'quem@agencia.com', role: 'member' };
  },
}));

const { registerMotionRoutes } = await import('./routes');

async function servidor() {
  const app = Fastify();
  await app.register(registerMotionRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.ottoMotionEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('A — Motion Engine desligado', () => {
  it.each([
    ['GET', '/motion/abc'],
    ['GET', '/motion/providers'],
    ['POST', '/motion/abc/render'],
    ['POST', '/motion/providers/claude/test'],
  ])('%s %s responde 404 explicado', async (method, url) => {
    const app = await servidor();
    const response = await app.inject({ method: method as 'GET' | 'POST', url });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('OTTO_MOTION_ENABLED');
    await app.close();
  });

  it('desligado, nenhuma rota consulta o banco nem o provider', async () => {
    const app = await servidor();
    await app.inject({ method: 'GET', url: '/motion/abc' });
    await app.inject({ method: 'GET', url: '/motion/providers' });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.checkClaudeConnection).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('ligado', () => {
  beforeEach(() => {
    mocks.ottoMotionEnabled.mockReturnValue(true);
  });

  it('GET /motion/providers devolve os dois providers', async () => {
    mocks.checkClaudeConnection.mockResolvedValue({ provider: 'claude', state: 'CONNECTED', motionCapable: true });
    mocks.checkChatGptConnection.mockReturnValue({ provider: 'chatgpt', state: 'DISCONNECTED', motionCapable: false });
    const app = await servidor();
    const response = await app.inject({ method: 'GET', url: '/motion/providers' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { providers: { provider: string; motionCapable: boolean }[] };
    expect(body.providers.map((p) => p.provider)).toEqual(['claude', 'chatgpt']);
    // §9 — nem conectado o ChatGPT vira capaz de gerar motion.
    expect(body.providers.find((p) => p.provider === 'chatgpt')?.motionCapable).toBe(false);
    await app.close();
  });

  it('motion inexistente devolve 404 sem vazar nada', async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    const app = await servidor();
    const response = await app.inject({ method: 'GET', url: '/motion/nao-existe' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('sem acesso ao cliente, 403 — e o status NÃO é consultado', async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ clientId: 'cli-1' }] }) }) });
    mocks.hasClientAccess.mockResolvedValue(false);
    const app = await servidor();
    const response = await app.inject({ method: 'GET', url: '/motion/abc' });
    expect(response.statusCode).toBe(403);
    expect(mocks.getMotionStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it('com acesso, devolve o status', async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ clientId: 'cli-1' }] }) }) });
    mocks.hasClientAccess.mockResolvedValue(true);
    mocks.getMotionStatus.mockResolvedValue({ motionId: 'abc', status: 'completed', stage: 'Pronto' });
    const app = await servidor();
    const response = await app.inject({ method: 'GET', url: '/motion/abc' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ motionId: 'abc', status: 'completed' });
    await app.close();
  });

  it('Opus indisponível no update vira 503, não 500 — é indisponibilidade, não bug', async () => {
    const { MotionModelUnavailableError } = await import('@desigual-os/otto-motion');
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ clientId: 'cli-1' }] }) }) });
    mocks.hasClientAccess.mockResolvedValue(true);
    mocks.updateMotion.mockRejectedValue(new MotionModelUnavailableError('CLI velha'));
    const app = await servidor();
    const response = await app.inject({
      method: 'POST',
      url: '/motion/abc/update',
      payload: { instruction: 'deixa o CTA entrar antes' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('OPUS_UNAVAILABLE');
    // A mensagem é apresentável, sem stack.
    expect(response.json().error).not.toContain('at ');
    await app.close();
  });
});
