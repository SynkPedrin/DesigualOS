import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

/** Rotas de colaboração, produtividade, automações e integrações: portão (flag + administrador) e isolamento entre empresas, contra Postgres real. */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const users = vi.hoisted(() => new Map<string, { id: string; roles: string[] }>());
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const u = users.get(String(request.headers['x-test-user'] ?? ''));
    if (!u) { reply.code(401).send({ error: 'Not authenticated' }); return; }
    request.authUser = { id: u.id, roles: u.roles, permissions: [], email: 'x@y.invalid', name: 'T' };
  },
  requirePermission: () => async () => {},
}));

describe.skipIf(!enabled)('Daily Tasks — rotas de produtividade × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), collab: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID() };
  const app: FastifyInstance = Fastify();
  let dbm: typeof import('@desigual-os/database');
  let listA = ''; let taskA = '';
  const call = (user: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: unknown) =>
    app.inject({ method, url: path, headers: { 'x-test-user': user }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    const { db, schema } = dbm;
    const E = await import('@desigual-os/work-engine');
    users.set('admin', { id: A.admin, roles: ['colaborador'] });
    users.set('collab', { id: A.collab, roles: ['colaborador'] });
    users.set('bAdmin', { id: B.admin, roles: ['colaborador'] });
    for (const o of [A.org, B.org]) await db.insert(schema.organizations).values({ id: o, name: `P ${o.slice(0, 6)}`, slug: `p-${o}` });
    for (const [id, org, role] of [[A.admin, A.org, 'admin'], [A.collab, A.org, 'collaborator'], [B.admin, B.org, 'admin']] as const) {
      await db.insert(schema.users).values({ id, name: id.slice(0, 6), email: `${id}@p.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: org, userId: id, role });
    }
    await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.admin, A.collab], updatedBy: A.admin });
    await E.setFlag({ organizationId: B.org, enabled: true, allowedUserIds: [B.admin], updatedBy: B.admin });
    const ctx = { organizationId: A.org, userId: A.admin };
    listA = (await E.createList(ctx, { spaceId: (await E.createSpace(ctx, { name: 'S' })).id, name: 'L' })).id;
    taskA = (await E.createTask(ctx, { listId: listA, title: 'Tarefa A' })).id;
    const { registerWorkRoutes } = await import('./routes');
    await app.register(registerWorkRoutes);
    await app.ready();
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    await app.close();
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.collab, B.admin]));
  });

  const rotas = () => [
    ['GET', `/work/tasks/${taskA}/detail`], ['POST', `/work/tasks/${taskA}/comments`, { body: 'x' }], ['POST', `/work/tasks/${taskA}/checklists`, { name: 'c' }],
    ['GET', '/work/inbox'], ['GET', '/work/timer'], ['POST', `/work/tasks/${taskA}/timer/start`], ['GET', '/work/automations'], ['GET', '/work/templates'],
    ['GET', '/work/recurrences'], ['GET', '/work/reports'], ['GET', '/work/views'],
  ] as const;

  it('colaborador (não administrador) é barrado em TODAS as rotas novas', async () => {
    for (const [m, p, b] of rotas()) expect((await call('collab', m, p, b)).statusCode, `${m} ${p}`).toBe(403);
  });

  it('administrador autorizado usa todas; outra empresa recebe 404 em tudo que aponta para a tarefa', async () => {
    for (const [m, p, b] of rotas()) expect((await call('admin', m, p, b)).statusCode, `${m} ${p}`).toBeLessThan(300);
    for (const [m, p, b] of [['GET', `/work/tasks/${taskA}/detail`], ['POST', `/work/tasks/${taskA}/comments`, { body: 'x' }], ['POST', `/work/tasks/${taskA}/timer/start`], ['POST', `/work/tasks/${taskA}/checklists`, { name: 'c' }]] as const) {
      expect((await call('bAdmin', m, p, b)).statusCode, `B ${m} ${p}`).toBe(404);
    }
  });

  it('comentar, checklist e detalhe pela API', async () => {
    expect((await call('admin', 'POST', `/work/tasks/${taskA}/comments`, { body: 'oi' })).statusCode).toBe(200);
    const cl = (await call('admin', 'POST', `/work/tasks/${taskA}/checklists`, { name: 'Passos' })).json();
    const it1 = (await call('admin', 'POST', `/work/checklists/${cl.id}/items`, { text: 'um' })).json();
    expect((await call('admin', 'PATCH', `/work/checklist-items/${it1.id}`, { done: true })).statusCode).toBe(200);
    expect((await call('bAdmin', 'PATCH', `/work/checklist-items/${it1.id}`, { done: false })).statusCode).toBe(404);
    const d = (await call('admin', 'GET', `/work/tasks/${taskA}/detail`)).json();
    expect(d.comments.map((c: { body: string }) => c.body)).toContain('oi');
    expect(d.checklists.find((c: { name: string }) => c.name === 'Passos').items[0].done).toBe(true);
  });

  it('automação por API: valida, cria, lista só da empresa, e outra empresa não apaga', async () => {
    expect((await call('admin', 'POST', '/work/automations', { name: 'x', trigger: { type: 'inventado' }, actions: [{ type: 'add_tag' }] })).statusCode).toBe(400);
    const ok = await call('admin', 'POST', '/work/automations', { name: 'Tag', trigger: { type: 'task_created' }, actions: [{ type: 'add_tag', config: { tag: 'a' } }] });
    expect(ok.statusCode).toBe(200);
    const id = ok.json().id;
    expect((await call('bAdmin', 'GET', '/work/automations')).json().automations).toHaveLength(0);
    expect((await call('bAdmin', 'DELETE', `/work/automations/${id}`)).statusCode).toBe(404);
    expect((await call('admin', 'DELETE', `/work/automations/${id}`)).statusCode).toBe(200);
  });

  it('tarefa de origem externa por API é idempotente', async () => {
    const body = { provider: 'media', externalType: 'alert', externalId: 'alerta-9', listId: listA, title: 'Saldo baixo' };
    const [a, b] = [(await call('admin', 'POST', '/work/tasks/from-source', body)).json(), (await call('admin', 'POST', '/work/tasks/from-source', body)).json()];
    expect(a.task.id).toBe(b.task.id);
    expect([a.created, b.created]).toEqual([true, false]);
    const q = (await call('admin', 'GET', '/work/tasks/by-source?provider=media&type=alert&id=alerta-9')).json();
    expect(q.tasks).toHaveLength(1);
    expect((await call('bAdmin', 'GET', '/work/tasks/by-source?provider=media&type=alert&id=alerta-9')).json().tasks).toHaveLength(0);
  });

  it('edição/exclusão: colaborador barrado (403), outra empresa 404, autor edita o próprio comentário e exclusão definitiva exige arquivar', async () => {
    const c = (await call('admin', 'POST', `/work/tasks/${taskA}/comments`, { body: 'meu' })).json();
    for (const [m, p, b] of [['PATCH', `/work/comments/${c.id}`, { body: 'x' }], ['DELETE', `/work/comments/${c.id}`], ['DELETE', `/work/tasks/${taskA}`], ['POST', `/work/tasks/${taskA}/attachments`, { url: 'https://a.com/x' }], ['POST', `/work/tasks/${taskA}/dependencies`, { dependsOnId: taskA }]] as const) {
      expect((await call('collab', m, p, b)).statusCode, `colab ${m} ${p}`).toBe(403);
    }
    expect((await call('bAdmin', 'PATCH', `/work/comments/${c.id}`, { body: 'invasão' })).statusCode).toBe(404);
    expect((await call('bAdmin', 'DELETE', `/work/tasks/${taskA}`)).statusCode).toBe(404);
    expect((await call('admin', 'PATCH', `/work/comments/${c.id}`, { body: 'editado' })).statusCode).toBe(200);
    expect((await call('admin', 'DELETE', `/work/tasks/${taskA}`)).statusCode).toBe(400); // não arquivada
    expect((await call('admin', 'POST', `/work/tasks/${taskA}/attachments`, { url: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await call('admin', 'DELETE', `/work/comments/${c.id}`)).statusCode).toBe(200);
    const inbox = (await call('admin', 'GET', '/work/inbox')).json();
    expect(inbox).toHaveProperty('unreadByKind');
  });
});
