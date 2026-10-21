import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('produtividade (caixa, tempo, campos, automações, modelos, recorrência, relatório) × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), ana: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID() };
  const ctxA = { organizationId: A.org, userId: A.admin };
  const ctxAna = { organizationId: A.org, userId: A.ana };
  const ctxB = { organizationId: B.org, userId: B.admin };
  let E: typeof import('./index');
  let spaceId = ''; let listId = ''; let doneId = ''; let initialId = '';

  beforeAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    E = await import('./index');
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `PR ${o.org.slice(0, 6)}`, slug: `pr-${o.org}` });
      await db.insert(schema.users).values({ id: o.admin, name: 'Admin', email: `${o.admin}@pr.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.admin, role: 'owner' });
    }
    await db.insert(schema.users).values({ id: A.ana, name: 'Ana', email: `${A.ana}@pr.invalid` });
    await db.insert(schema.organizationMembers).values({ organizationId: A.org, userId: A.ana, role: 'collaborator' });
    const sp = await E.createSpace(ctxA, { name: 'Esp' });
    spaceId = sp.id;
    listId = (await E.createList(ctxA, { spaceId, name: 'Lista' })).id;
    const sts = await E.listStatuses(ctxA, spaceId);
    doneId = sts.find((s) => s.isFinal)!.id;
    initialId = sts.find((s) => s.isInitial)!.id;
  });

  afterAll(async () => {
    const { db, schema } = await import('@desigual-os/database');
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.ana, B.admin]));
  });

  it('caixa de entrada: ação de OUTRA pessoa aparece, a própria não; menção chega só ao citado; marcar lido zera', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Da Ana', assigneeIds: [A.ana] });
    expect((await E.listInbox(ctxAna)).filter((i) => i.taskId === t.id && i.action === 'commented')).toHaveLength(0);
    await E.addComment(ctxA, t.id, `Oi @[Ana](${A.ana}) veja isso`);
    await E.addComment(ctxAna, t.id, 'respondi'); // própria ação: não entra na caixa dela
    const ana = await E.listInbox(ctxAna);
    expect(ana.some((i) => i.action === 'mentioned' && i.taskId === t.id)).toBe(true);
    expect(ana.filter((i) => i.action === 'commented' && i.actorName === 'Ana')).toHaveLength(0);
    expect((await E.listInbox(ctxA)).some((i) => i.action === 'mentioned')).toBe(false);
    expect(await E.inboxUnreadCount(ctxAna)).toBeGreaterThan(0);
    await E.markInboxRead(ctxAna);
    expect(await E.inboxUnreadCount(ctxAna)).toBe(0);
  });

  it('menção a quem não é da empresa é ignorada', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Menção fora' });
    await E.addComment(ctxA, t.id, `oi @[Fora](${B.admin})`);
    expect((await E.listInbox(ctxB)).some((i) => i.action === 'mentioned')).toBe(false);
  });

  it('cronômetro: um por pessoa; iniciar outro fecha o anterior; entrada manual soma', async () => {
    const t1 = await E.createTask(ctxA, { listId, title: 'T1' });
    const t2 = await E.createTask(ctxA, { listId, title: 'T2' });
    await E.startTimer(ctxA, t1.id);
    expect((await E.runningTimer(ctxA))!.taskId).toBe(t1.id);
    await E.startTimer(ctxA, t2.id);
    expect((await E.runningTimer(ctxA))!.taskId).toBe(t2.id);
    expect((await E.listTimeEntries(ctxA, t1.id)).entries[0]!.running).toBe(false);
    await E.stopTimer(ctxA);
    expect(await E.runningTimer(ctxA)).toBeNull();
    await E.addManualEntry(ctxA, t1.id, { minutes: 30 });
    expect((await E.listTimeEntries(ctxA, t1.id)).totalMs).toBeGreaterThanOrEqual(30 * 60_000);
    await expect(E.addManualEntry(ctxA, t1.id, { minutes: 0 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(E.startTimer(ctxB, t1.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('campos personalizados: valida tipo, grava, limpa e recusa campo de outro espaço/empresa', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Campos' });
    const num = await E.createCustomField(ctxA, spaceId, { name: 'Valor', fieldType: 'number' });
    const dd = await E.createCustomField(ctxA, spaceId, { name: 'Canal', fieldType: 'drop_down', options: ['Instagram', 'Google'] });
    await E.setCustomFieldValue(ctxA, t.id, num.id, 1500);
    await expect(E.setCustomFieldValue(ctxA, t.id, num.id, 'abc' as never)).rejects.toMatchObject({ code: 'invalid' });
    await expect(E.setCustomFieldValue(ctxA, t.id, dd.id, 'TikTok')).rejects.toMatchObject({ code: 'invalid' });
    await E.setCustomFieldValue(ctxA, t.id, dd.id, 'Google');
    let d = await E.getTaskDetail(ctxA, t.id);
    expect(d.customFields.map((f) => f.value).sort()).toEqual([1500, 'Google'].sort());
    expect(d.fieldDefs).toHaveLength(2);
    await E.setCustomFieldValue(ctxA, t.id, num.id, null);
    d = await E.getTaskDetail(ctxA, t.id);
    expect(d.customFields).toHaveLength(1);
    await expect(E.setCustomFieldValue(ctxB, t.id, num.id, 1)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('automação: dispara no gatilho, respeita condição, não encadeia, registra execução e isola empresas', async () => {
    const auto = await E.createAutomation(ctxA, { name: 'Concluir → comentar', listId, trigger: { type: 'status_changed', config: { toStatusId: doneId } }, conditions: [{ field: 'priority', op: 'eq', value: 1 }], actions: [{ type: 'add_comment', config: { text: 'Automação: urgente concluída' } }, { type: 'add_tag', config: { tag: 'entregue' } }] });
    await E.processAutomationEvents(A.org); // primeira passada só cria o cursor (não reexecuta o passado)
    const urgente = await E.createTask(ctxA, { listId, title: 'Urgente', priority: 1 });
    const normal = await E.createTask(ctxA, { listId, title: 'Normal', priority: 3 });
    await E.updateTask(ctxA, urgente.id, { statusId: doneId });
    await E.updateTask(ctxA, normal.id, { statusId: doneId });
    await new Promise((r) => setTimeout(r, 1300)); // o motor só lê eventos com mais de 1s (evita ler transação em curso)
    await E.processAutomationEvents(A.org);
    const dU = await E.getTaskDetail(ctxA, urgente.id);
    expect(dU.comments.map((c) => c.body)).toContain('Automação: urgente concluída');
    expect(dU.task.tags).toContain('entregue');
    expect((await E.getTaskDetail(ctxA, normal.id)).comments).toHaveLength(0); // condição não bateu
    const runs = await E.listAutomationRuns(ctxA, auto.id);
    expect(runs.map((r) => r.status).sort()).toEqual(['ok', 'skipped']);
    // não encadeia: os eventos feitos pela automação não a disparam de novo
    await new Promise((r) => setTimeout(r, 1300));
    await E.processAutomationEvents(A.org);
    const final = await E.listAutomationRuns(ctxA, auto.id);
    expect(final).toHaveLength(2);
    // outra empresa não vê nem apaga
    expect(await E.listAutomations(ctxB)).toHaveLength(0);
    await expect(E.deleteAutomation(ctxB, auto.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.listAutomationRuns(ctxB, auto.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('automação que comenta ao ser comentada NÃO entra em laço (uma execução por comentário humano)', async () => {
    const auto = await E.createAutomation(ctxA, { name: 'Eco', listId, trigger: { type: 'comment_added' }, actions: [{ type: 'add_comment', config: { text: 'eco' } }] });
    const t = await E.createTask(ctxA, { listId, title: 'Laço?' });
    await E.processAutomationEvents(A.org);
    await E.addComment(ctxA, t.id, 'um');
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 1200)); await E.processAutomationEvents(A.org); }
    expect(await E.listAutomationRuns(ctxA, auto.id)).toHaveLength(1);
    expect((await E.getTaskDetail(ctxA, t.id)).comments.map((c) => c.body)).toEqual(['um', 'eco']);
    await E.updateAutomation(ctxA, auto.id, { enabled: false });
  });

  it('automação: valida gatilho/ação e prazo vencido dispara uma vez só', async () => {
    await expect(E.createAutomation(ctxA, { name: 'x', trigger: { type: 'inventado' }, actions: [{ type: 'add_tag' }] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(E.createAutomation(ctxA, { name: 'x', trigger: { type: 'task_created' }, actions: [] })).rejects.toMatchObject({ code: 'invalid' });
    const auto = await E.createAutomation(ctxA, { name: 'Atraso', listId, trigger: { type: 'due_date_passed' }, actions: [{ type: 'set_priority', config: { priority: 1 } }] });
    const t = await E.createTask(ctxA, { listId, title: 'Vencida', dueAt: new Date(Date.now() - 86_400_000) });
    expect(await E.processOverdueTriggers(A.org)).toBeGreaterThanOrEqual(1);
    expect((await E.getTask(ctxA, t.id)).priority).toBe(1);
    const antes = (await E.listAutomationRuns(ctxA, auto.id)).length;
    await E.processOverdueTriggers(A.org);
    expect((await E.listAutomationRuns(ctxA, auto.id)).length).toBe(antes);
  });

  it('modelo e duplicação levam subtarefas e checklists; recorrência gera uma ocorrência por vez', async () => {
    const pai = await E.createTask(ctxA, { listId, title: 'Roteiro mensal', priority: 2, tags: ['conteudo'] });
    await E.createTask(ctxA, { listId, title: 'Gravar', parentTaskId: pai.id });
    const cl = await E.createChecklist(ctxA, pai.id, 'Passos');
    await E.addChecklistItem(ctxA, cl.id, 'Briefing');
    const m = await E.createTemplateFromTask(ctxA, pai.id, 'Modelo roteiro');
    const novo = await E.instantiateTemplate(ctxA, m.id, listId, { title: 'Roteiro de novembro' });
    expect(novo.title).toBe('Roteiro de novembro');
    expect(novo.priority).toBe(2);
    const d = await E.getTaskDetail(ctxA, novo.id);
    expect(d.subtaskIds).toHaveLength(1);
    expect(d.checklists[0]!.items.map((i) => i.text)).toEqual(['Briefing']);
    await expect(E.instantiateTemplate(ctxB, m.id, listId)).rejects.toMatchObject({ code: 'not_found' });
    const cp = await E.duplicateTask(ctxA, pai.id);
    expect(cp.title).toBe('Roteiro mensal (cópia)');

    const rec = await E.createRecurrence(ctxA, pai.id, { freq: 'weekly', firstRunAt: new Date(Date.now() - 1000) });
    const antes = (await E.listTasks(ctxA, { listId, q: 'Roteiro mensal' })).total;
    const [n1, n2] = [await E.runDueRecurrences(), await E.runDueRecurrences()];
    expect(n1).toBeGreaterThanOrEqual(1);
    expect(n2).toBe(0); // a mesma ocorrência não é gerada duas vezes
    expect((await E.listTasks(ctxA, { listId, q: 'Roteiro mensal' })).total).toBeGreaterThan(antes);
    await E.setRecurrenceActive(ctxA, rec.id, false);
    await expect(E.setRecurrenceActive(ctxB, rec.id, true)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('relatório: totais coerentes e sem dado de outra empresa', async () => {
    const r = await E.workReport(ctxA);
    expect((r.totais as { total: number }).total).toBeGreaterThan(5);
    expect(r.fluxo).toHaveLength(8);
    const rb = await E.workReport(ctxB);
    expect((rb.totais as { total: number }).total).toBe(0);
    void initialId;
  });
});
