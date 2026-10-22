import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Integração do motor contra PostgreSQL REAL e ISOLADO. Sem DATABASE_URL local o arquivo inteiro é pulado
 * (nunca roda contra algo que pareça produção). Sem mocks de banco: o que se prova aqui é o comportamento
 * do SQL de verdade (FK, unique, transação, lock).
 */
const url = process.env.DATABASE_URL ?? '';
const local = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);
const enabled = local && process.env.WORK_ENGINE_IT !== 'off';

describe.skipIf(!enabled)('work-engine × PostgreSQL real', () => {
  type Engine = typeof import('./index');
  let E: Engine;
  let dbm: typeof import('@desigual-os/database');
  const A = { org: randomUUID(), admin: randomUUID(), member: randomUUID(), client: randomUUID() };
  const B = { org: randomUUID(), admin: randomUUID(), client: randomUUID() };
  const ctxA = () => ({ organizationId: A.org, userId: A.admin });
  const ctxB = () => ({ organizationId: B.org, userId: B.admin });
  let spaceA = '';
  let listA = '';

  beforeAll(async () => {
    dbm = await import('@desigual-os/database');
    E = await import('./index');
    const { db, schema } = dbm;
    for (const o of [A, B]) {
      await db.insert(schema.organizations).values({ id: o.org, name: `WE ${o.org.slice(0, 6)}`, slug: `we-${o.org}` });
      await db.insert(schema.users).values({ id: o.admin, name: 'Admin', email: `${o.admin}@we.invalid` });
      await db.insert(schema.organizationMembers).values({ organizationId: o.org, userId: o.admin, role: 'owner' });
      await db.insert(schema.clients).values({ id: o.client, name: 'Cliente', slug: o.client, organizationId: o.org });
    }
    await db.insert(schema.users).values({ id: A.member, name: 'Membro', email: `${A.member}@we.invalid` });
    await db.insert(schema.organizationMembers).values({ organizationId: A.org, userId: A.member, role: 'collaborator' });

    const space = await E.createSpace(ctxA(), { name: 'Operação' });
    spaceA = space.id;
    listA = (await E.createList(ctxA(), { spaceId: spaceA, name: 'Entregas' })).id;
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [A.org, B.org]));
    await db.delete(schema.users).where(inArray(schema.users.id, [A.admin, A.member, B.admin]));
  });

  describe('acesso (flag + RBAC)', () => {
    it('nasce DESLIGADO: ninguém entra, nem administrador', async () => {
      const r = await E.resolveDailyTasksAccess({ organizationId: A.org, userId: A.admin, platformRoles: ['master'] });
      expect(r).toEqual({ allowed: false, reason: 'flag_off' });
    });
    it('ligado e SEM lista: todo administrador entra; quem não é administrador continua barrado', async () => {
      await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [], updatedBy: A.admin });
      expect(await E.resolveDailyTasksAccess({ organizationId: A.org, userId: A.admin, platformRoles: [] })).toEqual({ allowed: true, reason: 'ok' });
      expect(await E.resolveDailyTasksAccess({ organizationId: A.org, userId: A.member, platformRoles: ['colaborador'] })).toEqual({ allowed: false, reason: 'not_admin' });
    });
    it('com lista preenchida ela RESTRINGE: administrador fora da lista é barrado', async () => {
      await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.member], updatedBy: A.admin });
      expect(await E.resolveDailyTasksAccess({ organizationId: A.org, userId: A.admin, platformRoles: [] })).toEqual({ allowed: false, reason: 'not_allowlisted' });
      await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.admin], updatedBy: A.admin });
      expect((await E.resolveDailyTasksAccess({ organizationId: A.org, userId: A.admin, platformRoles: [] })).allowed).toBe(true);
    });
    it('estar na lista não basta: colaborador autorizado sem papel de administrador é barrado', async () => {
      await E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [A.admin, A.member], updatedBy: A.admin });
      expect(await E.resolveDailyTasksAccess({ organizationId: A.org, userId: A.member, platformRoles: ['colaborador'] })).toEqual({ allowed: false, reason: 'not_admin' });
    });
    it('a flag de uma empresa não vale para outra', async () => {
      expect((await E.resolveDailyTasksAccess({ organizationId: B.org, userId: B.admin, platformRoles: ['master'] })).allowed).toBe(false);
    });
    it('não autoriza quem não é membro da empresa', async () => {
      await expect(E.setFlag({ organizationId: A.org, enabled: true, allowedUserIds: [B.admin], updatedBy: A.admin })).rejects.toMatchObject({ code: 'invalid' });
    });
  });

  describe('hierarquia e workflow', () => {
    it('espaço novo nasce com o workflow padrão e um status inicial', async () => {
      const st = await E.listStatuses(ctxA(), spaceA);
      expect(st.map((s) => s.name)).toEqual(['A fazer', 'Em andamento', 'Revisão', 'Aguardando aprovação', 'Concluído']);
      expect(st.filter((s) => s.isInitial)).toHaveLength(1);
      expect(st.filter((s) => s.isFinal).map((s) => s.name)).toEqual(['Concluído']);
    });
    it('projeto exige cliente DA MESMA empresa', async () => {
      await expect(E.createProject(ctxA(), { spaceId: spaceA, name: 'P', clientId: B.client })).rejects.toMatchObject({ code: 'invalid' });
      const ok = await E.createProject(ctxA(), { spaceId: spaceA, name: 'Campanha', clientId: A.client });
      expect(ok.clientId).toBe(A.client);
    });
    it('lista não aceita pasta/projeto de outro espaço', async () => {
      const other = await E.createSpace(ctxA(), { name: 'Outro' });
      const folder = await E.createFolder(ctxA(), { spaceId: other.id, name: 'F' });
      await expect(E.createList(ctxA(), { spaceId: spaceA, folderId: folder.id, name: 'X' })).rejects.toMatchObject({ code: 'invalid' });
    });
    it('árvore devolve só o que é da empresa e esconde arquivados', async () => {
      const sp = await E.createSpace(ctxA(), { name: 'Para arquivar' });
      await E.setArchived(ctxA(), 'space', sp.id, true);
      expect((await E.getTree(ctxA())).some((s) => s.id === sp.id)).toBe(false);
      expect((await E.getTree(ctxA(), { includeArchived: true })).some((s) => s.id === sp.id)).toBe(true);
      expect((await E.getTree(ctxB())).length).toBe(0);
    });
  });

  describe('tarefas', () => {
    it('cria com número legível, status inicial e atividade', async () => {
      const t = await E.createTask(ctxA(), { listId: listA, title: '  Briefing do cliente  ', priority: 2, assigneeIds: [A.member], clientId: A.client, tags: ['x', 'x', ' y '] });
      expect(t.key).toBe(`DT-${t.number}`);
      expect(t.title).toBe('Briefing do cliente');
      expect(t.status?.name).toBe('A fazer');
      expect(t.assigneeIds).toEqual([A.member]);
      expect(t.tags).toEqual(['x', 'y']);
      expect(t.version).toBe(1);
      const act = await E.getTaskActivity(ctxA(), t.id);
      expect(act.map((a) => a.action)).toContain('created');
    });
    it('números são sequenciais e únicos por empresa, mesmo em criação simultânea', async () => {
      const made = await Promise.all(Array.from({ length: 12 }, (_, i) => E.createTask(ctxA(), { listId: listA, title: `Paralela ${i}` })));
      const nums = made.map((t) => t.number).sort((a, b) => a - b);
      expect(new Set(nums).size).toBe(12);
      expect(nums[nums.length - 1]! - nums[0]!).toBe(11);
    });
    it('idempotência: a mesma chave devolve a MESMA tarefa', async () => {
      const key = randomUUID();
      const first = await Promise.all(Array.from({ length: 2 }, () => E.createTask(ctxA(), { listId: listA, title: 'Uma só', idempotencyKey: key })));
      const a = first[0]!;
      const b = first[1]!;
      const c = await E.createTask(ctxA(), { listId: listA, title: 'Uma só', idempotencyKey: key });
      expect(c.id).toBe(a.id);
      expect(b.id).toBe(a.id);
      const many = await Promise.all(Array.from({ length: 6 }, () => E.createTask(ctxA(), { listId: listA, title: 'Uma só', idempotencyKey: key })));
      expect(new Set(many.map((m) => m.id))).toEqual(new Set([a.id]));
      const all = await E.listTasks(ctxA(), { listId: listA, q: 'Uma só' });
      expect(all.total).toBe(1);
    });
    it('valida: título vazio, prioridade, datas invertidas, responsável de fora', async () => {
      await expect(E.createTask(ctxA(), { listId: listA, title: '   ' })).rejects.toMatchObject({ code: 'invalid' });
      await expect(E.createTask(ctxA(), { listId: listA, title: 'x', priority: 9 })).rejects.toMatchObject({ code: 'invalid' });
      await expect(E.createTask(ctxA(), { listId: listA, title: 'x', startAt: new Date('2026-12-10'), dueAt: new Date('2026-12-01') })).rejects.toMatchObject({ code: 'invalid' });
      await expect(E.createTask(ctxA(), { listId: listA, title: 'x', assigneeIds: [B.admin] })).rejects.toMatchObject({ code: 'invalid' });
    });
    it('concluir seta completedAt e reabrir limpa', async () => {
      const st = await E.listStatuses(ctxA(), spaceA);
      const done = st.find((s) => s.isFinal)!;
      const todo = st.find((s) => s.isInitial)!;
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Concluir' });
      const d = await E.updateTask(ctxA(), t.id, { statusId: done.id });
      expect(d.completedAt).not.toBeNull();
      const r = await E.updateTask(ctxA(), t.id, { statusId: todo.id });
      expect(r.completedAt).toBeNull();
    });
    it('concorrência otimista: versão velha é recusada com a versão atual', async () => {
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Disputa' });
      await E.updateTask(ctxA(), t.id, { title: 'Pessoa 1' }, { expectedVersion: 1 });
      await expect(E.updateTask(ctxA(), t.id, { title: 'Pessoa 2' }, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', details: { currentVersion: 2 } });
      expect((await E.getTask(ctxA(), t.id)).title).toBe('Pessoa 1');
    });
    it('atualizações simultâneas sem versão não se perdem nem corrompem a versão', async () => {
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Simultâneas' });
      await Promise.all(Array.from({ length: 8 }, (_, i) => E.updateTask(ctxA(), t.id, { priority: (i % 4) + 1 })));
      const f = await E.getTask(ctxA(), t.id);
      expect(f.version).toBe(9);
    });
    it('assignees: troca registra quem entrou e quem saiu', async () => {
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Troca', assigneeIds: [A.admin] });
      const u = await E.updateTask(ctxA(), t.id, { assigneeIds: [A.member] });
      expect(u.assigneeIds).toEqual([A.member]);
      const acts = (await E.getTaskActivity(ctxA(), t.id)).map((a) => a.action);
      expect(acts).toEqual(expect.arrayContaining(['assigned', 'unassigned']));
    });
    it('filtros: por responsável, prioridade, texto e chave', async () => {
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Filtro único zeta', priority: 1, assigneeIds: [A.member] });
      expect((await E.listTasks(ctxA(), { assigneeId: A.member, q: 'zeta' })).rows.map((r) => r.id)).toEqual([t.id]);
      expect((await E.listTasks(ctxA(), { priorities: [1], q: 'zeta' })).total).toBe(1);
      expect((await E.listTasks(ctxA(), { priorities: [4], q: 'zeta' })).total).toBe(0);
      expect((await E.listTasks(ctxA(), { q: t.key })).rows[0]?.id).toBe(t.id);
      expect((await E.getTaskByKey(ctxA(), t.key.toLowerCase())).id).toBe(t.id);
    });
    it('paginação e ordenação por prazo', async () => {
      const l = (await E.createList(ctxA(), { spaceId: spaceA, name: 'Datas' })).id;
      for (const [i, d] of ['2026-11-03', '2026-11-01', '2026-11-02'].entries()) await E.createTask(ctxA(), { listId: l, title: `D${i}`, dueAt: new Date(d) });
      await E.createTask(ctxA(), { listId: l, title: 'sem prazo' });
      const r = await E.listTasks(ctxA(), { listId: l, sort: 'due', limit: 2 });
      expect(r.total).toBe(4);
      expect(r.rows.map((x) => x.title)).toEqual(['D1', 'D2']);
      expect((await E.listTasks(ctxA(), { listId: l, sort: 'due', limit: 2, offset: 2 })).rows.map((x) => x.title)).toEqual(['D0', 'sem prazo']);
    });
  });

  describe('subtarefas', () => {
    it('cria subtarefa, conta e exclui das listas de raiz', async () => {
      const p = await E.createTask(ctxA(), { listId: listA, title: 'Mãe' });
      const s = await E.createTask(ctxA(), { listId: listA, title: 'Filha', parentTaskId: p.id });
      expect(s.depth).toBe(1);
      expect((await E.getTask(ctxA(), p.id)).subtaskCount).toBe(1);
      expect((await E.listTasks(ctxA(), { listId: listA, q: 'Filha' })).total).toBe(0);
      expect((await E.listTasks(ctxA(), { parentTaskId: p.id })).rows.map((r) => r.id)).toEqual([s.id]);
    });
    it('subtarefa precisa ficar na lista da mãe', async () => {
      const other = (await E.createList(ctxA(), { spaceId: spaceA, name: 'Outra' })).id;
      const p = await E.createTask(ctxA(), { listId: listA, title: 'Mãe2' });
      await expect(E.createTask(ctxA(), { listId: other, title: 'x', parentTaskId: p.id })).rejects.toMatchObject({ code: 'invalid' });
    });
    it('respeita a profundidade máxima', async () => {
      let parent = await E.createTask(ctxA(), { listId: listA, title: 'N0' });
      for (let i = 1; i <= E.MAX_SUBTASK_DEPTH; i++) parent = await E.createTask(ctxA(), { listId: listA, title: `N${i}`, parentTaskId: parent.id });
      await expect(E.createTask(ctxA(), { listId: listA, title: 'fundo demais', parentTaskId: parent.id })).rejects.toMatchObject({ code: 'conflict' });
    });
    it('impede ciclo: mover a mãe para dentro da filha', async () => {
      const a = await E.createTask(ctxA(), { listId: listA, title: 'Ciclo A' });
      const b = await E.createTask(ctxA(), { listId: listA, title: 'Ciclo B', parentTaskId: a.id });
      const c = await E.createTask(ctxA(), { listId: listA, title: 'Ciclo C', parentTaskId: b.id });
      await expect(E.moveTask(ctxA(), a.id, { parentTaskId: c.id })).rejects.toMatchObject({ code: 'conflict' });
      await expect(E.moveTask(ctxA(), a.id, { parentTaskId: a.id })).rejects.toMatchObject({ code: 'invalid' });
    });
    it('mover leva a subárvore junto e recalcula a profundidade', async () => {
      const root = await E.createTask(ctxA(), { listId: listA, title: 'Raiz' });
      const sub = await E.createTask(ctxA(), { listId: listA, title: 'Sub', parentTaskId: root.id });
      const leaf = await E.createTask(ctxA(), { listId: listA, title: 'Folha', parentTaskId: sub.id });
      const target = await E.createTask(ctxA(), { listId: listA, title: 'Alvo' });
      await E.moveTask(ctxA(), sub.id, { parentTaskId: target.id });
      expect((await E.getTask(ctxA(), sub.id)).depth).toBe(1);
      expect((await E.getTask(ctxA(), leaf.id)).depth).toBe(2);
      expect((await E.getTask(ctxA(), root.id)).subtaskCount).toBe(0);
    });
    it('arquivar a mãe arquiva as filhas, e restaurar devolve', async () => {
      const p = await E.createTask(ctxA(), { listId: listA, title: 'Arq mãe' });
      const s = await E.createTask(ctxA(), { listId: listA, title: 'Arq filha', parentTaskId: p.id });
      await E.setTaskArchived(ctxA(), p.id, true);
      expect((await E.getTask(ctxA(), s.id)).archivedAt).not.toBeNull();
      await E.setTaskArchived(ctxA(), p.id, false);
      expect((await E.getTask(ctxA(), s.id)).archivedAt).toBeNull();
    });
  });

  describe('status personalizados', () => {
    it('não remove status em uso sem destino; migra quando há destino', async () => {
      const sp = await E.createSpace(ctxA(), { name: 'Workflow' });
      const l = (await E.createList(ctxA(), { spaceId: sp.id, name: 'L' })).id;
      const custom = await E.createStatus(ctxA(), sp.id, { name: 'Em testes', category: 'active' });
      const t = await E.createTask(ctxA(), { listId: l, title: 'T', statusId: custom.id });
      await expect(E.deleteStatus(ctxA(), custom.id)).rejects.toMatchObject({ code: 'conflict' });
      const base = (await E.listStatuses(ctxA(), sp.id)).find((s) => s.isInitial)!;
      expect(await E.deleteStatus(ctxA(), custom.id, { migrateToStatusId: base.id })).toEqual({ migratedTasks: 1 });
      expect((await E.getTask(ctxA(), t.id)).statusId).toBe(base.id);
    });
    it('não remove o status inicial', async () => {
      const init = (await E.listStatuses(ctxA(), spaceA)).find((s) => s.isInitial)!;
      await expect(E.deleteStatus(ctxA(), init.id)).rejects.toMatchObject({ code: 'conflict' });
    });
    it('fluxo restrito: só as transições cadastradas passam', async () => {
      const sp = await E.createSpace(ctxA(), { name: 'Fluxo' });
      const l = (await E.createList(ctxA(), { spaceId: sp.id, name: 'L' })).id;
      const [todo, doing, , , done] = await E.listStatuses(ctxA(), sp.id);
      await E.setTransitionsFrom(ctxA(), todo!.id, [doing!.id]);
      const t = await E.createTask(ctxA(), { listId: l, title: 'Fluxo' });
      await expect(E.updateTask(ctxA(), t.id, { statusId: done!.id })).rejects.toMatchObject({ code: 'conflict' });
      expect((await E.updateTask(ctxA(), t.id, { statusId: doing!.id })).statusId).toBe(doing!.id);
      await E.setTransitionsFrom(ctxA(), todo!.id, []);
      expect(await E.listTransitions(ctxA(), sp.id)).toEqual([]);
    });
    it('status de outro espaço é recusado na tarefa', async () => {
      const sp = await E.createSpace(ctxA(), { name: 'Outro WF' });
      const foreign = (await E.listStatuses(ctxA(), sp.id))[0]!;
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Status errado' });
      await expect(E.updateTask(ctxA(), t.id, { statusId: foreign.id })).rejects.toMatchObject({ code: 'invalid' });
    });
  });

  describe('lote', () => {
    it('devolve resultado POR tarefa: o que deu certo fica, o que falhou diz por quê', async () => {
      const t1 = await E.createTask(ctxA(), { listId: listA, title: 'Lote 1' });
      const t2 = await E.createTask(ctxA(), { listId: listA, title: 'Lote 2' });
      const res = await E.bulkUpdateTasks(ctxA(), [t1.id, randomUUID(), t2.id], { priority: 1 });
      expect(res.map((r) => r.ok)).toEqual([true, false, true]);
      expect(res[1]!.error?.code).toBe('not_found');
      expect((await E.getTask(ctxA(), t2.id)).priority).toBe(1);
    });
  });

  describe('ISOLAMENTO entre empresas', () => {
    it('empresa B não lê, altera, move, arquiva nem lista nada da A', async () => {
      const t = await E.createTask(ctxA(), { listId: listA, title: 'Segredo da A' });
      await expect(E.getTask(ctxB(), t.id)).rejects.toMatchObject({ code: 'not_found' });
      await expect(E.updateTask(ctxB(), t.id, { title: 'invadida' })).rejects.toMatchObject({ code: 'not_found' });
      await expect(E.moveTask(ctxB(), t.id, { position: 1 })).rejects.toMatchObject({ code: 'not_found' });
      await expect(E.setTaskArchived(ctxB(), t.id, true)).rejects.toMatchObject({ code: 'not_found' });
      await expect(E.getTaskActivity(ctxB(), t.id)).rejects.toMatchObject({ code: 'not_found' });
      expect((await E.listTasks(ctxB(), { q: 'Segredo' })).total).toBe(0);
      expect((await E.getTask(ctxA(), t.id)).title).toBe('Segredo da A');
    });
    it('B não cria tarefa em lista da A, nem usa status ou espaço da A', async () => {
      await expect(E.createTask(ctxB(), { listId: listA, title: 'cruzada' })).rejects.toMatchObject({ code: 'not_found' });
      await expect(E.createList(ctxB(), { spaceId: spaceA, name: 'x' })).rejects.toMatchObject({ code: 'not_found' });
      const st = (await E.listStatuses(ctxA(), spaceA))[0]!;
      await expect(E.deleteStatus(ctxB(), st.id)).rejects.toMatchObject({ code: 'not_found' });
      expect(await E.listStatuses(ctxB(), spaceA)).toEqual([]);
    });
    it('o contador de número é independente por empresa', async () => {
      const sB = await E.createSpace(ctxB(), { name: 'B' });
      const lB = (await E.createList(ctxB(), { spaceId: sB.id, name: 'B' })).id;
      const t = await E.createTask(ctxB(), { listId: lB, title: 'primeira da B' });
      expect(t.number).toBe(1);
    });
    it('idempotência não vaza entre empresas', async () => {
      const key = randomUUID();
      const a = await E.createTask(ctxA(), { listId: listA, title: 'K', idempotencyKey: key });
      const sB = await E.createSpace(ctxB(), { name: 'B2' });
      const lB = (await E.createList(ctxB(), { spaceId: sB.id, name: 'B2' })).id;
      const b = await E.createTask(ctxB(), { listId: lB, title: 'K', idempotencyKey: key });
      expect(b.id).not.toBe(a.id);
    });
  });
});
