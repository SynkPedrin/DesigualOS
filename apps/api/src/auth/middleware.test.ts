import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Achado real (2026-09-11, relato "o Canva tá todo travado, demora um século
 * pra deletar um projeto"): toda rota autenticada fazia DUAS consultas
 * remotas em série só pra montar `request.authUser` - `resolveOrProvisionUser`
 * (tabela users) e `loadUserAccess` (papéis + permissões). Contra o Postgres
 * do Supabase em us-east-1 são ~130ms de ida e volta MEDIDOS daqui por
 * consulta: ~260ms de pedágio fixo por request, com as 3 conexões do pool
 * (DATABASE_POOL_MAX) ocupadas o tempo todo. Um editor que autossalva a cada
 * 1,5s satura isso sozinho e joga qualquer clique do usuário pro fim da fila.
 *
 * Estes testes travam o comportamento do cache que corrigiu isso: o perfil é
 * relido do banco uma vez e reaproveitado por um tempo curto; a verificação
 * do JWT continua acontecendo em TODA request; e mudanças de papel/estado
 * invalidam na hora.
 */

const verifySupabaseToken = vi.fn();
const resolveOrProvisionUser = vi.fn();
const loadUserAccess = vi.fn();
const dbUpdateWhere = vi.fn();

vi.mock('@desigual-os/auth', () => ({
  extractBearerToken: (header: string | undefined) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined),
  hasPermission: () => true,
  verifySupabaseToken: (...args: unknown[]) => verifySupabaseToken(...args),
  resolveOrProvisionUser: (...args: unknown[]) => resolveOrProvisionUser(...args),
  loadUserAccess: (...args: unknown[]) => loadUserAccess(...args),
}));

vi.mock('@desigual-os/database', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => {
          dbUpdateWhere(...args);
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
  schema: { users: { id: 'id', lastSeenAt: 'last_seen_at' } },
}));

vi.mock('@desigual-os/logging', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

const USER = {
  id: 'user-1',
  authUserId: 'auth-1',
  email: 'chefe@desigual.com',
  name: 'Chefe',
  avatarUrl: null,
  language: 'pt-BR',
  theme: 'dark',
  dashboardWidgets: [],
  clickupEmail: null,
  active: true,
};

function fakeRequest(): FastifyRequest {
  return {
    headers: { authorization: 'Bearer token-abc' },
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const reply = {
    code: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  return reply as unknown as FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe('requireAuth', () => {
  beforeEach(async () => {
    vi.resetModules();
    verifySupabaseToken.mockReset().mockResolvedValue({ sub: 'auth-1', email: USER.email, raw: {} });
    resolveOrProvisionUser.mockReset().mockResolvedValue(USER);
    loadUserAccess.mockReset().mockResolvedValue({ roles: ['master'], permissions: [{ resource: 'studio', action: 'write' }] });
    dbUpdateWhere.mockReset();
    process.env.SUPABASE_URL = 'https://projeto.supabase.co';
  });

  it('lê o perfil do banco uma vez só e reaproveita nas requests seguintes do mesmo usuário', async () => {
    const { requireAuth } = await import('./middleware');

    for (let i = 0; i < 5; i += 1) {
      const request = fakeRequest();
      await requireAuth(request, fakeReply());
      expect(request.authUser?.id).toBe('user-1');
      expect(request.authUser?.roles).toEqual(['master']);
    }

    expect(resolveOrProvisionUser).toHaveBeenCalledTimes(1);
    expect(loadUserAccess).toHaveBeenCalledTimes(1);
  });

  it('o JWT continua sendo verificado em TODA request (o cache é do perfil, não do token)', async () => {
    const { requireAuth } = await import('./middleware');

    await requireAuth(fakeRequest(), fakeReply());
    await requireAuth(fakeRequest(), fakeReply());
    await requireAuth(fakeRequest(), fakeReply());

    expect(verifySupabaseToken).toHaveBeenCalledTimes(3);
  });

  it('token inválido é recusado com 401 mesmo depois de um acesso bem-sucedido em cache', async () => {
    const { requireAuth } = await import('./middleware');
    await requireAuth(fakeRequest(), fakeReply());

    verifySupabaseToken.mockRejectedValueOnce(new Error('jwt expired'));
    const reply = fakeReply();
    const request = fakeRequest();
    await requireAuth(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(request.authUser).toBeUndefined();
  });

  it('invalidateUserAccessCache força a releitura (mudança de papel vale na hora)', async () => {
    const { requireAuth, invalidateUserAccessCache } = await import('./middleware');
    await requireAuth(fakeRequest(), fakeReply());
    expect(loadUserAccess).toHaveBeenCalledTimes(1);

    // pelo users.id interno, que é o que as rotas de admin têm em mãos
    invalidateUserAccessCache('user-1');
    loadUserAccess.mockResolvedValue({ roles: ['colaborador'], permissions: [] });

    const request = fakeRequest();
    await requireAuth(request, fakeReply());

    expect(loadUserAccess).toHaveBeenCalledTimes(2);
    expect(request.authUser?.roles).toEqual(['colaborador']);
  });

  it('conta desativada é barrada com 403 e sai do cache', async () => {
    const { requireAuth } = await import('./middleware');
    await requireAuth(fakeRequest(), fakeReply());

    resolveOrProvisionUser.mockResolvedValue({ ...USER, active: false });
    const { invalidateUserAccessCache } = await import('./middleware');
    invalidateUserAccessCache('auth-1');

    const reply = fakeReply();
    await requireAuth(fakeRequest(), reply);
    expect(reply.code).toHaveBeenCalledWith(403);

    // e continua barrada na request seguinte (não voltou pro cache)
    const reply2 = fakeReply();
    await requireAuth(fakeRequest(), reply2);
    expect(reply2.code).toHaveBeenCalledWith(403);
  });

  it('users.last_seen_at é tocado uma vez só na janela de throttle, não a cada request', async () => {
    const { requireAuth } = await import('./middleware');

    for (let i = 0; i < 4; i += 1) {
      await requireAuth(fakeRequest(), fakeReply());
    }

    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });
});
