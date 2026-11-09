import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url) && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('histórico, seguidores, preferências e filtros × PostgreSQL real', () => {
  const A = { org: randomUUID(), admin: randomUUID(), ana: randomUUID(), bia: randomUUID(), cli: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID() };
  const ctxA = { organizationId: A.org, userId: A.admin };
  const ctxAna = { organizationId: A.org, userId: A.ana };
  const ctxBia = { organizationId: A.org, userId: A.bia };
  const ctxB = { organizationId: B.org, userId: B.admin };
  let E: typeof import('./index');
  let dbm: typeof import('@desigual-os/database');
  let spaceId = ''; let listId = ''; let list2 = '';

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    E = await import('./index');
    const { db, schema } = dbm;
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `HP ${o.org.slice(0, 6)}`, slug: `hp-${o.org}` });
      await db.insert(schema.users).values({ id: o.admin, name: o === A ? 'Admin' : 'AdminB', email: `${o.admin}@hp.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.admin, role: 'owner' });
    }
    await db.insert(schema.users).values([{ id: A.ana, name: 'Ana', email: `${A.ana}@hp.invalid` }, { id: A.bia, name: 'Bia', email: `${A.bia}@hp.invalid` }]);
    await db.insert(schema.organizationMembers).values([{ organizationId: A.org, userId: A.ana, role: 'collaborator' }, { organizationId: A.org, userId: A.bia, role: 'collaborator' }]);
    await db.insert(schema.clients).values({ id: A.cli, name: 'Cliente Z', slug: A.cli, organizationId: A.org });
    spaceId = (await E.createSpace(ctxA, { name: 'S' })).id;
    listId = (await E.createList(ctxA, { spaceId, name: 'Lista 1' })).id;
    list2 = (await E.createList(ctxA, { spaceId, name: 'Lista 2' })).id;
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.ana, A.bia, B.admin]));
  });

  it('histórico conta a história com nomes, em ordem do mais novo ao mais antigo', async () => {
    const t = await E.createTask(ctxA, { listId, title: 'Peça do mês' });
    const sts = await E.listStatuses(ctxA, spaceId);
    const final = sts.find((s) => s.isFinal)!;
    await E.updateTask(ctxA, t.id, { assigneeIds: [A.ana] });
    await E.updateTask(ctxA, t.id, { priority: 1, title: 'Peça do mês (v2)', dueAt: new Date('2026-12-10T15:00:00Z'), clientId: A.cli, tags: ['urgente'] });
    await E.updateTask(ctxA, t.id, { statusId: final.id });
    await E.moveTask(ctxA, t.id, { listId: list2 });
    await E.addComment(ctxAna, t.id, `oi @[Bia](${A.bia})`);
    const h = await E.getTaskHistory(ctxA, t.id);
    const textos = h.map((x) => `${x.actorName}: ${x.texto}`);
    expect(textos.some((x) => x === 'Admin: criou a tarefa')).toBe(true);
    expect(textos.some((x) => x === 'Admin: atribuiu a tarefa a Ana')).toBe(true);
    expect(textos.some((x) => x.includes('mudou a prioridade de sem prioridade para urgente'))).toBe(true);
    expect(textos.some((x) => x.includes('renomeou a tarefa de “Peça do mês” para “Peça do mês (v2)”'))).toBe(true);
    expect(textos.some((x) => x.includes('mudou o prazo de sem data para'))).toBe(true);
    expect(textos.some((x) => x.includes('mudou o cliente de nenhum para Cliente Z'))).toBe(true);
    expect(textos.some((x) => x.includes('alterou as tags (+urgente)'))).toBe(true);
    expect(textos.some((x) => x.includes(`mudou o status de “${sts.find((s) => s.isInitial)!.name}” para “${final.name}”`))).toBe(true);
    expect(textos.some((x) => x.includes('moveu a tarefa de “Lista 1” para “Lista 2”'))).toBe(true);
    expect(textos.some((x) => x === 'Ana: comentou')).toBe(true);
    expect(textos.some((x) => x === 'Ana: mencionou Bia')).toBe(true);
    expect(h.every((x, i, a) => i === 0 || a[i - 1]!.createdAt >= x.createdAt)).toBe(true);
    await expect(E.getTaskHistory(ctxB, t.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('seguir: recebe aviso de comentário sem ser responsável; deixar de seguir silencia; quem comenta/é citado passa a seguir', async () => {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const avisos = async (u: string) => (await db.select().from(schema.notifications).where(eq(schema.notifications.userId, u))).map((n) => n.title);
    const t = await E.createTask(ctxA, { listId, title: 'Acompanhada' });
    await E.followTask(ctxBia, t.id);
    await E.addComment(ctxA, t.id, 'novidade');
    expect((await avisos(A.bia)).some((x) => x.includes('comentou em'))).toBe(true);
    const antes = (await avisos(A.bia)).length;
    await E.unfollowTask(ctxBia, t.id);
    await E.addComment(ctxA, t.id, 'outra novidade');
    expect((await avisos(A.bia)).length).toBe(antes);
    // comentar = seguir
    await E.addComment(ctxAna, t.id, `chamando @[Bia](${A.bia})`);
    const d = await E.getTaskDetail(ctxA, t.id);
    expect(d.followers.map((f) => f.name).sort()).toEqual(['Admin', 'Ana', 'Bia']);
    expect((await E.getTaskDetail(ctxAna, t.id)).following).toBe(true);
    await expect(E.followTask(ctxB, t.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(E.followTask(ctxA, t.id, B.admin)).rejects.toMatchObject({ code: 'invalid' }); // fora da empresa
  });

  it('filtros novos: criadas por mim, que eu sigo, por tag, sem prazo e sem responsável', async () => {
    const mk = (ctx: typeof ctxA, title: string, extra: Record<string, unknown> = {}) => E.createTask(ctx, { listId: list2, title, ...extra } as never);
    const a = await mk(ctxAna, 'Da Ana', { tags: ['marca'], dueAt: new Date(Date.now() + 86_400_000), assigneeIds: [A.ana] });
    const b = await mk(ctxA, 'Do Admin sem nada');
    await E.followTask(ctxBia, b.id);
    const ids = async (f: Parameters<typeof E.listTasks>[1]) => (await E.listTasks(ctxA, { listId: list2, ...f })).rows.map((r) => r.id);
    expect(await ids({ createdBy: A.ana })).toContain(a.id);
    expect(await ids({ createdBy: A.ana })).not.toContain(b.id);
    expect(await ids({ followerId: A.bia })).toContain(b.id);
    expect(await ids({ followerId: A.bia })).not.toContain(a.id);
    expect(await ids({ tag: 'marca' })).toEqual([a.id]);
    expect(await ids({ dueNone: true })).toContain(b.id);
    expect(await ids({ dueNone: true })).not.toContain(a.id);
    expect(await ids({ unassigned: true })).toContain(b.id);
    expect(await ids({ unassigned: true })).not.toContain(a.id);
    expect((await E.listTasks(ctxB, { createdBy: A.ana })).rows).toHaveLength(0);
  });

  it('preferências são de cada pessoa, validadas e com padrão', async () => {
    expect(await E.getPreferences(ctxA)).toEqual(E.PREFERENCIAS_PADRAO);
    const p = await E.setPreferences(ctxAna, { colunas: ['responsavel', 'prazo', 'cliente'], densidade: 'compacta', agrupar: true, visaoPadrao: 'quadro' });
    expect(p).toMatchObject({ colunas: ['responsavel', 'prazo', 'cliente'], densidade: 'compacta', agrupar: true, visaoPadrao: 'quadro' });
    expect((await E.getPreferences(ctxAna)).densidade).toBe('compacta');
    expect((await E.getPreferences(ctxA)).densidade).toBe('confortavel'); // a de outra pessoa não muda
    await expect(E.setPreferences(ctxAna, { colunas: ['inventada' as never] })).rejects.toMatchObject({ code: 'invalid' });
    expect((await E.setPreferences(ctxAna, { mostrarConcluidas: true })).colunas).toEqual(['responsavel', 'prazo', 'cliente']); // mesclar, não zerar
  });
});
