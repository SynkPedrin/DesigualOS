import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

/**
 * Daily Tasks — API contra PostgreSQL REAL e isolado. A autenticação é simulada por cabeçalho (`x-test-user`),
 * mas TUDO o resto é real: resolução de tenant, guarda de acesso, motor e banco. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const users = vi.hoisted(() => new Map<string, { id: string; roles: string[] }>());
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const u = users.get(String(request.headers['x-test-user'] ?? ''));
    if (!u) { reply.code(401).send({ error: 'Not authenticated' }); return; }
    request.authUser = { id: u.id, roles: u.roles, permissions: u.roles.includes('master') ? [{ resource: '*', action: '*' }] : [], email: 'x@y.invalid', name: 'T' };
  },
  requirePermission: () => async () => {},
}));

describe.skipIf(!enabled)('Daily Tasks — rotas × PostgreSQL real', () => {
  const A = { org: randomUUID(), master: randomUUID(), admin: randomUUID(), collab: randomUUID(), client: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID() };
  const app: FastifyInstance = Fastify();
  let dbm: typeof import('@desigual-os/database');

  const call = (user: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url: path, headers: { 'x-test-user': user, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    const { db, schema } = dbm;
    users.set('master', { id: A.master, roles: ['master'] });
    users.set('admin', { id: A.admin, roles: ['colaborador'] });
    users.set('collab', { id: A.collab, roles: ['colaborador'] });
    users.set('bAdmin', { id: B.admin, roles: ['colaborador'] });
    for (const o of [A.org, B.org]) await db.insert(schema.organizations).values({ id: o, name: `W ${o.slice(0, 6)}`, slug: `w-${o}` });
    for (const [id, org, role] of [[A.master, A.org, 'owner'], [A.admin, A.org, 'admin'], [A.collab, A.org, 'collaborator'], [B.admin, B.org, 'owner']] as const) {
      await db.insert(schema.users).values({ id, name: id.slice(0, 6), email: `${id}@w.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: org, userId: id, role });
    }
    await db.insert(schema.clients).values({ id: A.client, name: 'Cli', slug: A.client, organizationId: A.org });
    const { registerWorkRoutes } = await import('./routes');
    await app.register(registerWorkRoutes);
    await app.ready();
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    await app.close();
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.master, A.admin, A.collab, B.admin]));
  });

  it('sem login: 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/work/tree' })).statusCode).toBe(401);
  });

  it('flag desligada: NINGUÉM entra, nem master, em NENHUMA rota (inclusive por URL direta)', async () => {
    for (const [method, path] of [['GET', '/work/tree'], ['GET', '/work/tasks'], ['GET', '/work/members'], ['POST', '/work/spaces']] as const) {
      const r = await call('master', method, path, method === 'POST' ? { name: 'x' } : undefined);
      expect(r.statusCode, `${method} ${path}`).toBe(403);
      expect(r.json().reason).toBe('flag_off');
    }
    expect((await call('master', 'GET', '/work/access')).json()).toMatchObject({ allowed: false });
  });

  it('só master liga a flag; admin de empresa comum não consegue se autoliberar', async () => {
    expect((await call('admin', 'PUT', '/work/admin/flag', { enabled: true, allowedUserIds: [A.admin] })).statusCode).toBe(403);
    expect((await call('collab', 'PUT', '/work/admin/flag', { enabled: true, allowedUserIds: [A.collab] })).statusCode).toBe(403);
    const ok = await call('master', 'PUT', '/work/admin/flag', { enabled: true, allowedUserIds: [A.master, A.admin, A.collab] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().enabled).toBe(true);
  });

  it('flag ligada: admin e colaborador autorizados entram (o Daily Tasks é a tela de trabalho da operação)', async () => {
    expect((await call('admin', 'GET', '/work/access')).json()).toMatchObject({ allowed: true });
    expect((await call('admin', 'GET', '/work/tree')).statusCode).toBe(200);
    expect((await call('collab', 'GET', '/work/tree')).statusCode).toBe(200);
    expect((await call('collab', 'GET', '/work/access')).json()).toMatchObject({ allowed: true });
  });

  it('autorização é pela empresa do tenant: B não herda a flag da A', async () => {
    const r = await call('bAdmin', 'GET', '/work/tree');
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe('flag_off');
  });

  let spaceId = '';
  let listId = '';
  let statusIds: string[] = [];

  it('fluxo completo: espaço → lista → tarefa → leitura por chave → atualização → conclusão', async () => {
    const sp = await call('admin', 'POST', '/work/spaces', { name: 'Operação' });
    expect(sp.statusCode).toBe(200);
    spaceId = sp.json().id;
    const ls = await call('admin', 'POST', '/work/lists', { spaceId, name: 'Entregas' });
    listId = ls.json().id;
    const st = await call('admin', 'GET', `/work/spaces/${spaceId}/statuses`);
    statusIds = st.json().statuses.map((s: { id: string }) => s.id);
    expect(statusIds).toHaveLength(5);

    const t = await call('admin', 'POST', '/work/tasks', { listId, title: 'Briefing', priority: 2, assigneeIds: [A.collab], clientId: A.client, dueAt: '2026-11-10T12:00:00-03:00' });
    expect(t.statusCode).toBe(200);
    const task = t.json();
    expect(task.key).toMatch(/^DT-\d+$/);
    expect(task.dueAt).toBe('2026-11-10T15:00:00.000Z');
    expect((await call('admin', 'GET', `/work/tasks/${task.key}`)).json().id).toBe(task.id);

    const upd = await call('admin', 'PATCH', `/work/tasks/${task.id}`, { statusId: statusIds[4], expectedVersion: 1 });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().completedAt).not.toBeNull();
    const stale = await call('admin', 'PATCH', `/work/tasks/${task.id}`, { title: 'Velho', expectedVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().details.currentVersion).toBe(2);
  });

  it('Idempotency-Key: o mesmo cabeçalho devolve a mesma tarefa', async () => {
    const h = { 'idempotency-key': randomUUID() };
    const [a, b] = await Promise.all([call('admin', 'POST', '/work/tasks', { listId, title: 'Idem' }, h), call('admin', 'POST', '/work/tasks', { listId, title: 'Idem' }, h)]);
    expect(a.json().id).toBe(b.json().id);
    expect((await call('admin', 'POST', '/work/tasks', { listId, title: 'x' }, { 'idempotency-key': 'curta' })).statusCode).toBe(400);
  });

  it('listagem com filtros e paginação', async () => {
    for (let i = 0; i < 3; i++) await call('admin', 'POST', '/work/tasks', { listId, title: `Pag ${i}`, priority: 1 });
    const r = await call('admin', 'GET', `/work/tasks?list_id=${listId}&priorities=1&limit=2&sort=number`);
    expect(r.statusCode).toBe(200);
    expect(r.json().rows).toHaveLength(2);
    expect(r.json().total).toBeGreaterThanOrEqual(3);
    expect((await call('admin', 'GET', '/work/tasks?priorities=9')).statusCode).toBe(400);
    expect((await call('admin', 'GET', '/work/tasks?status_ids=nao-uuid')).statusCode).toBe(400);
  });

  it('lote devolve resultado por tarefa e conta sucessos/falhas', async () => {
    const t = (await call('admin', 'POST', '/work/tasks', { listId, title: 'Lote' })).json();
    const r = await call('admin', 'POST', '/work/tasks/bulk', { ids: [t.id, randomUUID()], patch: { priority: 1 } });
    expect(r.json().okCount).toBe(1);
    expect(r.json().failedCount).toBe(1);
  });

  it('validação: payload ruim vira 400 com mensagem, nunca 500', async () => {
    expect((await call('admin', 'POST', '/work/tasks', { listId, title: '' })).statusCode).toBe(400);
    expect((await call('admin', 'POST', '/work/tasks', { listId: 'x', title: 'a' })).statusCode).toBe(400);
    expect((await call('admin', 'POST', '/work/tasks', { listId, title: 'a', priority: 7 })).statusCode).toBe(400);
    expect((await call('admin', 'POST', '/work/tasks', { listId, title: 'a', dueAt: 'amanhã' })).statusCode).toBe(400);
    expect((await call('admin', 'PATCH', '/work/tasks/nao-uuid', { title: 'a' })).statusCode).toBe(400);
  });

  it('ISOLAMENTO: a flag de B ligada não dá acesso a ids da A (IDOR responde 404 como se não existisse)', async () => {
    await call('master', 'PUT', '/work/admin/flag', { enabled: true, allowedUserIds: [A.master, A.admin, A.collab] });
    const { db, schema } = dbm;
    await db.insert(schema.workFeatureFlags).values({ organizationId: B.org, key: 'daily_tasks_enabled', enabled: true, allowedUserIds: [B.admin] });
    const sp = await call('bAdmin', 'POST', '/work/spaces', { name: 'B' });
    expect(sp.statusCode).toBe(200);
    const task = (await call('admin', 'POST', '/work/tasks', { listId, title: 'Da A' })).json();
    for (const [m, p, body] of [
      ['GET', `/work/tasks/${task.id}`, undefined],
      ['PATCH', `/work/tasks/${task.id}`, { title: 'hack' }],
      ['POST', `/work/tasks/${task.id}/move`, { position: 1 }],
      ['POST', `/work/tasks/${task.id}/archive`, undefined],
      ['GET', `/work/tasks/${task.id}/activity`, undefined],
      ['PATCH', `/work/spaces/${spaceId}`, { name: 'hack' }],
      ['GET', `/work/spaces/${spaceId}/statuses`, undefined],
      ['POST', '/work/tasks', { listId, title: 'cruzada' }],
    ] as const) {
      const r = await call('bAdmin', m, p, body);
      expect([404, 200]).toContain(r.statusCode);
      if (p.endsWith('/statuses')) expect(r.json().statuses).toEqual([]);
      else expect(r.statusCode, `${m} ${p}`).toBe(404);
    }
    const b = await call('bAdmin', 'GET', '/work/tasks?q=Da%20A');
    expect(b.json().total).toBe(0);
    expect((await call('admin', 'GET', `/work/tasks/${task.id}`)).json().title).toBe('Da A');
  });

  it('spoof do seletor de empresa: pedir a empresa de outro é recusado', async () => {
    const r = await call('bAdmin', 'GET', '/work/tree', undefined, { 'x-organization-id': A.org });
    expect(r.statusCode).toBe(403);
  });

  it('seletor de responsáveis só lista membros da PRÓPRIA empresa', async () => {
    const r = await call('admin', 'GET', '/work/members');
    const ids = r.json().members.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining([A.admin, A.collab]));
    expect(ids).not.toContain(B.admin);
  });
});
