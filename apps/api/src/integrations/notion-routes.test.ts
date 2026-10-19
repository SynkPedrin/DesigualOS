import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type * as ToolGateway from '@desigual-os/tool-gateway';

/**
 * A INTEGRAÇÃO DO NOTION existia inteira — OAuth, token cifrado por pessoa,
 * destinos, `@notion` no chat — e não funcionava por um motivo que nenhuma
 * linha de código revelava: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` e
 * `NOTION_REDIRECT_URI` nunca foram preenchidos no servidor. O produto dizia
 * "Fale com o Admin" para o próprio admin, e parava aí.
 *
 * O que esta suíte trava são os três estados que decidem se a pessoa consegue
 * sair do lugar: sem credencial (e QUAL falta), com credencial mas com
 * endereço de retorno morto (a armadilha que derrubou o ClickUp em
 * 07/10/2026), e tudo certo.
 */

let linhasDeConexao: unknown[];

vi.mock('@desigual-os/database', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(linhasDeConexao) }) }),
    }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  },
  schema: {
    integrationConnections: {
      userId: 'user_id',
      provider: 'provider',
      accessTokenEncrypted: 'access_token_encrypted',
      status: 'status',
      externalWorkspaceName: 'external_workspace_name',
      updatedAt: 'updated_at',
    },
    auditLogs: { id: 'id' },
  },
}));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-1', roles: ['master'], permissions: [] };
  },
}));

vi.mock('../lib/token-crypto', () => ({
  encryptToken: (v: string) => `enc:${v}`,
  decryptToken: (v: string) => v.replace(/^enc:/, ''),
}));

vi.mock('./routes', () => ({
  buildOAuthState: () => 'state-assinado',
  parseOAuthState: () => ({ userId: 'user-1' }),
  frontendUrl: (p: string) => `http://localhost:3000${p}`,
}));

const listarDestinosNotion = vi.fn();
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => {
  const real = await importOriginal<typeof ToolGateway>();
  return { ...real, listarDestinosNotion, exchangeNotionCode: vi.fn() };
});

const { registerNotionRoutes } = await import('./notion-routes');

async function buildApp() {
  const app = Fastify();
  await registerNotionRoutes(app);
  return app;
}

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  linhasDeConexao = [];
  listarDestinosNotion.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function credenciaisCompletas(redirect = 'http://localhost:3001/integrations/notion/callback') {
  vi.stubEnv('NOTION_CLIENT_ID', 'id-publico');
  vi.stubEnv('NOTION_CLIENT_SECRET', 'segredo');
  vi.stubEnv('NOTION_REDIRECT_URI', redirect);
}

describe('GET /integrations/notion/status — diz o que falta, não só que falta', () => {
  it('sem credencial nenhuma: nomeia as três variáveis', async () => {
    vi.stubEnv('NOTION_CLIENT_ID', '');
    vi.stubEnv('NOTION_CLIENT_SECRET', '');
    vi.stubEnv('NOTION_REDIRECT_URI', '');

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      connected: false,
      configured: false,
      missing_env: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET', 'NOTION_REDIRECT_URI'],
    });
  });

  /** Meio configurado é o caso que mais custa tempo: a tela precisa apontar a
   *  peça que falta, não repetir a lista inteira. */
  it('só o redirect faltando: nomeia só ele', async () => {
    vi.stubEnv('NOTION_CLIENT_ID', 'id-publico');
    vi.stubEnv('NOTION_CLIENT_SECRET', 'segredo');
    vi.stubEnv('NOTION_REDIRECT_URI', '');

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/status' });

    expect(res.json().missing_env).toEqual(['NOTION_REDIRECT_URI']);
  });

  it('conectado: devolve workspace e destinos liberados', async () => {
    credenciaisCompletas();
    linhasDeConexao = [
      {
        status: 'connected',
        workspaceName: 'Desigual',
        accessTokenEncrypted: 'enc:ntn_token',
        // O mock do banco devolve a linha crua; a rota lê a PROJEÇÃO do
        // select (`token`), por isso a fixture carrega os dois nomes.
        token: 'enc:ntn_token',
        updatedAt: new Date('2026-10-07T00:00:00Z'),
      },
    ];
    listarDestinosNotion.mockResolvedValue([{ id: 'pag-1', title: 'Briefings' }]);

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/status' });

    expect(res.json()).toMatchObject({
      connected: true,
      configured: true,
      workspace_name: 'Desigual',
      destinos: [{ id: 'pag-1', title: 'Briefings' }],
    });
  });

  /**
   * Conectar sem liberar página nenhuma é o erro silencioso desta integração:
   * o Notion aceita, e o primeiro `@notion` falha sem explicação. A lista
   * vazia é o que faz a tela avisar antes disso.
   */
  it('conectado sem liberar página: destinos vazio, não erro', async () => {
    credenciaisCompletas();
    linhasDeConexao = [
      { status: 'connected', workspaceName: 'Desigual', accessTokenEncrypted: 'enc:ntn_token', token: 'enc:ntn_token', updatedAt: new Date() },
    ];
    listarDestinosNotion.mockRejectedValue(new Error('sem acesso'));

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json().destinos).toEqual([]);
  });
});

describe('GET /integrations/notion/authorize', () => {
  it('sem credencial: 500 que diz o que preencher e onde consegui-lo', async () => {
    vi.stubEnv('NOTION_CLIENT_ID', '');
    vi.stubEnv('NOTION_CLIENT_SECRET', '');
    vi.stubEnv('NOTION_REDIRECT_URI', '');

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/authorize' });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('NOTION_CLIENT_ID');
    expect(res.json().error).toContain('notion.so/my-integrations');
  });

  it('tudo configurado: devolve a URL do Notion com owner=user e o state assinado', async () => {
    credenciaisCompletas();

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/authorize' });

    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().authorize_url);
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    // `owner=user` é o que faz o Notion PERGUNTAR quais páginas liberar. Sem
    // ele a integração conecta e não tem onde escrever.
    expect(url.searchParams.get('owner')).toBe('user');
    expect(url.searchParams.get('state')).toBe('state-assinado');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/integrations/notion/callback');
  });

  /** A mesma armadilha que derrubou o ClickUp: endereço de retorno morto vira
   *  erro no domínio do provedor, longe daqui. Aqui ele vira 503 na nossa tela. */
  it('endereço de retorno morto: 503 antes de mandar a pessoa pro Notion', async () => {
    credenciaisCompletas('https://tunel-morto.trycloudflare.com/integrations/notion/callback');
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as typeof fetch;

    const res = await (await buildApp()).inject({ method: 'GET', url: '/integrations/notion/authorize' });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('túnel temporário');
  });
});
