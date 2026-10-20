import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * Workspace Builder (§5-13 do prompt de refinamento, 06/10/2026): template +
 * módulos por colaborador, com o mesmo gate de cross-tenant que
 * admin/routes.ts já usa pras mutações sobre PESSOA (`users:write` sozinho
 * não basta — o alvo precisa pertencer à empresa de trabalho de quem está
 * configurando).
 *
 * Postgres real: o default "sem configuração ainda" (`resolveEnabledModules`)
 * depende de `loadUserAccess` ler `user_roles`/`roles`/`permissions` de
 * verdade — mockar a tabela aqui esconderia exatamente o comportamento que
 * mais importa provar (ninguém perde acesso por este recurso ter nascido).
 */
const state = vi.hoisted(() => ({ userId: '' }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Workspace Builder tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: state.userId, roles: [], permissions: [] };
  },
  // Esta suíte testa o gate de cross-tenant e o resolver de módulos, não o
  // RBAC genérico (que já tem teste próprio em auth/middleware.test.ts) —
  // requirePermission vira no-op de propósito, igual ao padrão de
  // automations/tenant-postgres.test.ts.
  requirePermission: () => async () => {},
}));

describe.skipIf(!enabled)('Workspace Builder, resolução de módulos e gate de cross-tenant (Postgres real)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const masterSemConfig = randomUUID();
  const colaboradorSemConfig = randomUUID();
  const colaboradorDaOrgB = randomUUID();
  const gestorQueConfigura = randomUUID();

  const app = Fastify();
  let connection: Sql;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${orgA}, 'QA WB A', ${orgA}), (${orgB}, 'QA WB B', ${orgB})`;
    await connection`insert into users(id, name, email, active) values
      (${masterSemConfig}, 'Master QA', ${masterSemConfig + '@wb-qa.invalid'}, true),
      (${colaboradorSemConfig}, 'Colaborador QA', ${colaboradorSemConfig + '@wb-qa.invalid'}, true),
      (${colaboradorDaOrgB}, 'Colaborador Org B', ${colaboradorDaOrgB + '@wb-qa.invalid'}, true),
      (${gestorQueConfigura}, 'Gestor QA', ${gestorQueConfigura + '@wb-qa.invalid'}, true)`;
    await connection`insert into organization_members(organization_id, user_id, role) values
      (${orgA}, ${masterSemConfig}, 'member'),
      (${orgA}, ${colaboradorSemConfig}, 'member'),
      (${orgA}, ${gestorQueConfigura}, 'owner'),
      (${orgB}, ${colaboradorDaOrgB}, 'member')`;

    const [papel] = await connection`insert into roles(name) values ('master') on conflict (name) do update set name = excluded.name returning id`;
    await connection`insert into user_roles(user_id, role_id) values (${masterSemConfig}, ${papel!.id})`;

    const { registerWorkspaceRoutes } = await import('./routes');
    await app.register(registerWorkspaceRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection?.end();
  });

  it('master sem workspace configurado vê todos os módulos (padrão generoso, configured:false)', async () => {
    state.userId = masterSemConfig;
    const response = await app.inject({ method: 'GET', url: '/me/workspace' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.configured).toBe(false);
    expect(body.modules).toEqual(expect.arrayContaining(['meta_ads', 'google_ads', 'operacao']));
  });

  // 14/10/2026 (pedido do Pedro): mídia, relatórios, Studio e Operação ENTRARAM
  // no padrão do colaborador — a Alicia (tráfego) abria Mídias e levava 403.
  // Automações continua fora do padrão de cargo (vem por MODULOS_DE_TODOS).
  it('colaborador sem workspace configurado ganha o padrão da operação, com mídia e operação', async () => {
    state.userId = colaboradorSemConfig;
    const response = await app.inject({ method: 'GET', url: '/me/workspace' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.configured).toBe(false);
    expect(body.modules).toEqual(expect.arrayContaining(['hoje', 'clientes', 'inbox', 'meta_ads', 'google_ads', 'operacao', 'relatorios', 'comunicacao']));
  });

  it('gestão configura o workspace de um colaborador da MESMA empresa, e o colaborador passa a ver só isso', async () => {
    state.userId = gestorQueConfigura;
    const put = await app.inject({
      method: 'PUT',
      url: `/team/members/${colaboradorSemConfig}/workspace`,
      payload: { template_id: 'trafego', modules: ['hoje', 'clientes', 'meta_ads', 'google_ads'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ template_id: 'trafego', configured: true, modules: expect.arrayContaining(['meta_ads', 'google_ads']) });

    state.userId = colaboradorSemConfig;
    const me = await app.inject({ method: 'GET', url: '/me/workspace' });
    const body = me.json();
    expect(body.configured).toBe(true);
    // O configurado + os módulos de todos (MODULOS_DE_TODOS), que nenhum cargo tira.
    expect(body.modules.sort()).toEqual(['automations', 'clientes', 'comunicacao', 'google_ads', 'hoje', 'meta_ads']);
    expect(body.modules).not.toContain('aprovacoes'); // o padrão de atendimento tinha; a configuração explícita substitui, não soma.
  });

  it('gestão NUNCA configura o workspace de alguém de outra empresa (404, não 403, não confirma que a pessoa existe)', async () => {
    state.userId = gestorQueConfigura;
    const response = await app.inject({
      method: 'PUT',
      url: `/team/members/${colaboradorDaOrgB}/workspace`,
      payload: { modules: ['hoje'] },
    });
    expect(response.statusCode).toBe(404);
  });

  it('módulo desconhecido é recusado (400), nunca gravado', async () => {
    state.userId = gestorQueConfigura;
    const response = await app.inject({
      method: 'PUT',
      url: `/team/members/${colaboradorSemConfig}/workspace`,
      payload: { modules: ['hoje', 'modulo_que_nao_existe'] },
    });
    expect(response.statusCode).toBe(400);
  });
});
