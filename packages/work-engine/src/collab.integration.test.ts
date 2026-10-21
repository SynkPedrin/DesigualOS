import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('colaboração (comentários, checklists, detalhe) × PostgreSQL real', () => {
  const A = { org: randomUUID(), user: randomUUID() };
  const B = { org: randomUUID(), user: randomUUID() };
  const ctxA = { organizationId: A.org, userId: A.user };
  const ctxB = { organizationId: B.org, userId: B.user };
  let taskId = '';

  beforeAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    const E = await import('./index');
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `CB ${o.org.slice(0, 6)}`, slug: `cb-${o.org}` });
      await db.insert(schema.users).values({ id: o.user, name: 'Pessoa', email: `${o.user}@cb.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.user, role: 'owner' });
    }
    const space = await E.createSpace(ctxA, { name: 'E' });
    const list = await E.createList(ctxA, { spaceId: space.id, name: 'L' });
    taskId = (await E.createTask(ctxA, { listId: list.id, title: 'Tarefa' })).id;
  });

  afterAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.user, B.user]));
  });

  it('comenta, monta checklist, marca item e devolve tudo no detalhe', async () => {
    const E = await import('./index');
    await E.addComment(ctxA, taskId, '  Primeiro comentário  ');
    const cl = await E.createChecklist(ctxA, taskId, 'Roteiro');
    const item = await E.addChecklistItem(ctxA, cl.id, 'Gravar');
    await E.setChecklistItemDone(ctxA, item.id, true);
    const d = await E.getTaskDetail(ctxA, taskId);
    expect(d.comments.map((c) => c.body)).toEqual(['Primeiro comentário']);
    expect(d.checklists[0]!.items[0]).toMatchObject({ text: 'Gravar', done: true });
    const hist = await E.getTaskActivity(ctxA, taskId);
    expect(hist.some((e) => e.action === 'commented')).toBe(true);
  });

  it('recusa comentário vazio', async () => {
    const E = await import('./index');
    await expect(E.addComment(ctxA, taskId, '   ')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('outra empresa não vê, não comenta e não mexe na checklist (404)', async () => {
    const E = await import('./index');
    const d = await E.getTaskDetail(ctxA, taskId);
    await expect(E.getTaskDetail(ctxB, taskId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.addComment(ctxB, taskId, 'invasão')).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.createChecklist(ctxB, taskId, 'x')).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.addChecklistItem(ctxB, d.checklists[0]!.id, 'x')).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.setChecklistItemDone(ctxB, d.checklists[0]!.items[0]!.id, false)).rejects.toMatchObject({ code: 'not_found' });
    expect((await E.getTaskDetail(ctxA, taskId)).checklists[0]!.items[0]!.done).toBe(true);
  });
});
