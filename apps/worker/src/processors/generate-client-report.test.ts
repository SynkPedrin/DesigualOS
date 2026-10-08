import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type * as ToolGatewayModule from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

/**
 * Relatórios PDF (§46-51 do prompt de refinamento, 06/10/2026): prova que o
 * processor busca SÓ a conta Meta vinculada ao cliente do relatório (nunca
 * de outro), busca o período atual E o anterior (pra comparação), lida com
 * canal sem conta conectada sem derrubar o relatório inteiro, e marca
 * status='failed' com a mensagem quando a geração de verdade (upload) falha.
 *
 * Postgres real, mesmo padrão de apps/api/src/clients/meta-accounts.test.ts.
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

const getMetaAccountInsights = vi.fn();
const getMetaCampaigns = vi.fn();
const resolveMetaAccessByConnectionId = vi.fn();
const getGoogleAdsAccountInsights = vi.fn();
const getGoogleAdsCampaigns = vi.fn();
const resolveGoogleAdsAccessByConnectionId = vi.fn();

const uploadMock = vi.fn(async () => ({ error: null as { message: string } | null }));
const getPublicUrlMock = vi.fn((path: string) => ({ data: { publicUrl: `https://fake-storage.invalid/user-uploads/${path}` } }));

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Client report tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('@desigual-os/auth', () => ({
  getSupabaseAdminClient: () => ({
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) },
  }),
}));

vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof ToolGatewayModule>('@desigual-os/tool-gateway');
  return {
    ...actual,
    getMetaAccountInsights,
    getMetaCampaigns,
    resolveMetaAccessByConnectionId,
    getGoogleAdsAccountInsights,
    getGoogleAdsCampaigns,
    resolveGoogleAdsAccessByConnectionId,
    getGoogleAdsEnvConfig: () => ({ clientId: 'qa', clientSecret: 'qa', redirectUri: 'https://qa.invalid', developerToken: 'qa' }),
  };
});

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

describe.skipIf(!enabled)('generateClientReport — Postgres real', () => {
  const org = randomUUID();
  const cosentino = randomUUID();
  const treNet = randomUUID();
  const metaConnection = randomUUID();
  const CONTA_COSENTINO = 'act_COSENTINO_REPORT';
  const CONTA_3NET = 'act_3NET_REPORT';

  let connection: Sql;

  beforeAll(async () => {
    process.env.SUPABASE_URL = 'https://qa.invalid';
    process.env.SUPABASE_SECRET_KEY = 'qa-secret';

    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${org}, 'QA Reports', ${org})`;
    const user = randomUUID();
    await connection`insert into users(id, name, email) values (${user}, 'QA', ${user + '@reports-qa.invalid'})`;
    await connection`insert into clients(id, name, slug, organization_id) values (${cosentino}, 'Cosentino QA', ${cosentino}, ${org}), (${treNet}, '3Net QA', ${treNet}, ${org})`;
    await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status) values (${metaConnection}, ${user}, 'meta', 'enc:fake', 'connected')`;
    await connection`insert into client_meta_accounts(client_id, account_id, connection_id, is_primary) values (${cosentino}, ${CONTA_COSENTINO}, ${metaConnection}, true)`;
    await connection`insert into client_meta_accounts(client_id, account_id, connection_id, is_primary) values (${treNet}, ${CONTA_3NET}, ${metaConnection}, true)`;
    // 3Net não tem Google Ads vinculado de propósito — testa o canal "não conectado".
  });

  afterAll(async () => {
    await connection?.end();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  });

  async function criarRelatorio(clientId: string, channels: string[]) {
    const { db, schema } = await import('@desigual-os/database');
    const requestedBy = randomUUID();
    await connection`insert into users(id, name, email) values (${requestedBy}, 'QA Requester', ${requestedBy + '@reports-qa.invalid'})`;
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 86_400_000);
    const [row] = await db
      .insert(schema.clientReports)
      .values({ organizationId: org, clientId, requestedBy, channels, periodDays: 30, periodStart, periodEnd })
      .returning();
    return row!.id;
  }

  it('busca Meta Ads SÓ da conta da Cosentino (atual + período anterior), nunca da 3Net, e marca o relatório como pronto', async () => {
    getMetaAccountInsights.mockReset().mockResolvedValue({ spend: 100, results: 10, ctr: 2, cpc: 1.5 });
    getMetaCampaigns.mockReset().mockResolvedValue([{ id: 'c1', name: 'Campanha QA', status: 'ACTIVE', spend: 100, clicks: 50, ctr: 2 }]);
    resolveMetaAccessByConnectionId.mockReset().mockResolvedValue({ token: 'fake-token', connectionId: metaConnection });
    uploadMock.mockClear();

    const { generateClientReport } = await import('./generate-client-report.js');
    const reportId = await criarRelatorio(cosentino, ['meta']);
    await generateClientReport(reportId, logger);

    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const [report] = await db.select().from(schema.clientReports).where(eq(schema.clientReports.id, reportId));

    expect(report?.status).toBe('ready');
    expect(report?.storageUrl).toContain(reportId);
    expect(getMetaAccountInsights).toHaveBeenCalledTimes(2); // atual + anterior
    for (const call of getMetaAccountInsights.mock.calls) {
      expect(call[1]).toBe(CONTA_COSENTINO);
      expect(call[1]).not.toBe(CONTA_3NET);
    }
  });

  it('canal sem conta conectada (3Net, Google Ads) não derruba o relatório — vira "não conectado", nunca chamada externa', async () => {
    getMetaAccountInsights.mockReset().mockResolvedValue({ spend: 50, results: 5, ctr: 1, cpc: 2 });
    getMetaCampaigns.mockReset().mockResolvedValue([]);
    resolveMetaAccessByConnectionId.mockReset().mockResolvedValue({ token: 'fake-token', connectionId: metaConnection });
    getGoogleAdsAccountInsights.mockReset();
    uploadMock.mockClear();

    const { generateClientReport } = await import('./generate-client-report.js');
    const reportId = await criarRelatorio(treNet, ['meta', 'google_ads']);
    await generateClientReport(reportId, logger);

    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const [report] = await db.select().from(schema.clientReports).where(eq(schema.clientReports.id, reportId));

    expect(report?.status).toBe('ready');
    expect(getGoogleAdsAccountInsights).not.toHaveBeenCalled();
    for (const call of getMetaAccountInsights.mock.calls) {
      expect(call[1]).toBe(CONTA_3NET);
    }
  });

  it('falha no upload marca o relatório como failed, com a mensagem — nunca fica "ready" com um PDF que não existe', async () => {
    getMetaAccountInsights.mockReset().mockResolvedValue({ spend: 10, results: 1, ctr: 1, cpc: 1 });
    getMetaCampaigns.mockReset().mockResolvedValue([]);
    resolveMetaAccessByConnectionId.mockReset().mockResolvedValue({ token: 'fake-token', connectionId: metaConnection });
    uploadMock.mockReset().mockResolvedValue({ error: { message: 'bucket indisponível (QA)' } });

    const { generateClientReport } = await import('./generate-client-report.js');
    const reportId = await criarRelatorio(cosentino, ['meta']);
    await generateClientReport(reportId, logger);

    const { db, schema } = await import('@desigual-os/database');
    const { eq } = await import('drizzle-orm');
    const [report] = await db.select().from(schema.clientReports).where(eq(schema.clientReports.id, reportId));

    expect(report?.status).toBe('failed');
    expect(report?.storageUrl).toBeNull();
    expect(report?.errorMessage).toContain('bucket indisponível');
  });
});
