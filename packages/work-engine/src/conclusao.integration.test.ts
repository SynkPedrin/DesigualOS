import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

describe.skipIf(!enabled)('Conclusão de tarefa × PostgreSQL real', () => {
  const A = { org: randomUUID(), user: randomUUID() };
  let dbm: typeof import('@desigual-os/database'); let E: typeof import('./index');
  const ctx = { organizationId: A.org, userId: A.user };
  let space = ''; let list = ''; let pronto = ''; let encerrado = ''; let aberto = '';

  beforeAll(async () => {
    dbm = await import('@desigual-os/database'); E = await import('./index');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: A.org, name: 'Conc', slug: `conc-${A.org}` });
    await db.insert(schema.users).values({ id: A.user, name: 'U', email: `${A.user}@c.invalid` });
    await db.insert(schema.organizationMembers).values({ organizationId: A.org, userId: A.user, role: 'owner' });
    space = (await E.createSpace(ctx, { name: 'S' })).id; list = (await E.createList(ctx, { spaceId: space, name: 'L' })).id;
    pronto = (await E.createStatus(ctx, space, { name: 'pronto', category: 'done' })).id;
    encerrado = (await E.createStatus(ctx, space, { name: 'encerrado', category: 'done' })).id;
    aberto = (await E.listStatuses(ctx, space)).find((s) => s.isInitial)!.id;
  });
  afterAll(async () => {
    const { db, schema } = dbm; const { eq } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(eq(schema.organizations.id, A.org));
    await db.delete(schema.users).where(eq(schema.users.id, A.user));
  });

  it('pronto → encerrado mantém a data em que ficou pronta; reabrir apaga; concluir de novo data de novo', async () => {
    const t = await E.createTask(ctx, { listId: list, title: 'Peça' });
    const p = await E.updateTask(ctx, t.id, { statusId: pronto });
    expect(p.completedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 25));
    const e = await E.updateTask(ctx, t.id, { statusId: encerrado });
    expect(e.completedAt).toBe(p.completedAt);
    const r = await E.updateTask(ctx, t.id, { statusId: aberto });
    expect(r.completedAt).toBeNull();
    const de = await E.updateTask(ctx, t.id, { statusId: encerrado });
    expect(de.completedAt).not.toBeNull();
    expect(de.completedAt).not.toBe(p.completedAt);
  });

  it('apagar um status final migrando para outro final também mantém a data', async () => {
    const t = await E.createTask(ctx, { listId: list, title: 'Peça 2' });
    const antes = (await E.updateTask(ctx, t.id, { statusId: pronto })).completedAt;
    await new Promise((r) => setTimeout(r, 25));
    await E.deleteStatus(ctx, pronto, { migrateToStatusId: encerrado });
    const depois = await E.getTask(ctx, t.id);
    expect(depois.status?.name).toBe('encerrado');
    expect(depois.completedAt).toBe(antes);
  });

  it('painel: Foco do dia conclui em "encerrado" e reabre em "aberto"; conta prontas não encerradas e concluídas com subtarefa aberta', async () => {
    const aberto2 = (await E.createStatus(ctx, space, { name: 'aberto', category: 'todo' })).id;
    const pronto2 = (await E.createStatus(ctx, space, { name: 'pronto', category: 'done' })).id;
    const hoje = new Date(); hoje.setHours(15, 0, 0, 0);
    const foco = await E.createTask(ctx, { listId: list, title: 'Vence hoje', dueAt: hoje, assigneeIds: [A.user] });
    const mae = await E.createTask(ctx, { listId: list, title: 'Mãe' });
    await E.createTask(ctx, { listId: list, title: 'Filha aberta', parentTaskId: mae.id });
    await E.updateTask(ctx, mae.id, { statusId: encerrado });
    const pr = await E.createTask(ctx, { listId: list, title: 'Entregue' });
    await E.updateTask(ctx, pr.id, { statusId: pronto2 });
    const o = await E.workOverview(ctx, { listId: list });
    expect(o.contagens.prontasSemEncerrar).toBe(1);
    expect(o.contagens.concluidasComSubtarefaAberta).toBe(1);
    const f = o.focoDoDia.find((x) => x.id === foco.id)!;
    expect(f.finalId).toBe(encerrado);
    expect(f.initialId).toBe(aberto2);
  });
});
