import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type {
  getGoogleAdsAccountInsights as GetGoogleAdsAccountInsights,
  getGoogleAdsAccounts as GetGoogleAdsAccounts,
  getGoogleAdsCampaigns as GetGoogleAdsCampaigns,
} from '@desigual-os/tool-gateway';
import type * as ToolGatewayModule from '@desigual-os/tool-gateway';

/**
 * Mesmo teste de isolamento de meta-accounts.test.ts, agora pro Google Ads
 * (§43-45/§77 do prompt "FINAL PRODUCT REFINEMENT"). A regra é idêntica:
 * Cosentino nunca vê, nem aciona a API com, o Customer ID da 3Net.
 */
const state = vi.hoisted(() => ({ userId: '' }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

const getGoogleAdsAccounts = vi.fn<typeof GetGoogleAdsAccounts>();
const getGoogleAdsAccountInsights = vi.fn<typeof GetGoogleAdsAccountInsights>();
const getGoogleAdsCampaigns = vi.fn<typeof GetGoogleAdsCampaigns>();
const refreshGoogleAdsAccessToken = vi.fn(async () => 'fresh-access-token');

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Google Ads isolation tests require an isolated local PostgreSQL');
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

vi.mock('../lib/token-crypto', () => ({
  encryptToken: (value: string) => `enc:${value}`,
  decryptToken: (value: string) => value.replace(/^enc:/, ''),
}));

/**
 * resolveGoogleAdsAccess/resolveGoogleAdsAccessByConnectionId (movidos pra
 * dentro de @desigual-os/tool-gateway nos Relatórios PDF, 06/10/2026) chamam
 * refreshGoogleAdsAccessToken por IMPORT RELATIVO dentro do próprio pacote —
 * sobrescrever essa chave no objeto que este `vi.mock` devolve não afeta essa
 * chamada interna. Reimplementados aqui direto contra o `db` mockado, mesmo
 * raciocínio de meta-accounts.test.ts.
 */
vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof ToolGatewayModule>('@desigual-os/tool-gateway');
  const fakeDecrypt = (value: string) => value.replace(/^enc:/, '');
  const envConfig = () => ({
    clientId: process.env.GOOGLE_ADS_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_ADS_REDIRECT_URI!,
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });

  async function resolveGoogleAdsAccess(userId: string) {
    const { db, schema } = await import('@desigual-os/database');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await db
      .select()
      .from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, 'google_ads')));
    if (!row || row.status !== 'connected') return null;
    return { accessToken: await refreshGoogleAdsAccessToken(), connectionId: row.id, config: envConfig() };
  }

  async function resolveGoogleAdsAccessByConnectionId(connectionId: string) {
    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId));
    if (!row || row.status !== 'connected') return null;
    void fakeDecrypt(row.accessTokenEncrypted); // mesmo formato do real: decripta o refresh_token antes de trocar por access_token.
    return { accessToken: await refreshGoogleAdsAccessToken(), connectionId: row.id, config: envConfig() };
  }

  return {
    ...actual,
    getGoogleAdsAccounts,
    getGoogleAdsAccountInsights,
    getGoogleAdsCampaigns,
    refreshGoogleAdsAccessToken,
    resolveGoogleAdsAccess,
    resolveGoogleAdsAccessByConnectionId,
  };
});

describe.skipIf(!enabled)('isolamento de Google Ads por cliente (Postgres real)', () => {
  const cosentino = { org: randomUUID(), user: randomUUID(), client: randomUUID(), connection: randomUUID() };
  const treNet = { org: randomUUID(), user: randomUUID(), client: randomUUID(), connection: randomUUID() };
  const CUSTOMER_COSENTINO = '1110001111';
  const CUSTOMER_3NET = '2220002222';

  const app = Fastify();
  let connection: Sql;
  let envBackup: Record<string, string | undefined>;

  beforeAll(async () => {
    envBackup = {
      GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
      GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
      GOOGLE_ADS_REDIRECT_URI: process.env.GOOGLE_ADS_REDIRECT_URI,
      GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    };
    process.env.GOOGLE_ADS_CLIENT_ID = 'qa-client-id';
    process.env.GOOGLE_ADS_CLIENT_SECRET = 'qa-client-secret';
    process.env.GOOGLE_ADS_REDIRECT_URI = 'https://qa.invalid/callback';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'qa-developer-token';

    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    for (const tenant of [cosentino, treNet]) {
      await connection`insert into organizations(id, name, slug) values (${tenant.org}, 'QA Google Ads', ${tenant.org})`;
      await connection`insert into users(id, name, email) values (${tenant.user}, 'QA', ${tenant.user + '@google-ads-qa.invalid'})`;
      await connection`insert into organization_members(organization_id, user_id, role) values (${tenant.org}, ${tenant.user}, 'owner')`;
      await connection`insert into clients(id, name, slug, organization_id) values (${tenant.client}, 'QA', ${tenant.client}, ${tenant.org})`;
      await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status)
        values (${tenant.connection}, ${tenant.user}, 'google_ads', ${'enc:refresh-' + tenant.user}, 'connected')`;
      // Sem isto, requireModule('google_ads') (Workspace Builder, 06/10/2026) barra as
      // duas rotas com 403 antes de chegar no isolamento que este arquivo testa.
      await connection`insert into workspace_configs(user_id, modules) values (${tenant.user}, ${JSON.stringify(['google_ads'])}::jsonb)`;
    }

    await connection`insert into client_google_ads_accounts(client_id, customer_id, connection_id, is_primary)
      values (${cosentino.client}, ${CUSTOMER_COSENTINO}, ${cosentino.connection}, true)`;
    await connection`insert into client_google_ads_accounts(client_id, customer_id, connection_id, is_primary)
      values (${treNet.client}, ${CUSTOMER_3NET}, ${treNet.connection}, true)`;

    const { registerClientRoutes } = await import('./routes');
    await app.register(registerClientRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection?.end();
    Object.assign(process.env, envBackup);
  });

  it('GET /clients/:id/google-ads-accounts da Cosentino nunca devolve o Customer ID da 3Net', async () => {
    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${cosentino.client}/google-ads-accounts` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { accounts: Array<{ customer_id: string }> };
    expect(body.accounts.map((a) => a.customer_id)).toEqual([CUSTOMER_COSENTINO]);
    expect(body.accounts.map((a) => a.customer_id)).not.toContain(CUSTOMER_3NET);
  });

  it('um usuário sem vínculo na organização da 3Net não enxerga nem o cliente (404)', async () => {
    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${treNet.client}/google-ads-accounts` });
    expect(response.statusCode).toBe(404);
  });

  it('o resumo de mídia da Cosentino consulta a API SÓ com o Customer ID da Cosentino, nunca com o da 3Net', async () => {
    getGoogleAdsAccountInsights.mockReset().mockResolvedValue({
      spend: 980.4, impressions: 5000, clicks: 300, ctr: 6, averageCpc: 3.27, conversions: 10, conversionsValue: 2500,
    });
    getGoogleAdsCampaigns.mockReset().mockResolvedValue([{ id: 'c1', name: 'Campanha QA', status: 'ENABLED', spend: 980.4, clicks: 300, ctr: 6 }]);

    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${cosentino.client}/media/google-ads/summary` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { connected: boolean; customer_id: string };
    expect(body.connected).toBe(true);
    expect(body.customer_id).toBe(CUSTOMER_COSENTINO);

    expect(getGoogleAdsAccountInsights).toHaveBeenCalledWith(expect.anything(), expect.any(String), CUSTOMER_COSENTINO, expect.any(String));
    expect(getGoogleAdsAccountInsights).not.toHaveBeenCalledWith(expect.anything(), expect.any(String), CUSTOMER_3NET, expect.any(String));
  });

  it('cliente sem nenhuma conta vinculada devolve connected:false, nunca dado inventado', async () => {
    const semVinculo = randomUUID();
    await connection`insert into clients(id, name, slug, organization_id) values (${semVinculo}, 'QA sem vinculo', ${semVinculo}, ${cosentino.org})`;
    getGoogleAdsAccountInsights.mockClear();

    state.userId = cosentino.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${semVinculo}/media/google-ads/summary` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ connected: false });
    expect(getGoogleAdsAccountInsights).not.toHaveBeenCalled();
  });

  it('POST recusa vincular um Customer ID que a conexão de quem chama não enxerga', async () => {
    getGoogleAdsAccounts.mockReset().mockResolvedValue([{ customerId: '9999999999', descriptiveName: 'Outra', currencyCode: 'BRL', status: 'ENABLED', managerCustomerId: null }]);

    state.userId = cosentino.user;
    const response = await app.inject({
      method: 'POST',
      url: `/clients/${cosentino.client}/google-ads-accounts`,
      payload: { customer_id: '1234567890' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST vincula quando o Customer ID está entre os acessíveis, e o GET da 3Net continua sem vê-lo', async () => {
    getGoogleAdsAccounts.mockReset().mockResolvedValue([
      { customerId: '5550005555', descriptiveName: 'Nova conta', currencyCode: 'BRL', status: 'ENABLED', managerCustomerId: null },
    ]);

    state.userId = cosentino.user;
    const postResponse = await app.inject({
      method: 'POST',
      url: `/clients/${cosentino.client}/google-ads-accounts`,
      payload: { customer_id: '5550005555', label: 'Conta nova' },
    });
    expect(postResponse.statusCode).toBe(201);

    state.userId = treNet.user;
    const threeNetResponse = await app.inject({ method: 'GET', url: `/clients/${treNet.client}/google-ads-accounts` });
    const body = threeNetResponse.json() as { accounts: Array<{ customer_id: string }> };
    expect(body.accounts.map((a) => a.customer_id)).not.toContain('5550005555');
  });
});
