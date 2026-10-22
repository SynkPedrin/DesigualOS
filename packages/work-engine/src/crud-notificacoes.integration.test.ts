import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('CRUD, notificações, caixa unificada e automações novas × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), ana: randomUUID(), bia: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID() };
  const ctxA = { organizationId: A.org, userId: A.admin };
  const ctxAna = { organizationId: A.org, userId: A.ana };
  const ctxB = { organizationId: B.org, userId: B.admin };
  let E: typeof import('./index');
  let dbm: typeof import('@desigual-os/database');
  let spaceId = ''; let listId = ''; let list2 = '';

  const notifs = async (userId: string) => (await dbm.db.select().from(dbm.schema.notifications).where((await import('drizzle-orm')).eq(dbm.schema.notifications.userId, userId))).map((n) => n.title);

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    E = await import('./index');
    const { db, schema } = dbm;
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `CN ${o.org.slice(0, 6)}`, slug: `cn-${o.org}` });
      await db.insert(schema.users).values({ id: o.admin, name: 'Admin', email: `${o.admin}@cn.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.admin, role: 'owner' });
    }
    await db.insert(schema.users).values([{ id: A.ana, name: 'Ana', email: `${A.ana}@cn.invalid` }, { id: A.bia, name: 'Bia', email: `${A.bia}@cn.invalid` }]);
    await db.insert(schema.organizationMembers).values([{ organizationId: A.org, userId: A.ana, role: 'collaborator' }, { organizationId: A.org, userId: A.bia, role: 'collaborator' }]);
    spaceId = (await E.createSpace(ctxA, { name: 'S' })).id;
    listId = (await E.createList(ctxA, { spaceId, name: 'L1' })).id;
    list2 = (await E.createList(ctxA, { spaceId, name: 'L2' })).id;
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.ana, A.bia, B.admin]));
  });

  it('notifica só quem deve: atribuído, citado, e responsáveis/criador em comentário e status — nunca o autor', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Notificar', assigneeIds: [A.ana] });
    expect(await notifs(A.ana)).toContainEqual(expect.stringContaining('atribuiu você a'));
    expect(await notifs(A.admin)).toHaveLength(0); // quem fez não recebe
    await E.addComment(ctxA, t.id, `veja @[Bia](${A.bia})`);
    expect(await notifs(A.bia)).toContainEqual(expect.stringContaining('mencionou você'));
    expect((await notifs(A.ana)).some((x) => x.includes('comentou'))).toBe(true); // responsável
    await E.addComment(ctxAna, t.id, 'ok');
    expect((await notifs(A.admin)).some((x) => x.includes('comentou'))).toBe(true); // criador
    expect((await notifs(A.ana)).filter((x) => x.includes('comentou'))).toHaveLength(1); // Ana não se notifica
    const sts = await E.listStatuses(ctxA, spaceId);
    await E.updateTask(ctxA, t.id, { statusId: sts.find((s) => s.isFinal)!.id });
    expect((await notifs(A.ana)).some((x) => x.includes('mudou o status'))).toBe(true);
    // pessoa de outra empresa citada por id não recebe nada
    await E.addComment(ctxA, t.id, `fora @[X](${B.admin})`);
    expect(await notifs(B.admin)).toHaveLength(0);
  });

  it('comentário: só o autor edita/apaga; checklist e item editáveis e apagáveis; outra empresa 404', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'CRUD' });
    const { id: c } = await E.addComment(ctxA, t.id, 'original');
    await expect(E.editComment(ctxAna, c, 'invasão')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(E.deleteComment(ctxAna, c)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(E.editComment(ctxB, c, 'x')).rejects.toMatchObject({ code: 'not_found' });
    await E.editComment(ctxA, c, 'editado');
    expect((await E.getTaskDetail(ctxA, t.id)).comments[0]!.body).toBe('editado');
    await E.deleteComment(ctxA, c);
    expect((await E.getTaskDetail(ctxA, t.id)).comments).toHaveLength(0);

    const cl = await E.createChecklist(ctxA, t.id, 'Lista');
    const it = await E.addChecklistItem(ctxA, cl.id, 'item');
    await E.editChecklistItem(ctxA, it.id, { text: 'item 2', assigneeId: A.ana, done: true });
    await expect(E.editChecklistItem(ctxA, it.id, { assigneeId: B.admin })).rejects.toMatchObject({ code: 'invalid' });
    await expect(E.editChecklistItem(ctxB, it.id, { done: false })).rejects.toMatchObject({ code: 'not_found' });
    await E.renameChecklist(ctxA, cl.id, 'Renomeado');
    let d = await E.getTaskDetail(ctxA, t.id);
    expect(d.checklists[0]).toMatchObject({ name: 'Renomeado', items: [{ text: 'item 2', done: true }] });
    await expect(E.deleteChecklistItem(ctxB, it.id)).rejects.toMatchObject({ code: 'not_found' });
    await E.deleteChecklistItem(ctxA, it.id);
    await E.deleteChecklist(ctxA, cl.id);
    d = await E.getTaskDetail(ctxA, t.id);
    expect(d.checklists).toHaveLength(0);
  });

  it('anexo por link valida o endereço; dependência recusa ciclo e auto-referência', async () => {
    const [a, b, c] = (await Promise.all([E.createTask(ctxA, { listId, title: 'A' }), E.createTask(ctxA, { listId, title: 'B' }), E.createTask(ctxA, { listId, title: 'C' })])) as [{ id: string }, { id: string }, { id: string }];
    await expect(E.addAttachmentLink(ctxA, a.id, { url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(E.addAttachmentLink(ctxA, a.id, { url: 'não é link' })).rejects.toMatchObject({ code: 'invalid' });
    const { id } = await E.addAttachmentLink(ctxA, a.id, { url: 'https://exemplo.com/brief.pdf', fileName: 'brief.pdf' });
    expect((await E.getTaskDetail(ctxA, a.id)).attachments[0]!.fileName).toBe('brief.pdf');
    await expect(E.deleteAttachment(ctxB, id)).rejects.toMatchObject({ code: 'not_found' });
    await E.deleteAttachment(ctxA, id);

    await expect(E.addDependency(ctxA, a.id, a.id)).rejects.toMatchObject({ code: 'invalid' });
    await E.addDependency(ctxA, b.id, a.id); // B espera A
    await E.addDependency(ctxA, c.id, b.id); // C espera B
    await expect(E.addDependency(ctxA, a.id, c.id)).rejects.toMatchObject({ code: 'invalid' }); // A esperar C fecharia o ciclo
    const d = await E.getTaskDetail(ctxA, b.id);
    expect(d.blockedBy.map((x) => x!.id)).toEqual([a.id]);
    expect(d.blocking.map((x) => x!.id)).toEqual([c.id]);
    await E.removeDependency(ctxA, b.id, a.id);
    expect((await E.getTaskDetail(ctxA, b.id)).blockedBy).toHaveLength(0);
    await expect(E.addDependency(ctxB, b.id, a.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('exclusão definitiva só vale para o que JÁ está arquivado', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Excluir' });
    await expect(E.deleteTaskPermanently(ctxA, t.id)).rejects.toMatchObject({ code: 'invalid' });
    await expect(E.deleteTaskPermanently(ctxB, t.id)).rejects.toMatchObject({ code: 'not_found' });
    await E.setTaskArchived(ctxA, t.id, true);
    await E.deleteTaskPermanently(ctxA, t.id);
    await expect(E.getTask(ctxA, t.id)).rejects.toMatchObject({ code: 'not_found' });
    const l = await E.createList(ctxA, { spaceId, name: 'Temporária' });
    await expect(E.deleteContainerPermanently(ctxA, 'list', l.id)).rejects.toMatchObject({ code: 'invalid' });
    await E.setArchived(ctxA, 'list', l.id, true);
    await E.deleteContainerPermanently(ctxA, 'list', l.id);
    await expect(E.deleteContainerPermanently(ctxB, 'list', listId)).rejects.toMatchObject({ code: 'not_found' });
    const f = await E.createFolder(ctxA, { spaceId, name: 'Pasta' });
    await E.renameFolder(ctxA, f.id, 'Pasta 2');
    await expect(E.renameFolder(ctxB, f.id, 'x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lembretes: avisa uma vez só por tarefa, e não em empresa com o módulo desligado', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Vence amanhã', assigneeIds: [A.bia], dueAt: new Date(Date.now() + 5 * 3_600_000) });
    await E.setFlag({ organizationId: A.org, enabled: false, allowedUserIds: [A.admin], updatedBy: A.admin });
    await E.runDueReminders();
    expect((await notifs(A.bia)).some((x) => x.includes('Vence em breve'))).toBe(false); // módulo desligado: silêncio
    await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.admin], updatedBy: A.admin });
    await E.runDueReminders();
    await E.runDueReminders();
    expect((await notifs(A.bia)).filter((x) => x.includes('Vence em breve') && x.includes('Vence amanhã'))).toHaveLength(1);
    void t;
  });

  it('caixa unificada: mensagem não lida da Comunicação aparece; lida some; outra empresa/conversa alheia nunca', async () => {
    const { db, schema } = dbm;
    const { eq, and } = await import('drizzle-orm');
    const [conv] = await db.insert(schema.internalConversations).values({ organizationId: A.org, kind: 'channel', title: 'projetos', visibility: 'public', createdBy: A.admin }).returning();
    await db.insert(schema.internalConversationMembers).values([{ conversationId: conv!.id, userId: A.ana, organizationId: A.org }, { conversationId: conv!.id, userId: A.admin, organizationId: A.org }]);
    const [msg] = await db.insert(schema.internalMessages).values({ organizationId: A.org, conversationId: conv!.id, senderId: A.admin, content: 'Ana, olha o briefing', mentions: [A.ana], clientMessageId: randomUUID() }).returning();
    const ana = await E.listInboxUnified(ctxAna);
    const item = ana.items.find((i) => i.kind === 'communication');
    expect(item).toMatchObject({ actorName: 'Admin', subject: '#projetos', mention: true, snippet: 'Ana, olha o briefing', link: `/comunicacao?c=${conv!.id}&m=${msg!.id}` });
    expect(ana.unread.communication).toBe(1);
    // quem não é membro da conversa não vê
    expect((await E.listInboxUnified({ organizationId: A.org, userId: A.bia })).items.some((i) => i.kind === 'communication')).toBe(false);
    expect((await E.listInboxUnified(ctxB)).items.some((i) => i.kind === 'communication')).toBe(false);
    // ao ler a conversa, sai da caixa
    await db.update(schema.internalConversationMembers).set({ lastReadAt: new Date(Date.now() + 1000) }).where(and(eq(schema.internalConversationMembers.conversationId, conv!.id), eq(schema.internalConversationMembers.userId, A.ana)));
    expect((await E.listInboxUnified(ctxAna)).items.some((i) => i.kind === 'communication')).toBe(false);
  });

  it('automações novas: notificar, mover de lista, executar agora, prazo próximo (uma vez) e condição "sem responsável"', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Auto nova', assigneeIds: [A.bia] });
    const a1 = await E.createAutomation(ctxA, { name: 'Avisar e mover', listId, trigger: { type: 'task_created' }, conditions: [{ field: 'hasAssignee', op: 'eq', value: true }], actions: [{ type: 'notify', config: { target: 'assignees', message: 'Olha isso' } }, { type: 'move_to_list', config: { listId: list2 } }] });
    const r = await E.testAutomation(ctxA, a1.id, t.id);
    expect(r.status).toBe('ok');
    expect((await E.getTask(ctxA, t.id)).listId).toBe(list2);
    expect((await notifs(A.bia)).some((x) => x.startsWith('Olha isso'))).toBe(true);
    const semResp = await E.createTask(ctxA, { listId, title: 'Sem responsável' });
    expect((await E.testAutomation(ctxA, a1.id, semResp.id)).status).toBe('skipped'); // condição hasAssignee
    await expect(E.testAutomation(ctxB, a1.id, t.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.testAutomation(ctxA, a1.id, randomUUID())).rejects.toMatchObject({ code: 'not_found' });

    const a2 = await E.createAutomation(ctxA, { name: 'Prazo próximo', listId, trigger: { type: 'due_soon', config: { days: 2 } }, actions: [{ type: 'add_tag', config: { tag: 'urgente-prazo' } }] });
    const venc = await E.createTask(ctxA, { listId, title: 'Prazo chegando', dueAt: new Date(Date.now() + 36 * 3_600_000) });
    expect(await E.processDueSoonTriggers(A.org)).toBeGreaterThanOrEqual(1);
    expect((await E.getTask(ctxA, venc.id)).tags).toContain('urgente-prazo');
    const antes = (await E.listAutomationRuns(ctxA, a2.id)).length;
    await E.processDueSoonTriggers(A.org);
    expect((await E.listAutomationRuns(ctxA, a2.id)).length).toBe(antes);
  });
});
