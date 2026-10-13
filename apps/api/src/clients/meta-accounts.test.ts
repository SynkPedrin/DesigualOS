import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type { getMetaAccountInsights as GetMetaAccountInsights, getMetaAdAccounts as GetMetaAdAccounts, getMetaCampaigns as GetMetaCampaigns } from '@desigual-os/tool-gateway';
import type * as ToolGatewayModule from '@desigual-os/tool-gateway';

/**
 * ISOLAMENTO DE MÍDIA POR CLIENTE (§34-38/§76 do prompt "FINAL PRODUCT
 * REFINEMENT", 06/10/2026): a regra que não pode falhar é "mídia é sempre
 * vinculada a um cliente" — Cosentino nunca vê (nem aciona a Graph API com) a
 * conta de mídia da 3Net, mesmo que a MESMA conexão Meta tenha acesso às duas.
 *
 * Postgres real e isolado (mesmo padrão de automations/tenant-postgres.test.ts):
 * sem TENANT_TEST_DATABASE_URL apontando pra um 127.0.0.1, os testes abaixo
 * ficam `skip` em vez de rodar contra qualquer coisa que pareça produção.
 */

const state = vi.hoisted(() => ({ userId: '' }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

const getMetaAdAccounts = vi.fn<typeof GetMetaAdAccounts>();
const getMetaAccountInsights = vi.fn<typeof GetMetaAccountInsights>();
const getMetaCampaigns = vi.fn<typeof GetMetaCampaigns>();

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Meta isolation tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: state.userId, roles: ['member'], permissions: [{ resource: 'clients', action: 'read' }, { resource: 'clients', action: 'write' }] };
  },
  requirePermission: () => async () => {},
}));

/** Token nunca precisa ser um segredo de verdade aqui — só algo que o decrypt mockado reconheça. */
vi.mock('../lib/token-crypto', () => ({
  encryptToken: (value: string) => `enc:${value}`,
  decryptToken: (value: string) => value.replace(/^enc:/, ''),
}));

/**
 * resolveMetaAccess/resolveMetaAccessByConnectionId (meta-access-resolver.ts,
 * movido pra dentro de @desigual-os/tool-gateway nos Relatórios PDF,
 * 06/10/2026) chamam decryptToken/isMetaTokenValid por IMPORT RELATIVO
 * DENTRO do próprio pacote (`./token-crypto`, `./meta-oauth') — sobrescrever
 * essas duas chaves no objeto que este `vi.mock` devolve NÃO afeta essa
 * chamada interna (a função já fechou sobre a referência real ao compilar).
 * Por isso os dois resolvers abaixo são reimplementados aqui, direto contra
 * o `db` mockado (que em modo Postgres real já é a conexão de teste) — teste
 * de resolver teria que mockar o pacote inteiro função por função pra
 * funcionar, e não é esse comportamento que este arquivo quer provar.
 */
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof ToolGatewayModule>('@desigual-os/tool-gateway');
  const fakeDecrypt = (value: string) => value.replace(/^enc:/, '');

  async function resolveMetaAccess(userId: string) {
    const { db, schema } = await import('@desigual-os/database');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await db
      .select()
      .from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, 'meta')));
    if (!row || row.status !== 'connected') return null;
    return { token: fakeDecrypt(row.accessTokenEncrypted), connectionId: row.id };
  }

  async function resolveMetaAccessByConnectionId(connectionId: string) {
    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId));
    if (!row || row.status !== 'connected') return null;
    return { token: fakeDecrypt(row.accessTokenEncrypted), connectionId: row.id };
  }

  return {
    ...actual,
    getMetaAdAccounts,
    getMetaAccountInsights,
    getMetaCampaigns,
    isMetaTokenValid: async () => true,
    resolveMetaAccess,
    resolveMetaAccessByConnectionId,
  };
});

describe.skipIf(!enabled)('isolamento de Meta Ads por cliente (Postgres real)', () => {
  const cosentino = { org: randomUUID(), user: randomUUID(), client: randomUUID(), connection: randomUUID() };
  const treNet = { org: randomUUID(), user: randomUUID(), client: randomUUID(), connection: randomUUID() };
  const CONTA_COSENTINO = 'act_COSENTINO_111';
  const CONTA_3NET = 'act_3NET_222';

  const app = Fastify();
  let connection: Sql;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    for (const tenant of [cosentino, treNet]) {
      await connection`insert into organizations(id, name, slug) values (${tenant.org}, 'QA Meta', ${tenant.org})`;
      await connection`insert into users(id, name, email) values (${tenant.user}, 'QA', ${tenant.user + '@meta-qa.invalid'})`;
      await connection`insert into organization_members(organization_id, user_id, role) values (${tenant.org}, ${tenant.user}, 'owner')`;
      await connection`insert into clients(id, name, slug, organization_id) values (${tenant.client}, 'QA', ${tenant.client}, ${tenant.org})`;
      await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status)
        values (${tenant.connection}, ${tenant.user}, 'meta', ${'enc:token-' + tenant.user}, 'connected')`;
      // Sem isto, requireModule('meta_ads') (Workspace Builder, 06/10/2026) barra as
      // duas rotas com 403 antes de chegar no isolamento que este arquivo testa —
      // o padrão de quem nunca foi configurado (modulosPadrao) não inclui mídia.
      await connection`insert into workspace_configs(user_id, modules) values (${tenant.user}, ${JSON.stringify(['meta_ads'])}::jsonb)`;
    }

    await connection`insert into client_meta_accounts(client_id, account_id, business_id, connection_id, is_primary)
      values (${cosentino.client}, ${CONTA_COSENTINO}, 'biz_cosentino', ${cosentino.connection}, true)`;
    await connection`insert into client_meta_accounts(client_id, account_id, business_id, connection_id, is_primary)
      values (${treNet.client}, ${CONTA_3NET}, 'biz_3net', ${treNet.connection}, true)`;

    const { registerClientRoutes } = await import('./routes');
    await app.register(registerClientRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection?.end();
  });

  it('GET /clients/:id/meta-accounts da Cosentino nunca devolve a conta da 3Net', async () => {
    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${cosentino.client}/meta-accounts` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { accounts: Array<{ account_id: string }> };
    expect(body.accounts.map((a) => a.account_id)).toEqual([CONTA_COSENTINO]);
    expect(body.accounts.map((a) => a.account_id)).not.toContain(CONTA_3NET);
  });

  it('GET /clients/:id/meta-accounts da 3Net nunca devolve a conta da Cosentino', async () => {
    state.userId = treNet.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${treNet.client}/meta-accounts` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { accounts: Array<{ account_id: string }> };
    expect(body.accounts.map((a) => a.account_id)).toEqual([CONTA_3NET]);
  });

  it('um usuário sem vínculo na organização da 3Net não enxerga nem o cliente (404), não só a conta', async () => {
    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${treNet.client}/meta-accounts` });
    expect(response.statusCode).toBe(404);
  });

  it('o resumo de mídia da Cosentino consulta a Graph API SÓ com a conta da Cosentino, nunca com a da 3Net', async () => {
    getMetaAccountInsights.mockReset().mockResolvedValue({
      spend: 1234.5, impressions: 10000, clicks: 200, ctr: 2, cpc: 6.17, cpm: 123.45, frequency: 1.2, results: 15,
      periodStart: '2026-09-01', periodEnd: '2026-09-30',
    });
    getMetaCampaigns.mockReset().mockResolvedValue([{ id: 'c1', name: 'Campanha QA', status: 'ACTIVE', spend: 1234.5, clicks: 200, ctr: 2 }]);

    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${cosentino.client}/media/meta/summary` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { connected: boolean; account_id: string };
    expect(body.connected).toBe(true);
    expect(body.account_id).toBe(CONTA_COSENTINO);

    // A prova central do §76: a chamada real ao Meta usou a conta da Cosentino, nunca a da 3Net.
    expect(getMetaAccountInsights).toHaveBeenCalledWith(expect.any(String), CONTA_COSENTINO, expect.any(String));
    expect(getMetaAccountInsights).not.toHaveBeenCalledWith(expect.any(String), CONTA_3NET, expect.any(String));
    expect(getMetaCampaigns).toHaveBeenCalledWith(expect.any(String), CONTA_COSENTINO, expect.any(String));
  });

  it('cliente sem nenhuma conta vinculada devolve connected:false, nunca dado inventado', async () => {
    const semVinculo = randomUUID();
    await connection`insert into clients(id, name, slug, organization_id) values (${semVinculo}, 'QA sem vinculo', ${semVinculo}, ${cosentino.org})`;
    getMetaAccountInsights.mockClear();

    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${semVinculo}/media/meta/summary` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ connected: false });
    expect(getMetaAccountInsights).not.toHaveBeenCalled();
  });

  it('POST recusa vincular uma conta que a conexão Meta de quem chama não enxerga', async () => {
    getMetaAdAccounts.mockReset().mockResolvedValue([{ id: 'act_OUTRA_CONTA', accountId: '999', name: 'Outra', status: 1, currency: 'BRL', businessId: 'biz_x', businessName: 'X' }]);

    state.userId = cosentino.user;
    const response = await app.inject({
      method: 'POST',
      url: `/clients/${cosentino.client}/meta-accounts`,
      payload: { account_id: 'act_NAO_AUTORIZADA' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST vincula quando a conta está entre as acessíveis pela conexão, e o GET da 3Net continua sem vê-la', async () => {
    getMetaAdAccounts.mockReset().mockResolvedValue([
      { id: 'act_NOVA_COSENTINO', accountId: '555', name: 'Nova conta', status: 1, currency: 'BRL', businessId: 'biz_cosentino', businessName: 'Cosentino' },
    ]);

    state.userId = cosentino.user;
    const postResponse = await app.inject({
      method: 'POST',
      url: `/clients/${cosentino.client}/meta-accounts`,
      payload: { account_id: 'act_NOVA_COSENTINO', label: 'Conta nova' },
    });
    expect(postResponse.statusCode).toBe(201);

    state.userId = treNet.user;
    const threeNetResponse = await app.inject({ method: 'GET', url: `/clients/${treNet.client}/meta-accounts` });
    const body = threeNetResponse.json() as { accounts: Array<{ account_id: string }> };
    expect(body.accounts.map((a) => a.account_id)).not.toContain('act_NOVA_COSENTINO');
  });
});
