import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * token-store.test.ts — o carimbo de uso não pode ser órfão nem bloqueante.
 *
 * `last_used_at` existia no schema desde sempre e `marcarUso` estava escrita,
 * mas NUNCA chamada: a tela do master respondia "esta conexão está viva?" com
 * uma coluna eternamente nula. A ligação acontece em `verificarAccessToken`,
 * no caminho de TODA chamada autenticada — fire-and-forget, porque perder o
 * carimbo não pode atrasar nem derrubar a autenticação.
 */

const h = vi.hoisted(() => ({
  linha: null as null | Record<string, unknown>,
  atualizacoes: [] as { set: unknown; onde: unknown }[],
}));

vi.mock('@desigual-os/database', () => {
  const mcpTokens = {
    id: 'mcp_tokens.id',
    clientId: 'mcp_tokens.client_id',
    userId: 'mcp_tokens.user_id',
    organizationId: 'mcp_tokens.organization_id',
    scopes: 'mcp_tokens.scopes',
    expiresAt: 'mcp_tokens.expires_at',
    resource: 'mcp_tokens.resource',
    actorIdentityId: 'mcp_tokens.actor_identity_id',
    tokenHash: 'mcp_tokens.token_hash',
    kind: 'mcp_tokens.kind',
    revokedAt: 'mcp_tokens.revoked_at',
    lastUsedAt: 'mcp_tokens.last_used_at',
  };
  const mcpClients = { clientId: 'mcp_clients.client_id', disabledAt: 'mcp_clients.disabled_at' };

  return {
    db: {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => Promise.resolve(h.linha ? [h.linha] : []),
          }),
        }),
      }),
      update: () => ({
        set: (valores: unknown) => ({
          where: (onde: unknown) => {
            h.atualizacoes.push({ set: valores, onde });
            return Object.assign(Promise.resolve(), { catch: () => Promise.resolve() });
          },
        }),
      }),
    },
    schema: { mcpTokens, mcpClients },
  };
});

import { verificarAccessToken } from './token-store';

function tokenValido() {
  return {
    id: 'tok-1',
    clientId: 'cliente-1',
    userId: 'u-1',
    organizationId: 'org-1',
    scopes: ['desigual.read'],
    expiresAt: new Date(Date.now() + 3600_000),
    resource: null,
    actorIdentityId: null,
    clienteDesligadoEm: null,
  };
}

beforeEach(() => {
  h.linha = null;
  h.atualizacoes.length = 0;
});

describe('verificarAccessToken — carimbo de uso', () => {
  it('token válido dispara marcarUso (last_used_at) sem bloquear a resposta', async () => {
    h.linha = tokenValido();
    const verificado = await verificarAccessToken('dsga_qualquer');

    expect(verificado?.tokenId).toBe('tok-1');
    // O update de last_used_at foi disparado — a coluna passa a existir de
    // verdade. Sem await: a verificação não espera o carimbo.
    expect(h.atualizacoes.length).toBe(1);
    expect(h.atualizacoes[0]!.set).toHaveProperty('lastUsedAt');
  });

  it('token inválido NÃO carimba — uso não se marca em credencial recusada', async () => {
    h.linha = null;
    const verificado = await verificarAccessToken('dsga_inexistente');

    expect(verificado).toBeNull();
    expect(h.atualizacoes.length).toBe(0);
  });

  it('cliente desligado NÃO carimba', async () => {
    h.linha = { ...tokenValido(), clienteDesligadoEm: new Date() };
    const verificado = await verificarAccessToken('dsga_qualquer');

    expect(verificado).toBeNull();
    expect(h.atualizacoes.length).toBe(0);
  });
});
