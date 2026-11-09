import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

describe.skipIf(!enabled)('Daily Tasks — aprovação de tarefa × PostgreSQL real', () => {
  const A = { org: randomUUID(), ana: randomUUID(), bia: randomUUID(), caio: randomUUID() };
  const B = { org: randomUUID(), dora: randomUUID() };
  let dbm: typeof import('@desigual-os/database');
  let E: typeof import('./index');
  let taskId = '';
  const ana = { organizationId: A.org, userId: A.ana }; const bia = { organizationId: A.org, userId: A.bia }; const caio = { organizationId: A.org, userId: A.caio };
  const dora = { organizationId: B.org, userId: B.dora };

  beforeAll(async () => {
    dbm = await import('@desigual-os/database'); E = await import('./index');
    const { db, schema } = dbm;
    for (const o of [A.org, B.org]) await db.insert(schema.organizations).values({ id: o, name: `Ap ${o.slice(0, 6)}`, slug: `ap-${o}` });
    for (const [id, org, role] of [[A.ana, A.org, 'collaborator'], [A.bia, A.org, 'admin'], [A.caio, A.org, 'admin'], [B.dora, B.org, 'admin']] as const) {
      await db.insert(schema.users).values({ id, name: `U${id.slice(0, 4)}`, email: `${id}@ap.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: org, userId: id, role });
    }
    const list = (await E.createList(ana, { spaceId: (await E.createSpace(ana, { name: 'S' })).id, name: 'L' })).id;
    taskId = (await E.createTask(ana, { listId: list, title: 'Peça para aprovar' })).id;
  });
  afterAll(async () => {
    const { db, schema } = dbm; const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.ana, A.bia, A.caio, B.dora]));
  });

  it('pedir duas vezes devolve o mesmo pedido aberto; outra empresa não vê a tarefa', async () => {
    const a = await E.requestTaskApproval(ana, taskId, { approverId: A.bia, note: 'Revisar a arte' });
    expect(a.created).toBe(true);
    expect((await E.requestTaskApproval(ana, taskId)).id).toBe(a.id);
    await expect(E.requestTaskApproval(dora, taskId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.listTaskApprovals(dora, taskId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('o aprovador é avisado e a aprovação aparece na caixa dele; só ele (ou quem pediu a qualquer um) decide', async () => {
    const dele = await E.listInboxUnified(bia);
    expect(dele.items.some((i) => i.verb === 'pediu sua aprovação em')).toBe(true);
    const { db, schema } = dbm; const { and, eq } = await import('drizzle-orm');
    expect((await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, A.bia), eq(schema.notifications.type, 'work.approval_requested')))).length).toBe(1);
    const [p] = await E.listTaskApprovals(ana, taskId);
    await expect(E.resolveTaskApproval(ana, p!.id, { status: 'approved' })).rejects.toMatchObject({ code: 'invalid' }); // quem pediu
    await expect(E.resolveTaskApproval(caio, p!.id, { status: 'approved' })).rejects.toMatchObject({ code: 'invalid' }); // pedido a outra pessoa
    await expect(E.resolveTaskApproval(dora, p!.id, { status: 'approved' })).rejects.toMatchObject({ code: 'not_found' }); // outra empresa
    await expect(E.resolveTaskApproval(bia, p!.id, { status: 'rejected' })).rejects.toMatchObject({ code: 'invalid' }); // motivo obrigatório
  });

  it('pedir ajustes grava rastro, avisa quem pediu e não deixa responder de novo', async () => {
    const [p] = await E.listTaskApprovals(ana, taskId);
    expect(await E.resolveTaskApproval(bia, p!.id, { status: 'changes_requested', comment: 'Trocar a foto' })).toMatchObject({ ok: true });
    await expect(E.resolveTaskApproval(bia, p!.id, { status: 'approved' })).rejects.toMatchObject({ code: 'invalid' });
    expect((await E.listTaskApprovals(ana, taskId))[0]).toMatchObject({ status: 'changes_requested', comment: 'Trocar a foto', approverName: expect.any(String) });
    const hist = await E.getTaskHistory(ana, taskId);
    expect(JSON.stringify(hist)).toContain('pediu ajustes');
    const minha = await E.listInboxUnified(ana);
    expect(minha.items.some((i) => i.verb === 'respondeu a aprovação de')).toBe(true);
    // depois de resolvida, dá para pedir uma nova
    expect((await E.requestTaskApproval(ana, taskId)).created).toBe(true);
  });

  it('resolução pelo módulo Aprovações também deixa rastro na tarefa; id de ClickUp é ignorado', async () => {
    const [aberto] = (await E.listTaskApprovals(ana, taskId)).filter((x) => x.status === 'pending');
    const { db, schema } = dbm; const { eq } = await import('drizzle-orm');
    const [linha] = await db.update(schema.approvalRequests).set({ status: 'approved', approverId: A.caio, resolvedAt: new Date() }).where(eq(schema.approvalRequests.id, aberto!.id)).returning();
    await E.registrarResolucao(caio, linha!);
    expect(JSON.stringify(await E.getTaskHistory(ana, taskId))).toContain('aprovou');
    await expect(E.registrarResolucao(caio, { id: randomUUID(), resourceId: '86abc123', requestedBy: A.ana, status: 'approved', comment: null })).resolves.toBeUndefined();
  });
});
