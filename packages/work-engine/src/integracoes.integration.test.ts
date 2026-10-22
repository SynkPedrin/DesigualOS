import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('integrações (origem externa, cliente, agentes) × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), colab: randomUUID(), client: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID(), client: randomUUID() };
  const ctxA = { organizationId: A.org, userId: A.admin };
  const ctxColab = { organizationId: A.org, userId: A.colab };
  const ctxB = { organizationId: B.org, userId: B.admin };
  let E: typeof import('./index');
  let listId = '';

  beforeAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    E = await import('./index');
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `IN ${o.org.slice(0, 6)}`, slug: `in-${o.org}` });
      await db.insert(schema.users).values({ id: o.admin, name: 'Admin', email: `${o.admin}@in.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.admin, role: 'owner' });
      await db.insert(schema.clients).values({ id: o.client, name: 'Cliente', slug: o.client, organizationId: o.org });
    }
    await db.insert(schema.users).values({ id: A.colab, name: 'Colab', email: `${A.colab}@in.invalid` });
    await db.insert(schema.organizationMembers).values({ organizationId: A.org, userId: A.colab, role: 'collaborator' });
    listId = (await E.createList(ctxA, { spaceId: (await E.createSpace(ctxA, { name: 'S' })).id, name: 'L' })).id;
    await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.admin, A.colab], updatedBy: A.admin });
  });

  afterAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.colab, B.admin]));
  });

  it('tarefa de origem externa é idempotente, inclusive em chamadas simultâneas', async () => {
    const mk = () => E.createTaskFromSource(ctxA, { provider: 'communication', externalType: 'message', externalId: 'msg-1', listId, title: 'Responder cliente', clientId: A.client });
    const rs = await Promise.all([mk(), mk(), mk()]);
    expect(new Set(rs.map((r) => r.task.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect((await E.findTasksBySource(ctxA, 'communication', 'message', 'msg-1')).map((t) => t.id)).toEqual([rs[0]!.task.id]);
    expect(await E.findTasksBySource(ctxB, 'communication', 'message', 'msg-1')).toHaveLength(0); // outra empresa não enxerga
    await expect(E.createTaskFromSource(ctxA, { provider: 'inventada', externalType: 'x', externalId: '1', listId, title: 't' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('resumo por cliente conta só o que é da empresa', async () => {
    await E.createTask(ctxA, { listId, title: 'Atrasada', clientId: A.client, dueAt: new Date(Date.now() - 86_400_000) });
    const r = await E.clientWorkSummary(ctxA, A.client);
    expect(r.abertas).toBeGreaterThanOrEqual(2);
    expect(r.atrasadas).toBeGreaterThanOrEqual(1);
    await expect(E.clientWorkSummary(ctxB, A.client)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('agente: usa o acesso da pessoa, grava como agente e é barrado se a pessoa não tem acesso', async () => {
    const t = await E.workTools.createTask(ctxA, [], { listId, title: 'Criada pelo agente' });
    const ev = await E.getTaskActivity(ctxA, t.id);
    expect(ev.find((e) => e.action === 'created')!.actorKind).toBe('agent');
    expect((await E.workTools.listTasks(ctxA, [], { q: 'agente' })).tasks.map((x) => x.title)).toContain('Criada pelo agente');
    await E.workTools.comment(ctxA, [], t.id, 'feito pelo agente');
    expect((await E.getTaskDetail(ctxA, t.id)).comments[0]!.body).toBe('feito pelo agente');
    // colaborador comum (não admin), mesmo liberado na lista: o portão exige administrador
    await expect(E.workTools.createTask(ctxColab, [], { listId, title: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    // flag desligada vale até para master
    await E.setFlag({ organizationId: A.org, enabled: false, allowedUserIds: [A.admin], updatedBy: A.admin });
    await expect(E.workTools.listTasks(ctxA, ['master'])).rejects.toMatchObject({ code: 'forbidden' });
  });
});
