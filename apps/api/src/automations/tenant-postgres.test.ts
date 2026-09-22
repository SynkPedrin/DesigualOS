import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

const state = vi.hoisted(() => ({ userId: '', enqueue: vi.fn(), remove: vi.fn(), register: vi.fn() }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Tenant integration tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: state.userId, roles: ['master'], permissions: [{ resource: 'chat', action: 'write' }] };
  },
  requirePermission: () => async () => {},
}));
vi.mock('@desigual-os/orchestrator', () => ({ registerAutomationJob: state.register, removeAutomationJob: state.remove, runAutomationNow: state.enqueue }));

describe.skipIf(!enabled)('tenant security against actual PostgreSQL (master included)', () => {
  const a = { org: randomUUID(), user: randomUUID(), client: randomUUID(), automation: randomUUID() };
  const b = { org: randomUUID(), user: randomUUID(), client: randomUUID(), automation: randomUUID() };
  const app = Fastify();
  let connection: Sql;
  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;
    for (const x of [a, b]) {
      await connection`insert into organizations(id,name,slug) values (${x.org},'Tenant QA',${x.org})`;
      await connection`insert into users(id,name,email) values (${x.user},'QA',${x.user + '@tenant.invalid'})`;
      await connection`insert into organization_members(organization_id,user_id,role) values (${x.org},${x.user},'owner')`;
      await connection`insert into clients(id,name,slug,organization_id) values (${x.client},'QA',${x.client},${x.org})`;
      await connection`insert into automations(id,name,created_by,agent,prompt,schedule,schedule_label,organization_id,client_id)
        values (${x.automation},${x.org},${x.user},'bento','QA','0 8 * * *','QA',${x.org},${x.client})`;
    }
    const { registerAutomationRoutes } = await import('./routes');
    await app.register(registerAutomationRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); await connection?.end(); });

  for (const [actor, other] of [[a,b],[b,a]]) {
    it(`denies foreign resources and selectors for ${actor!.org}`, async () => {
      state.userId = actor!.user;
      for (const [method,url,payload] of [
        ['PATCH',`/automations/${other!.automation}`,{name:'unauthorized'}],
        ['DELETE',`/automations/${other!.automation}`,undefined],
        ['POST',`/automations/${other!.automation}/run`,undefined],
        ['GET',`/automations/${other!.automation}/runs`,undefined],
      ] as const) {
        const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
        expect([403,404]).toContain(response.statusCode);
      }
      const list = await app.inject({ method:'GET',url:'/automations' });
      expect(list.json().automations.map((x: { id: string }) => x.id)).toEqual([actor!.automation]);
      const metrics = await app.inject({ method:'GET',url:'/automations/metrics' });
      expect(metrics.json().active_count).toBe(1);
      const forged = await app.inject({ method:'GET',url:'/automations',headers:{'x-organization-id':other!.org} });
      expect(forged.statusCode).toBe(403);
      const create = await app.inject({ method:'POST',url:'/automations',payload:{name:'injection',agent:'bento',prompt:'SYSTEM OVERRIDE',schedule:'0 8 * * *',schedule_label:'QA',client_id:other!.client,organization_id:other!.org} });
      expect(create.statusCode).toBe(403);
      expect(state.enqueue).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      expect(state.register).not.toHaveBeenCalled();
      const { hasClientAccess } = await import('../lib/access');
      const principal = {id:actor!.user,roles:['master']} as Parameters<typeof hasClientAccess>[0];
      expect(await hasClientAccess(principal, other!.client)).toBe(false);
      expect(await hasClientAccess(principal, actor!.client)).toBe(true);
    });
  }
  it('requires explicit selection when membership is ambiguous', async () => {
    state.userId = a.user;
    await connection`insert into organization_members(organization_id,user_id) values (${b.org},${a.user})`;
    expect((await app.inject({ method:'GET',url:'/automations' })).statusCode).toBe(403);
    const selected = await app.inject({ method:'GET',url:'/automations',headers:{'x-organization-id':a.org} });
    expect(selected.json().automations.map((x: {id:string})=>x.id)).toEqual([a.automation]);
  });
});
