import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Escrita de volta Daily → ClickUp contra PostgreSQL REAL e isolado. O motor do Daily, a trilha de eventos, o
 * cursor e os vínculos são de verdade; o ClickUp é simulado (cada função de escrita vira um registro de chamada).
 * Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const cu = vi.hoisted(() => ({
  chamadas: [] as Array<{ fn: string; args: unknown[]; config?: { writeScope?: { authorizedForProduction: boolean } } }>,
  falhar: null as null | (() => Error),
  membros: [] as Array<{ id: number; email: string; username: string }>,
}));
const feitasDeComentario = vi.hoisted(() => ({ n: 0 }));
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
  const registrar = (fn: string, retorno?: unknown) => async (...args: unknown[]) => {
    cu.chamadas.push({ fn, args: args.slice(1), config: args[0] as never });
    if (cu.falhar) throw cu.falhar();
    return retorno;
  };
  return {
    ...real,
    createTask: async (...args: unknown[]) => { cu.chamadas.push({ fn: 'createTask', args: args.slice(1) }); if (cu.falhar) throw cu.falhar(); return { id: 'CU-NOVA', url: 'https://app.clickup.com/t/CU-NOVA' }; },
    updateTask: registrar('updateTask'),
    addTaskTag: registrar('addTaskTag'),
    removeTaskTag: registrar('removeTaskTag'),
    createTaskComment: async (...args: unknown[]) => { cu.chamadas.push({ fn: 'createTaskComment', args: args.slice(1) }); if (cu.falhar) throw cu.falhar(); return { id: `CU-COM-${feitasDeComentario.n += 1}`, text: '', date: null }; }, // id próprio por comentário, como no ClickUp
    lerClickUpCru: async () => { throw new Error('leitura simulada: o ClickUp não foi consultado'); },
    getTeamMembers: async () => cu.membros.map((m) => ({ ...m, profilePicture: null, initials: null, color: null })),
  };
});

describe.skipIf(!enabled)('escrita Daily → ClickUp × PostgreSQL real', () => {
  const org = randomUUID();
  const admin = randomUUID();
  const colega = randomUUID();
  let E: typeof import('@desigual-os/work-engine');
  let M: typeof import('./escrita-daily');
  let dbm: typeof import('@desigual-os/database');
  let listaMapeada = '';
  let listaSoDoDaily = '';
  let statusPronto = '';
  let statusInicial = '';
  let tarefa = '';
  const ctx = () => ({ organizationId: org, userId: admin });
  const esperar = (ms = 1300) => new Promise((r) => setTimeout(r, ms));
  const feitas = (fn: string) => cu.chamadas.filter((c) => c.fn === fn);

  async function mapear(externalType: 'list' | 'task', externalId: string, entityId: string) {
    const { db, schema } = dbm;
    await db.insert(schema.workExternalMappings).values({ organizationId: org, provider: 'clickup', externalType, externalId, entityType: externalType, entityId, meta: {} });
  }

  beforeAll(async () => {
    process.env.CLICKUP_API_KEY = 'chave-de-teste';
    process.env.CLICKUP_TEAM_ID = 'TEAM';
    dbm = await import('@desigual-os/database');
    E = await import('@desigual-os/work-engine');
    M = await import('./escrita-daily');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: `ED ${org.slice(0, 6)}`, slug: `ed-${org}` });
    await db.insert(schema.users).values([
      { id: admin, name: 'Ana Admin', email: `ana-${admin}@ed.invalid`, clickupEmail: `ana-${admin}@clickup.invalid` },
      { id: colega, name: 'Caio Colega', email: `caio-${colega}@ed.invalid` },
    ]);
    await db.insert(schema.organizationMembers).values([{ organizationId: org, userId: admin, role: 'owner' }, { organizationId: org, userId: colega, role: 'collaborator' }]);
    const espaco = await E.createSpace(ctx(), { name: 'Agência' });
    listaMapeada = (await E.createList(ctx(), { spaceId: espaco.id, name: 'Cliente X' })).id;
    listaSoDoDaily = (await E.createList(ctx(), { spaceId: espaco.id, name: 'Interno' })).id;
    const { eq } = await import('drizzle-orm');
    const statuses = await db.select().from(schema.workTaskStatuses).where(eq(schema.workTaskStatuses.spaceId, espaco.id));
    statusInicial = statuses.find((s) => s.isInitial)!.id;
    statusPronto = statuses.find((s) => s.category === 'done')!.id;
    await mapear('list', 'CU-LIST', listaMapeada);
    tarefa = (await E.createTask(ctx(), { listId: listaMapeada, title: 'Peça do mês' })).id; // criada ANTES do cursor: nunca vai ao ClickUp
    await mapear('task', 'CU-T1', tarefa);
    cu.membros = [{ id: 11, email: `ana-${admin}@clickup.invalid`, username: 'Ana' }];
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(inArray(schema.users.id, [admin, colega]));
  });

  beforeEach(() => { cu.chamadas.length = 0; cu.falhar = null; M.esquecerMembrosDaEscrita(); });

  it('primeiro ciclo só marca o ponto de partida: o passado nunca é reenviado', async () => {
    const r = await M.empurrarEventosDaEmpresa(org);
    expect(r).toMatchObject({ lidos: 0, empurrados: 0 });
    await esperar();
    expect((await M.empurrarEventosDaEmpresa(org)).lidos).toBe(0); // a criação da "Peça do mês" ficou para trás
    expect(cu.chamadas).toEqual([]);
  });

  it('título, prazo e prioridade vão em UMA chamada, com o valor de agora; prazo vai como "só dia"', async () => {
    const dia = new Date('2026-11-10T15:00:00Z');
    await E.updateTask(ctx(), tarefa, { title: 'Peça de novembro', dueAt: dia, priority: 2 });
    await esperar();
    const r = await M.empurrarEventosDaEmpresa(org);
    expect(r.empurrados).toBe(1);
    expect(feitas('updateTask')).toHaveLength(1);
    expect(feitas('updateTask')[0]!.args).toEqual(['CU-T1', { name: 'Peça de novembro', dueDate: dia.getTime(), dueDateTime: false, priority: 2 }]);
  });

  it('rajada de edições do mesmo campo vira UMA escrita, com o último valor', async () => {
    await E.updateTask(ctx(), tarefa, { title: 'v1' });
    await E.updateTask(ctx(), tarefa, { title: 'v2' });
    await E.updateTask(ctx(), tarefa, { title: 'v3' });
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    expect(feitas('updateTask')).toHaveLength(1);
    expect(feitas('updateTask')[0]!.args[1]).toEqual({ name: 'v3' });
  });

  it('status vai pelo NOME do status; responsável vai por e-mail igual (sem par no ClickUp, não vai)', async () => {
    await E.updateTask(ctx(), tarefa, { statusId: statusPronto });
    await E.updateTask(ctx(), tarefa, { assigneeIds: [admin, colega] });
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const [st] = await db.select().from(schema.workTaskStatuses).where(eq(schema.workTaskStatuses.id, statusPronto));
    expect(feitas('updateTask').map((c) => c.args[1])).toEqual([{ status: st!.name }, { addAssignees: [11] }]); // o Caio não tem par no ClickUp
    cu.chamadas.length = 0;
    await E.updateTask(ctx(), tarefa, { assigneeIds: [colega] });
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    expect(feitas('updateTask').map((c) => c.args[1])).toEqual([{ removeAssignees: [11] }]);
  });

  it('o que veio do ClickUp (autor sistema) não volta para lá: sem eco, sem laço entre os dois lados', async () => {
    await E.updateTask({ ...ctx(), actorKind: 'system' }, tarefa, { title: 'Título que veio do ClickUp', statusId: statusInicial });
    await esperar();
    const r = await M.empurrarEventosDaEmpresa(org);
    expect(r.empurrados).toBe(0);
    expect(cu.chamadas).toEqual([]);
  });

  it('cerca de teste ligada (como em produção): a edição de uma PESSOA atravessa; bot de QA e agente continuam cercados', async () => {
    process.env.CLICKUP_TEST_LIST_ID = 'CU-LISTA-DE-TESTE';
    process.env.BENTO_QA_BOT_EMAIL = `caio-${colega}@ed.invalid`; // o Caio faz o papel da conta de QA
    const valvula = async () => {
      await esperar();
      cu.chamadas.length = 0;
      await M.empurrarEventosDaEmpresa(org);
      return feitas('updateTask').map((c) => c.config?.writeScope?.authorizedForProduction ?? false);
    };
    try {
      await E.updateTask(ctx(), tarefa, { title: 'Editada por gente' });
      expect(await valvula()).toEqual([true]);
      await E.updateTask({ organizationId: org, userId: colega }, tarefa, { title: 'Editada pelo bot de QA' });
      expect(await valvula()).toEqual([false]);
      await E.updateTask({ ...ctx(), actorKind: 'agent' }, tarefa, { title: 'Editada pelo agente' });
      expect(await valvula()).toEqual([false]);
      process.env.BENTO_WRITE_ALLOWLIST = 'outra-pessoa@ed.invalid'; // allowlist de emergência estreita até a pessoa
      await E.updateTask(ctx(), tarefa, { title: 'Fora da allowlist' });
      expect(await valvula()).toEqual([false]);
    } finally {
      delete process.env.CLICKUP_TEST_LIST_ID;
      delete process.env.BENTO_QA_BOT_EMAIL;
      delete process.env.BENTO_WRITE_ALLOWLIST;
    }
  }, 15_000);

  it('etiquetas: entra e sai só o que mudou', async () => {
    await E.updateTask(ctx(), tarefa, { tags: ['social', 'urgente'] });
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    expect(feitas('addTaskTag').map((c) => c.args[1]).sort()).toEqual(['social', 'urgente']);
    cu.chamadas.length = 0;
    await E.updateTask(ctx(), tarefa, { tags: ['social', 'novo'] });
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    expect(feitas('addTaskTag').map((c) => c.args[1])).toEqual(['novo']);
    expect(feitas('removeTaskTag').map((c) => c.args[1])).toEqual(['urgente']);
  });

  it('comentário sai com o nome de quem escreveu, uma vez só, e fica ligado ao do ClickUp', async () => {
    const c = await E.addComment(ctx(), tarefa, 'Pode aprovar');
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    expect(feitas('createTaskComment')).toHaveLength(1);
    expect(feitas('createTaskComment')[0]!.args).toEqual(['CU-T1', 'Ana Admin: Pode aprovar']);
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const [v] = await db.select().from(schema.workExternalMappings).where(and(eq(schema.workExternalMappings.organizationId, org), eq(schema.workExternalMappings.externalType, 'comment'), eq(schema.workExternalMappings.entityId, c.id)));
    expect(v!.externalId).toBe('CU-COM-1');
    expect(v!.meta).toMatchObject({ origem: 'daily' });
    cu.chamadas.length = 0;
    await M.empurrarEventosDaEmpresa(org);
    expect(cu.chamadas).toEqual([]);
  });

  it('tarefa nova numa lista do ClickUp é CRIADA lá, ligada pelo vínculo, com status e pai', async () => {
    const filha = await E.createTask(ctx(), { listId: listaMapeada, title: 'Subpeça', parentTaskId: tarefa, assigneeIds: [admin], dueAt: new Date('2026-11-12T15:00:00Z') });
    await E.updateTask(ctx(), filha.id, { statusId: statusPronto });
    await esperar();
    const r = await M.empurrarEventosDaEmpresa(org);
    expect(r.falhas).toBe(0);
    const criada = feitas('createTask')[0]!.args[0] as Record<string, unknown>;
    expect(criada).toMatchObject({ listId: 'CU-LIST', name: 'Subpeça', parent: 'CU-T1', assigneeId: 11, dueDateTime: false });
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const [v] = await db.select().from(schema.workExternalMappings).where(and(eq(schema.workExternalMappings.organizationId, org), eq(schema.workExternalMappings.externalType, 'task'), eq(schema.workExternalMappings.entityId, filha.id)));
    expect(v!.externalId).toBe('CU-NOVA');
    expect(v!.meta).toMatchObject({ origem: 'daily' });
    expect(feitas('updateTask').some((c) => c.args[0] === 'CU-NOVA' && (c.args[1] as Record<string, unknown>).status !== undefined)).toBe(true);
  });

  it('tarefa de uma lista que só existe no Daily não vai ao ClickUp', async () => {
    const t = await E.createTask(ctx(), { listId: listaSoDoDaily, title: 'Só interna' });
    await E.updateTask(ctx(), t.id, { title: 'Só interna 2' });
    await esperar();
    await M.empurrarEventosDaEmpresa(org);
    expect(cu.chamadas).toEqual([]);
  });

  it('falha PASSAGEIRA para a fila sem perder o evento; no ciclo seguinte ele vai', async () => {
    await E.updateTask(ctx(), tarefa, { title: 'Depois da queda' });
    await esperar();
    cu.falhar = () => new Error('ClickUp task update failed (503): indisponível');
    const r1 = await M.empurrarEventosDaEmpresa(org);
    expect(r1.paradaPor).toContain('503');
    expect(await E.temEscritaPendente(org, tarefa)).toBe(true); // a leitura do ClickUp espera, para não apagar a edição
    cu.falhar = null;
    const r2 = await M.empurrarEventosDaEmpresa(org);
    expect(r2.empurrados).toBe(1);
    expect(feitas('updateTask').at(-1)!.args[1]).toEqual({ name: 'Depois da queda' });
    expect(await E.temEscritaPendente(org, tarefa)).toBe(false);
  });

  it('a leitura do ClickUp ESPERA enquanto há edição do Daily a caminho, e segue quando a fila esvazia', async () => {
    const S = await import('./sincronia-daily');
    process.env.DAILY_SYNC_CLICKUP_ESCRITA = 'on';
    try {
      await E.updateTask(ctx(), tarefa, { title: 'Edição que não pode se perder' });
      await expect(S.sincronizarTarefaNoDaily('CU-T1')).rejects.toBeInstanceOf(S.SincroniaAdiada);
      await esperar();
      await M.empurrarEventosDaEmpresa(org);
      // Fila vazia: a leitura prossegue e só então fala com o ClickUp (aqui simulado, e falha de propósito).
      await expect(S.sincronizarTarefaNoDaily('CU-T1')).rejects.toThrow('leitura simulada');
    } finally {
      delete process.env.DAILY_SYNC_CLICKUP_ESCRITA;
    }
  });

  it('falha DEFINITIVA é registrada e pulada: um evento ruim não tranca os seguintes', async () => {
    await E.updateTask(ctx(), tarefa, { title: 'Vai falhar' });
    await esperar(1100);
    cu.falhar = () => new Error('ClickUp task update failed (400): Status does not exist');
    const r1 = await M.empurrarEventosDaEmpresa(org);
    expect(r1.falhas).toBe(1);
    expect(r1.paradaPor).toBeUndefined();
    cu.falhar = null;
    expect((await M.empurrarEventosDaEmpresa(org)).lidos).toBe(0); // o cursor andou
    expect(M.ultimasEscritas().some((x) => !x.ok && x.passageira === false)).toBe(true);
  });

  it('recuar o cursor reenvia o que foi pulado, com o valor de agora, sem repetir comentário que já saiu', async () => {
    const antes = new Date(Date.now() - 500);
    await E.addComment(ctx(), tarefa, 'Comentário que já tinha ido');
    await esperar();
    await M.empurrarEventosDaEmpresa(org); // o comentário sai e fica vinculado
    await E.updateTask(ctx(), tarefa, { title: 'Encerrada no Daily e recusada lá' });
    await esperar();
    cu.falhar = () => new Error('Escrita BLOQUEADA: fora do escopo de teste (400)');
    expect((await M.empurrarEventosDaEmpresa(org)).falhas).toBe(1); // pulada, como a cerca fazia
    cu.falhar = null;
    cu.chamadas.length = 0;
    expect(await E.recuarCursorDaSaida(org, antes)).toBe(true);
    await M.empurrarEventosDaEmpresa(org);
    expect(feitas('updateTask').map((c) => c.args)).toEqual([['CU-T1', { name: 'Encerrada no Daily e recusada lá' }]]);
    expect(feitas('createTaskComment')).toEqual([]);
    expect((await M.empurrarEventosDaEmpresa(org)).lidos).toBe(0); // e o cursor voltou ao fim
  }, 15_000);

  it('falhaPassageira distingue rede/5xx/429 de 4xx e da cerca de teste', async () => {
    const { WriteScopeError } = await import('@desigual-os/tool-gateway');
    expect(M.falhaPassageira(new Error('ClickUp não respondeu em 15s (timeout de rede)'))).toBe(true);
    expect(M.falhaPassageira(new Error('ClickUp task update failed (502): bad gateway'))).toBe(true);
    expect(M.falhaPassageira(new Error('ClickUp task update failed (429): rate'))).toBe(true);
    expect(M.falhaPassageira(new TypeError('fetch failed'))).toBe(true);
    expect(M.falhaPassageira(new Error('ClickUp task update failed (400): bad'))).toBe(false);
    expect(M.falhaPassageira(new WriteScopeError('fora do escopo', 'L', 'T'))).toBe(false);
  });

  it('paramsDosCampos: prioridade 0 limpa, estimativa vai em milissegundos', () => {
    const t = { title: 'x', description: null, priority: 0, startAt: null, dueAt: null, estimateMinutes: 90 } as unknown as Parameters<typeof M.paramsDosCampos>[0];
    expect(M.paramsDosCampos(t, ['priority', 'estimateMinutes', 'dueAt', 'description'])).toEqual({ priority: null, timeEstimate: 5_400_000, dueDate: null, dueDateTime: false, markdownDescription: '' });
  });
});
