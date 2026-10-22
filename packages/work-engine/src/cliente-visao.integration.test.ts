import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('cliente herdado e painel de visão × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), cli1: randomUUID(), cli2: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID(), cli: randomUUID() };
  const ctxA = { organizationId: A.org, userId: A.admin };
  const ctxB = { organizationId: B.org, userId: B.admin };
  let E: typeof import('./index');
  let spaceId = ''; let listCli1 = ''; let listLivre = '';

  beforeAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    E = await import('./index');
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `CV ${o.org.slice(0, 6)}`, slug: `cv-${o.org}` });
      await db.insert(schema.users).values({ id: o.admin, name: 'Admin', email: `${o.admin}@cv.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.admin, role: 'owner' });
    }
    await db.insert(schema.clients).values([{ id: A.cli1, name: 'Cliente 1', slug: A.cli1, organizationId: A.org }, { id: A.cli2, name: 'Cliente 2', slug: A.cli2, organizationId: A.org }, { id: B.cli, name: 'Cliente B', slug: B.cli, organizationId: B.org }]);
    spaceId = (await E.createSpace(ctxA, { name: 'S' })).id;
    listCli1 = (await E.createList(ctxA, { spaceId, name: 'Lista do cliente 1', clientId: A.cli1 })).id;
    listLivre = (await E.createList(ctxA, { spaceId, name: 'Lista livre' })).id;
  });

  afterAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, B.admin]));
  });

  it('tarefa criada na lista do cliente já nasce com o cliente; subtarefa herda da mãe sem pedir de novo', async () => {
    const t = await E.createTask(ctxA, { listId: listCli1, title: 'Mãe' });
    expect(t.clientId).toBe(A.cli1);
    const sub = await E.createTask(ctxA, { listId: listCli1, title: 'Filha', parentTaskId: t.id });
    expect(sub.clientId).toBe(A.cli1);
    // explícito vence: "sem cliente" é uma escolha possível
    expect((await E.createTask(ctxA, { listId: listCli1, title: 'Sem cliente', clientId: null })).clientId).toBeNull();
    // lista livre não inventa cliente
    expect((await E.createTask(ctxA, { listId: listLivre, title: 'Livre' })).clientId).toBeNull();
  });

  it('trocar o cliente da tarefa troca o das subtarefas (em qualquer nível)', async () => {
    const mae = await E.createTask(ctxA, { listId: listCli1, title: 'Mãe 2' });
    const filha = await E.createTask(ctxA, { listId: listCli1, title: 'Filha', parentTaskId: mae.id });
    const neta = await E.createTask(ctxA, { listId: listCli1, title: 'Neta', parentTaskId: filha.id });
    await E.updateTask(ctxA, mae.id, { clientId: A.cli2 });
    expect((await E.getTask(ctxA, filha.id)).clientId).toBe(A.cli2);
    expect((await E.getTask(ctxA, neta.id)).clientId).toBe(A.cli2);
    await expect(E.updateTask(ctxA, mae.id, { clientId: B.cli })).rejects.toMatchObject({ code: 'invalid' }); // cliente de outra empresa
  });

  it('mover para a lista de um cliente adota o cliente só se a tarefa não tinha; vincular lista a cliente por edição', async () => {
    const livre = await E.createTask(ctxA, { listId: listLivre, title: 'Vai para o cliente' });
    await E.moveTask(ctxA, livre.id, { listId: listCli1 });
    expect((await E.getTask(ctxA, livre.id)).clientId).toBe(A.cli1);
    const outra = await E.createTask(ctxA, { listId: listLivre, title: 'Já tem cliente', clientId: A.cli2 });
    await E.moveTask(ctxA, outra.id, { listId: listCli1 });
    expect((await E.getTask(ctxA, outra.id)).clientId).toBe(A.cli2);
    await E.renameList(ctxA, listLivre, { clientId: A.cli2 });
    expect((await E.createTask(ctxA, { listId: listLivre, title: 'Agora do cliente 2' })).clientId).toBe(A.cli2);
    await expect(E.renameList(ctxA, listLivre, { clientId: B.cli })).rejects.toMatchObject({ code: 'invalid' });
    const tree = await E.getTree(ctxA);
    expect(tree[0]!.lists.find((l) => l.id === listCli1)!.clientId).toBe(A.cli1);
  });

  it('painel: contagens do dia, alertas e próximas entregas, só da empresa; foco do dia é de quem pergunta', async () => {
    const hoje = new Date(); hoje.setHours(15, 0, 0, 0);
    const ontem = new Date(Date.now() - 2 * 86_400_000);
    const futuro = new Date(Date.now() + 3 * 86_400_000);
    const doHoje = await E.createTask(ctxA, { listId: listCli1, title: 'Vence hoje', dueAt: hoje, assigneeIds: [A.admin] });
    await E.createTask(ctxA, { listId: listCli1, title: 'Atrasada', dueAt: ontem });
    await E.createTask(ctxA, { listId: listCli1, title: 'Próxima', dueAt: futuro });
    const bloq = (await E.listStatuses(ctxA, spaceId)).find((s) => s.category === 'blocked');
    if (bloq) await E.createTask(ctxA, { listId: listCli1, title: 'Bloqueada', statusId: bloq.id });
    const o = await E.workOverview(ctxA);
    expect(o.contagens.hoje).toBeGreaterThanOrEqual(1);
    expect(o.contagens.atrasadas).toBeGreaterThanOrEqual(1);
    expect(o.contagens.clientesAtivos).toBeGreaterThanOrEqual(1);
    expect(o.proximasEntregas.some((p) => p.title === 'Próxima')).toBe(true);
    expect(o.focoDoDia.map((f) => f.title)).toContain('Vence hoje');
    expect((await E.workOverview(ctxA, { clientId: A.cli1 })).contagens.clientesAtivos).toBe(1);
    const ob = await E.workOverview(ctxB);
    expect(ob.contagens).toMatchObject({ hoje: 0, atrasadas: 0, bloqueadas: 0, clientesAtivos: 0 });
    expect(ob.proximasEntregas).toHaveLength(0);
    expect(ob.focoDoDia).toHaveLength(0);
    void doHoje;
  });
});
