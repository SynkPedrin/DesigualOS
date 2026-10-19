import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * oauth-provider.test.ts — o `extra` é a ÚNICA ponte entre o token e a tool.
 *
 * A corrente inteira da autoria (token → extra → principal → tool → evento →
 * memória → proveniência) quebrava em UMA linha aqui: `verificarAccessToken`
 * já devolvia `actorIdentityId` do banco e o `extra` simplesmente não copiava.
 * Este teste existe para que essa linha nunca mais suma em silêncio: se a
 * propagação cair, ele falha — não há outro teste que cubra este elo.
 */

const h = vi.hoisted(() => ({
  verificado: null as null | {
    tokenId: string;
    clientId: string;
    userId: string;
    organizationId: string;
    scopes: string[];
    expiresAt: Date;
    resource: string | null;
    actorIdentityId: string | null;
  },
  falharVerificacao: false,
}));

vi.mock('./token-store.js', () => ({
  verificarAccessToken: vi.fn(async () => {
    if (h.falharVerificacao) throw new Error('banco indisponível');
    return h.verificado;
  }),
  consumirCodigo: vi.fn(),
  emitirCodigoDeAutorizacao: vi.fn(),
  emitirTokens: vi.fn(),
  lerCodigo: vi.fn(),
  revogarPorValor: vi.fn(),
  rotacionarRefresh: vi.fn(),
}));

vi.mock('@desigual-os/database', () => ({
  db: {},
  schema: {
    mcpClients: { __table: 'mcp_clients' },
    users: { __table: 'users' },
  },
}));

vi.mock('@desigual-os/auth', () => ({ verifySupabaseToken: vi.fn() }));
vi.mock('./principal.js', () => ({ organizacaoUnicaDoUsuario: vi.fn() }));

import { DesigualOAuthProvider } from './oauth-provider';

function provider() {
  return new DesigualOAuthProvider({
    supabaseUrl: 'http://supabase.local',
    consentUrl: 'http://app.local/consent',
    resourceUrl: 'http://mcp.local',
  });
}

function tokenVerificado(actorIdentityId: string | null) {
  return {
    tokenId: 'tok-1',
    clientId: 'cliente-1',
    userId: 'u-master',
    organizationId: 'org1',
    scopes: ['desigual.read'],
    expiresAt: new Date(Date.now() + 3600_000),
    resource: null,
    actorIdentityId,
  };
}

beforeEach(() => {
  h.verificado = null;
  h.falharVerificacao = false;
});

describe('verifyAccessToken — o extra carrega quem AGE', () => {
  it('credencial de conexão: actorIdentityId chega ao extra, junto de quem autorizou', async () => {
    h.verificado = tokenVerificado('ident-equipe-atendimento');
    const auth = await provider().verifyAccessToken('dsgx_qualquer');

    expect(auth.extra?.actorIdentityId).toBe('ident-equipe-atendimento');
    // O resto do contrato continua intacto: quem autorizou não some.
    expect(auth.extra?.userId).toBe('u-master');
    expect(auth.extra?.organizationId).toBe('org1');
    expect(auth.extra?.tokenId).toBe('tok-1');
    expect(auth.scopes).toEqual(['desigual.read']);
  });

  it('token LEGADO (OAuth, sem identidade): actorIdentityId é null e o fluxo é idêntico ao de sempre', async () => {
    h.verificado = tokenVerificado(null);
    const auth = await provider().verifyAccessToken('dsga_qualquer');

    expect(auth.extra?.actorIdentityId).toBeNull();
    expect(auth.extra?.userId).toBe('u-master');
    expect(auth.expiresAt).toBe(Math.floor(h.verificado.expiresAt.getTime() / 1000));
  });

  it('token inválido continua recusado com InvalidTokenError (nada mudou na recusa)', async () => {
    h.verificado = null;
    await expect(provider().verifyAccessToken('dsga_ruim')).rejects.toThrow(/inválido|expirado|revogado/i);
  });

  it('falha de INFRA na verificação não vira token inválido', async () => {
    h.falharVerificacao = true;
    await expect(provider().verifyAccessToken('dsga_qualquer')).rejects.toThrow(/verificar o token agora/i);
  });
});
