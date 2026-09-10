import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Bug real encontrado e corrigido em 2026-09-07: quando a conexão OAuth
 * pessoal de um usuário existe no banco mas o token dela foi revogado/
 * expirado, o código antigo confiava nela cegamente e a leitura de ClickUp
 * inteira quebrava (401 "Token invalid"), mesmo com uma API key
 * compartilhada válida disponível como fallback. Este teste trava esse
 * comportamento: token pessoal morto -> cai pra API key compartilhada.
 */

const mockConnectionRows = vi.fn<() => unknown[]>();

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockConnectionRows()),
      }),
    }),
  },
  schema: {
    integrationConnections: { userId: 'user_id', provider: 'provider' },
  },
}));

vi.mock('../lib/token-crypto', () => ({
  decryptToken: (value: string) => `decrypted:${value}`,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('resolveClickUpAccess', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    mockConnectionRows.mockReset();
    fetchMock.mockReset();
  });

  it('usa a conexão OAuth pessoal quando o token dela ainda é aceito pelo ClickUp', async () => {
    mockConnectionRows.mockReturnValue([
      { id: 'conn-1', status: 'connected', externalWorkspaceId: 'team-1', accessTokenEncrypted: 'enc-token' },
    ]);
    fetchMock.mockResolvedValue({ ok: true });
    const { resolveClickUpAccess } = await import('./access.js');

    const access = await resolveClickUpAccess('user-1');

    expect(access).toEqual({ token: 'decrypted:enc-token', teamId: 'team-1', connectionId: 'conn-1' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.clickup.com/api/v2/user', expect.objectContaining({ headers: { Authorization: 'decrypted:enc-token' } }));
  });

  it('cai pra API key compartilhada quando a conexão pessoal existe mas o ClickUp recusa o token dela', async () => {
    vi.stubEnv('CLICKUP_API_KEY', 'shared-key');
    vi.stubEnv('CLICKUP_TEAM_ID', 'shared-team');
    mockConnectionRows.mockReturnValue([
      { id: 'conn-1', status: 'connected', externalWorkspaceId: 'team-1', accessTokenEncrypted: 'enc-token-morto' },
    ]);
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const { resolveClickUpAccess } = await import('./access.js');

    const access = await resolveClickUpAccess('user-1');

    expect(access).toEqual({ token: 'shared-key', teamId: 'shared-team', connectionId: null });
  });

  it('cai pra API key compartilhada quando a checagem do token pessoal falha de rede', async () => {
    vi.stubEnv('CLICKUP_API_KEY', 'shared-key');
    vi.stubEnv('CLICKUP_TEAM_ID', 'shared-team');
    mockConnectionRows.mockReturnValue([
      { id: 'conn-1', status: 'connected', externalWorkspaceId: 'team-1', accessTokenEncrypted: 'enc-token' },
    ]);
    fetchMock.mockRejectedValue(new Error('network down'));
    const { resolveClickUpAccess } = await import('./access.js');

    const access = await resolveClickUpAccess('user-1');

    expect(access).toEqual({ token: 'shared-key', teamId: 'shared-team', connectionId: null });
  });

  it('cai pra API key compartilhada quando não existe conexão pessoal nenhuma (sem checar nada no ClickUp)', async () => {
    vi.stubEnv('CLICKUP_API_KEY', 'shared-key');
    vi.stubEnv('CLICKUP_TEAM_ID', 'shared-team');
    mockConnectionRows.mockReturnValue([]);
    const { resolveClickUpAccess } = await import('./access.js');

    const access = await resolveClickUpAccess('user-1');

    expect(access).toEqual({ token: 'shared-key', teamId: 'shared-team', connectionId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('devolve null quando não há conexão pessoal válida nem API key compartilhada configurada', async () => {
    mockConnectionRows.mockReturnValue([]);
    const { resolveClickUpAccess } = await import('./access.js');

    const access = await resolveClickUpAccess('user-1');

    expect(access).toBeNull();
  });
});
