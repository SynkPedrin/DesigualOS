import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type * as OrchestratorModule from '@desigual-os/orchestrator';

/**
 * Rotas de Relatórios PDF (§46-51): isolamento por cliente (lista de
 * relatórios da Cosentino nunca mostra o da 3Net), gate de Workspace Builder
 * ('relatorios' precisa estar habilitado) e que o POST enfileira — sem
 * depender de Redis de verdade (enqueueClientReport é mockado).
 */
const state = vi.hoisted(() => ({ userId: '' }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);
const enqueueClientReport = vi.fn(async () => {});

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Reports isolation tests require an isolated local PostgreSQL');
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

vi.mock('@desigual-os/orchestrator', async () => {
  const actual = await vi.importActual<typeof OrchestratorModule>('@desigual-os/orchestrator');
  return { ...actual, enqueueClientReport };
});

describe.skipIf(!enabled)('relatórios PDF por cliente, isolamento e gate de módulo (Postgres real)', () => {
  const cosentino = { org: randomUUID(), user: randomUUID(), client: randomUUID() };
  const treNet = { org: randomUUID(), user: randomUUID(), client: randomUUID() };
  const app = Fastify();
  let connection: Sql;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    for (const tenant of [cosentino, treNet]) {
      await connection`insert into organizations(id, name, slug) values (${tenant.org}, 'QA Reports', ${tenant.org})`;
      await connection`insert into users(id, name, email) values (${tenant.user}, 'QA', ${tenant.user + '@reports-routes-qa.invalid'})`;
      await connection`insert into organization_members(organization_id, user_id, role) values (${tenant.org}, ${tenant.user}, 'owner')`;
      await connection`insert into clients(id, name, slug, organization_id) values (${tenant.client}, 'QA', ${tenant.client}, ${tenant.org})`;
      // 'relatorios' habilitado pros dois — o teste de gate usa um terceiro usuário sem isso.
      await connection`insert into workspace_configs(user_id, modules) values (${tenant.user}, ${JSON.stringify(['relatorios'])}::jsonb)`;
    }

    const { registerClientRoutes } = await import('./routes');
    await app.register(registerClientRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection?.end();
  });

  it('POST cria o relatório, enfileira, e GET da Cosentino nunca lista o relatório da 3Net', async () => {
    state.userId = cosentino.user;
    const post = await app.inject({
      method: 'POST',
      url: `/clients/${cosentino.client}/reports`,
      payload: { channels: ['meta'], period_days: 30 },
    });
    expect(post.statusCode).toBe(202);
    expect(enqueueClientReport).toHaveBeenCalledWith(post.json().id);

    state.userId = treNet.user;
    await app.inject({ method: 'POST', url: `/clients/${treNet.client}/reports`, payload: { channels: ['google_ads'] } });

    state.userId = cosentino.user;
    const lista = await app.inject({ method: 'GET', url: `/clients/${cosentino.client}/reports` });
    const body = lista.json() as { reports: Array<{ id: string; channels: string[] }> };
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]!.channels).toEqual(['meta']);
  });

  it('GET de um relatório pelo cliente ERRADO devolve 404, não o relatório de outro cliente', async () => {
    state.userId = cosentino.user;
    const post = await app.inject({ method: 'POST', url: `/clients/${cosentino.client}/reports`, payload: { channels: ['meta'] } });
    const reportId = post.json().id as string;

    state.userId = treNet.user;
    const response = await app.inject({ method: 'GET', url: `/clients/${treNet.client}/reports/${reportId}` });
    expect(response.statusCode).toBe(404);
  });

  it('sem o módulo "relatorios" habilitado, a rota 403, Workspace Builder vale pra Relatórios também', async () => {
    const semModulo = randomUUID();
    await connection`insert into users(id, name, email) values (${semModulo}, 'QA sem modulo', ${semModulo + '@reports-routes-qa.invalid'})`;
    await connection`insert into organization_members(organization_id, user_id, role) values (${cosentino.org}, ${semModulo}, 'member')`;
    // Workspace configurado SEM Relatórios. Desde 14/10/2026 o padrão de quem
    // nunca foi configurado já inclui Relatórios, então o gate só aparece aqui.
    await connection`insert into workspace_configs(user_id, modules) values (${semModulo}, ${JSON.stringify(['hoje', 'clientes'])}::jsonb)`;

    state.userId = semModulo;
    const response = await app.inject({ method: 'POST', url: `/clients/${cosentino.client}/reports`, payload: { channels: ['meta'] } });
    expect(response.statusCode).toBe(403);
  });
});
