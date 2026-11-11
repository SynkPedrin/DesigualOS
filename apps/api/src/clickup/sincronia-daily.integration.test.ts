import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Sincronia ClickUp → Daily Tasks contra PostgreSQL REAL e isolado. O ClickUp é simulado (um objeto que responde
 * pelos mesmos caminhos da API v2); o banco, o importador e os vínculos são de verdade. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const clickup = vi.hoisted(() => ({ respostas: new Map<string, unknown>(), chamadas: [] as string[], pendurar: new Set<string>() }));
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
  return {
    ...real,
    lerClickUpCru: async (_config: unknown, caminho: string) => {
      clickup.chamadas.push(caminho);
      const chave = caminho.split('?')[0]!;
      if (clickup.pendurar.has(chave)) return new Promise(() => {}); // nunca responde: a consulta pendurada de produção
      if (!clickup.respostas.has(chave)) throw new real.ClickUpHttpError(404, chave, 'not found');
      return clickup.respostas.get(chave);
    },
  };
});

// Sem Redis no teste: o marco da varredura fica em memória (o mesmo caminho de quando o Redis cai em produção).
vi.mock('@desigual-os/orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@desigual-os/orchestrator')>()),
  getRedisConnection: () => { throw new Error('sem Redis no teste'); },
}));

describe.skipIf(!enabled)('sincronia ClickUp → Daily × PostgreSQL real', () => {
  const org = randomUUID();
  const clienteId = randomUUID();
  const ana = randomUUID();
  const bia = randomUUID();
  let M: typeof import('./sincronia-daily');
  let dbm: typeof import('@desigual-os/database');

  const membros = [
    { user: { id: 1, username: 'Ana', email: `ana-${ana}@sd.invalid` } },
    { user: { id: 2, username: 'Bia', email: `bia-${bia}@sd.invalid` } },
  ];
  const lista = { id: 'L1', name: 'Cliente Sync', content: null, folder: { id: 'F1', name: 'Clientes', hidden: false }, space: { id: 'S1' } };
  const espaco = { id: 'S1', name: 'Agência', color: '#fff', statuses: [{ status: 'aberto', type: 'open', color: '#111' }, { status: 'em aprovação', type: 'custom', color: '#a0f' }, { status: 'feito', type: 'closed', color: '#222' }] };
  const tarefa = (extra: Record<string, unknown> = {}) => ({
    id: 'T1', name: 'Arte do dia das crianças', list: { id: 'L1' }, space: { id: 'S1' }, folder: { id: 'F1' },
    status: { status: 'aberto', type: 'open', color: '#111' }, priority: { id: '2' }, date_created: '1700000000000',
    assignees: [{ id: 1, email: `ana-${ana}@sd.invalid` }, { id: 2, email: `bia-${bia}@sd.invalid` }],
    checklists: [], dependencies: [], tags: [{ name: 'social' }], attachments: [], ...extra,
  });
  const comentario = (id: string, texto: string) => ({ id, comment_text: texto, comment: [{ text: texto, attributes: {} }], user: { id: 1, email: `ana-${ana}@sd.invalid`, username: 'Ana' }, date: '1700000005000' });

  function servir(t: Record<string, unknown> | null, comentarios: unknown[] = []) {
    clickup.respostas.clear();
    clickup.respostas.set('/team/TEAM', { team: { members: membros } });
    clickup.respostas.set('/list/L1', lista);
    clickup.respostas.set('/space/S1', espaco);
    clickup.respostas.set('/list/L1/field', { fields: [] });
    if (t) {
      clickup.respostas.set(`/task/${String(t.id)}`, t);
      clickup.respostas.set(`/task/${String(t.id)}/comment`, { comments: comentarios });
    }
  }

  beforeAll(async () => {
    process.env.CLICKUP_API_KEY = 'chave-de-teste';
    process.env.CLICKUP_TEAM_ID = 'TEAM';
    process.env.DAILY_SYNC_PRAZO_TAREFA_MS = '3000'; // lido ao carregar o módulo; o padrão de produção é 2 min
    dbm = await import('@desigual-os/database');
    M = await import('./sincronia-daily');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: `SD ${org.slice(0, 6)}`, slug: `sd-${org}` });
    await db.insert(schema.users).values([{ id: ana, name: 'Ana', email: `ana-${ana}@sd.invalid` }, { id: bia, name: 'Bia', email: `bia-${bia}@sd.invalid` }]);
    await db.insert(schema.clients).values({ id: clienteId, name: 'Cliente Sync', slug: clienteId, organizationId: org, clickupListId: 'L1' });
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    await db.delete(schema.clients).where(eq(schema.clients.id, clienteId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(inArray(schema.users.id, [ana, bia]));
  });

  beforeEach(() => { M.esquecerEstruturaDoClickUp(); clickup.chamadas.length = 0; });

  async function daily() {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const tasks = await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org));
    return tasks;
  }

  it('tarefa nova no ClickUp aparece no Daily, com cliente, responsáveis, status e comentário', async () => {
    servir(tarefa(), [comentario('c1', 'Pode seguir')]);
    const r = await M.sincronizarTarefaNoDaily('T1');
    expect(r.acao).toBe('sincronizada');
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const [t] = await daily();
    expect(t!.title).toBe('Arte do dia das crianças');
    expect(t!.clientId).toBe(clienteId);
    expect(t!.priority).toBe(2);
    expect(t!.tags).toEqual(['social']);
    const asg = await db.select().from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, t!.id));
    expect(asg.map((a) => a.userId).sort()).toEqual([ana, bia].sort());
    const cms = await db.select().from(schema.workComments).where(eq(schema.workComments.taskId, t!.id));
    expect(cms.map((c) => c.body)).toEqual(['Pode seguir']);
  });

  it('mudou no ClickUp (status, responsável, comentário apagado): o Daily acompanha, sem duplicar', async () => {
    servir(tarefa({ status: { status: 'em aprovação', type: 'custom', color: '#a0f' }, assignees: [{ id: 2, email: `bia-${bia}@sd.invalid` }] }), []);
    const r = await M.sincronizarTarefaNoDaily('T1');
    expect(r.acao).toBe('sincronizada');
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const tasks = await daily();
    expect(tasks).toHaveLength(1);
    const [st] = await db.select().from(schema.workTaskStatuses).where(eq(schema.workTaskStatuses.id, tasks[0]!.statusId));
    expect(st!.name).toBe('em aprovação');
    const asg = await db.select().from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, tasks[0]!.id));
    expect(asg.map((a) => a.userId)).toEqual([bia]);
    expect(await db.select().from(schema.workComments).where(eq(schema.workComments.taskId, tasks[0]!.id))).toHaveLength(0);
  });

  it('tarefa atribuída pelo ClickUp avisa no sino SÓ quem entrou nela, uma vez (03/11/2026)', async () => {
    const { db, schema } = dbm;
    const { and, asc, eq, inArray } = await import('drizzle-orm');
    const avisos = () => db.select().from(schema.notifications).where(and(inArray(schema.notifications.userId, [ana, bia]), eq(schema.notifications.type, 'work.clickup.assigned'))).orderBy(asc(schema.notifications.createdAt));
    const antes = (await avisos()).length;
    // Estado anterior: só a Bia. O ClickUp põe a Ana de volta.
    servir(tarefa({ status: { status: 'em aprovação', type: 'custom', color: '#a0f' } }), []);
    await M.sincronizarTarefaNoDaily('T1');
    const novos = (await avisos()).slice(antes);
    expect(novos.map((n) => n.userId)).toEqual([ana]);
    // Sem autor no webhook: a frase não inventa quem atribuiu, mas diz a origem.
    expect(novos[0]!.title).toMatch(/^ClickUp · Tarefa atribuída a você: DT-\d+ Arte do dia das crianças$/);
    expect(novos[0]!.link).toMatch(/^\/daily-tasks\?task=/);
    // A mesma tarefa sincronizada de novo, sem mudança de responsável: ninguém é avisado outra vez.
    await M.sincronizarTarefaNoDaily('T1');
    expect((await avisos()).length).toBe(antes + 1);
  });

  it('só lê o ClickUp: nenhuma chamada que não seja GET de leitura, e a lista/o espaço vêm do cache na segunda vez', async () => {
    servir(tarefa(), []);
    await M.sincronizarTarefaNoDaily('T1');
    const primeira = clickup.chamadas.length;
    clickup.chamadas.length = 0;
    await M.sincronizarTarefaNoDaily('T1');
    expect(clickup.chamadas.length).toBeLessThan(primeira); // estrutura em cache: sobra a tarefa e os comentários
    expect(clickup.chamadas.every((c) => c.startsWith('/'))).toBe(true);
  });

  it('subtarefa cujo pai ainda não existe aqui: o pai entra primeiro e a filha fica pendurada nele', async () => {
    servir(tarefa({ id: 'PAI', name: 'Campanha' }), []);
    clickup.respostas.set('/task/FILHA', tarefa({ id: 'FILHA', name: 'Peça 1', parent: 'PAI' }));
    clickup.respostas.set('/task/FILHA/comment', { comments: [] });
    const r = await M.sincronizarTarefaNoDaily('FILHA');
    expect(r.acao).toBe('sincronizada');
    const tasks = await daily();
    const pai = tasks.find((t) => t.title === 'Campanha')!;
    const filha = tasks.find((t) => t.title === 'Peça 1')!;
    expect(filha.parentTaskId).toBe(pai.id);
    expect(filha.depth).toBe(1);
  });

  it('tarefa apagada no ClickUp é ARQUIVADA aqui, não apagada (evento de exclusão e 404 valem igual)', async () => {
    servir(null);
    expect((await M.sincronizarTarefaNoDaily('T1', { apagada: true })).acao).toBe('arquivada');
    let t = (await daily()).find((x) => x.title === 'Arte do dia das crianças')!;
    expect(t.archivedAt).not.toBeNull();
    // Voltou a existir no ClickUp (restaurada): reaparece.
    servir(tarefa(), []);
    await M.sincronizarTarefaNoDaily('T1');
    t = (await daily()).find((x) => x.title === 'Arte do dia das crianças')!;
    expect(t.archivedAt).toBeNull();
    // 404 na leitura: arquiva também.
    servir(null);
    expect((await M.sincronizarTarefaNoDaily('T1')).acao).toBe('arquivada');
  });

  it('tarefa de uma lista que não é de nenhuma empresa daqui é ignorada, nunca importada', async () => {
    servir(null);
    clickup.respostas.set('/task/ESTRANHA', tarefa({ id: 'ESTRANHA', list: { id: 'OUTRA' } }));
    const antes = (await daily()).length;
    const r = await M.sincronizarTarefaNoDaily('ESTRANHA');
    expect(r.acao).toBe('ignorada');
    expect((await daily()).length).toBe(antes);
  });

  it('desligada por padrão: agendar não lê nada do ClickUp', async () => {
    servir(tarefa(), []);
    delete process.env.DAILY_SYNC_CLICKUP;
    M.agendarSincroniaDaTarefa('T1', 'taskUpdated');
    await new Promise((r) => setTimeout(r, 2200));
    expect(clickup.chamadas).toEqual([]);
  });

  it('ligada: uma rajada de eventos da mesma tarefa vira UMA leitura, e apagar na rajada ganha', async () => {
    servir(tarefa(), []);
    process.env.DAILY_SYNC_CLICKUP = 'on';
    try {
      M.agendarSincroniaDaTarefa('T1', 'taskStatusUpdated');
      M.agendarSincroniaDaTarefa('T1', 'taskAssigneeUpdated');
      M.agendarSincroniaDaTarefa('T1', 'taskCommentPosted');
      await new Promise((r) => setTimeout(r, 3500));
      expect(clickup.chamadas.filter((c) => c.startsWith('/task/T1?'))).toHaveLength(1);
      clickup.chamadas.length = 0;
      M.agendarSincroniaDaTarefa('T1', 'taskUpdated');
      M.agendarSincroniaDaTarefa('T1', 'taskDeleted');
      await new Promise((r) => setTimeout(r, 3500));
      expect(clickup.chamadas.filter((c) => c.startsWith('/task/T1?'))).toHaveLength(0); // exclusão arquiva sem reler
      expect((await daily()).find((x) => x.title === 'Arte do dia das crianças')!.archivedAt).not.toBeNull();
    } finally {
      delete process.env.DAILY_SYNC_CLICKUP;
    }
  }, 20_000);

  it('uma leitura que nunca responde não tranca a fila: estoura o prazo, vira erro no diagnóstico e a próxima tarefa entra', async () => {
    servir(tarefa({ id: 'T9', name: 'Depois da travada' }), []);
    clickup.pendurar.add('/task/T-PRESA');
    process.env.DAILY_SYNC_CLICKUP = 'on';
    try {
      M.agendarSincroniaDaTarefa('T-PRESA', 'taskUpdated');
      M.agendarSincroniaDaTarefa('T9', 'taskUpdated');
      await new Promise((r) => setTimeout(r, 8000));
      expect((await daily()).some((x) => x.title === 'Depois da travada')).toBe(true);
      expect(M.ultimasSincronias().find((r) => r.taskId === 'T-PRESA')).toMatchObject({ acao: 'erro' });
    } finally {
      delete process.env.DAILY_SYNC_CLICKUP;
      clickup.pendurar.clear();
    }
  }, 20_000);

  it('enquanto a fila está parada, a mesma tarefa não se acumula: vários eventos dela viram UMA leitura quando a vez chega', async () => {
    servir(tarefa({ id: 'T9', name: 'Depois da travada' }), []);
    clickup.pendurar.add('/task/T-PRESA').add('/task/T-PRESA2');
    process.env.DAILY_SYNC_CLICKUP = 'on';
    try {
      M.agendarSincroniaDaTarefa('T-PRESA', 'taskUpdated');
      M.agendarSincroniaDaTarefa('T-PRESA2', 'taskUpdated'); // duas presas seguidas: a fila fica parada ~6 s
      await new Promise((r) => setTimeout(r, 1700));
      clickup.chamadas.length = 0;
      for (let i = 0; i < 3; i++) { // três eventos espaçados além da janela da rajada: sem a trava, três leituras
        M.agendarSincroniaDaTarefa('T9', 'taskUpdated');
        await new Promise((r) => setTimeout(r, 1700));
      }
      await new Promise((r) => setTimeout(r, 4000));
      expect(clickup.chamadas.filter((c) => c.startsWith('/task/T9?'))).toHaveLength(1);
    } finally {
      delete process.env.DAILY_SYNC_CLICKUP;
      clickup.pendurar.clear();
    }
  }, 20_000);

  it('varredura: a tarefa com o mesmo instante do marco (o ClickUp a devolve de novo) não é relida a cada minuto', async () => {
    const quando = String(Date.now() + 60_000);
    servir(tarefa({ id: 'T7', name: 'Alterada na varredura', date_updated: quando }), []);
    clickup.respostas.set('/team/TEAM/task', { tasks: [{ id: 'T7', date_updated: quando }] });
    expect((await M.varrerAlteracoesDoClickUp()).lidas).toBe(1);
    expect((await daily()).some((x) => x.title === 'Alterada na varredura')).toBe(true);
    clickup.chamadas.length = 0;
    expect((await M.varrerAlteracoesDoClickUp()).lidas).toBe(0); // o ClickUp devolve a mesma tarefa: date_updated_gt inclui o instante
    expect(clickup.chamadas.filter((c) => c.startsWith('/task/T7'))).toEqual([]);
  });

  // ── notificações do ClickUp no sino, com a origem e som (09/11 e 11/11/2026) ─────────────────────────────────
  async function avisosNovos(antes: Set<string>) {
    const { db, schema } = dbm;
    const { and, inArray, like } = await import('drizzle-orm');
    const todos = await db.select().from(schema.notifications).where(and(inArray(schema.notifications.userId, [ana, bia]), like(schema.notifications.type, 'work.clickup.%')));
    return todos.filter((n) => !antes.has(n.id)).map((n) => ({ para: n.userId === ana ? 'Ana' : 'Bia', tipo: n.type, titulo: n.title, corpo: n.body, link: n.link }));
  }
  async function idsDeAviso() {
    const { db, schema } = dbm;
    const { inArray } = await import('drizzle-orm');
    return new Set((await db.select({ id: schema.notifications.id }).from(schema.notifications).where(inArray(schema.notifications.userId, [ana, bia]))).map((n) => n.id));
  }
  const agora = () => String(Date.now());
  const natal = (extra: Record<string, unknown> = {}) => tarefa({ id: 'N1', name: 'Post de Natal', date_updated: agora(), ...extra });
  const pelaAna = { id: '1', username: 'Ana', email: `ana-${ana}@sd.invalid` };

  it('comentário feito no ClickUp: "ClickUp · Ana comentou…" para quem está na tarefa, menos o autor; a citada recebe só a menção', async () => {
    // O aviso só vai para membro da empresa (um e-mail do ClickUp que casa com conta de outra empresa nunca vira aviso).
    await dbm.db.insert(dbm.schema.organizationMembers).values([{ organizationId: org, userId: ana }, { organizationId: org, userId: bia }]).onConflictDoNothing();
    servir(natal(), []);
    await M.sincronizarTarefaNoDaily('N1');
    const antes = await idsDeAviso();
    const comMencao = {
      id: 'cN1', comment_text: 'Olha isso @Bia', user: { id: 1, email: `ana-${ana}@sd.invalid`, username: 'Ana' }, date: agora(),
      comment: [{ text: 'Olha isso ', attributes: {} }, { type: 'tag', text: '@Bia', user: { id: 2, email: `bia-${bia}@sd.invalid`, username: 'Bia' } }],
    };
    servir(natal(), [comMencao]);
    await M.sincronizarTarefaNoDaily('N1');
    const novos = await avisosNovos(antes);
    expect(novos).toEqual([{ para: 'Bia', tipo: 'work.clickup.mentioned', titulo: expect.stringMatching(/^ClickUp · Ana mencionou você em DT-\d+ Post de Natal$/), corpo: 'Olha isso @Bia', link: expect.stringMatching(/^\/daily-tasks\?task=/) }]);

    // Sem menção: a Bia (responsável) recebe o "comentou", com o trecho do comentário.
    const antes2 = await idsDeAviso();
    servir(natal(), [comMencao, { id: 'cN2', comment_text: 'Aprovado', comment: [{ text: 'Aprovado' }], user: { id: 1, email: `ana-${ana}@sd.invalid`, username: 'Ana' }, date: agora() }]);
    await M.sincronizarTarefaNoDaily('N1');
    expect(await avisosNovos(antes2)).toEqual([{ para: 'Bia', tipo: 'work.clickup.commented', titulo: expect.stringMatching(/^ClickUp · Ana comentou em DT-\d+ Post de Natal$/), corpo: 'Aprovado', link: expect.stringMatching(/^\/daily-tasks\?task=/) }]);

    // Entra também na Caixa de Entrada (trilha de atividade), com a Ana como autora.
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const [t] = (await daily()).filter((x) => x.title === 'Post de Natal');
    const trilha = await db.select().from(schema.workActivityEvents).where(and(eq(schema.workActivityEvents.taskId, t!.id), eq(schema.workActivityEvents.action, 'commented')));
    expect(trilha.map((e) => e.actorId)).toEqual([ana, ana]);
    // Veio do ClickUp: a saída Daily→ClickUp não pode pegá-lo de volta (ela pula `system`) nem segurar a sincronia.
    expect(trilha.map((e) => e.actorKind)).toEqual(['system', 'system']);
    const { eventosParaSaida, temEscritaPendente } = await import('@desigual-os/work-engine');
    await db.insert(schema.workExternalMappings).values({ organizationId: org, provider: 'clickup', externalType: 'cursor', externalId: 'saida', entityType: 'cursor', entityId: org, meta: { lastEventId: null, lastEventAt: new Date(0).toISOString() } }).onConflictDoNothing();
    await new Promise((r) => setTimeout(r, 1100)); // a saída só lê evento com mais de 1 s
    expect((await eventosParaSaida(org)).filter((e) => e.taskId === t!.id)).toEqual([]);
    expect(await temEscritaPendente(org, t!.id)).toBe(false);

    // A mesma sincronia de novo (webhook reentregue, varredura): ninguém é avisado outra vez.
    const depois = await idsDeAviso();
    await M.sincronizarTarefaNoDaily('N1');
    expect(await avisosNovos(depois)).toEqual([]);
  });

  it('comentário antigo que só chegou agora (varredura alcançando atraso) entra no Daily, mas não vira aviso', async () => {
    const antes = await idsDeAviso();
    servir(natal(), [comentario('cVELHO', 'Isso é de 2023')]);
    await M.sincronizarTarefaNoDaily('N1');
    expect(await avisosNovos(antes)).toEqual([]);
  });

  it('status mudado no ClickUp avisa quem está na tarefa, com o autor que veio do webhook, passando pela fila', async () => {
    const antes = await idsDeAviso();
    process.env.DAILY_SYNC_CLICKUP = 'on';
    try {
      servir(natal({ status: { status: 'em aprovação', type: 'custom', color: '#a0f' } }), []);
      M.agendarSincroniaDaTarefa('N1', 'taskStatusUpdated', { espera: 0, autorDoEvento: { id: '2', username: 'Bia', email: `bia-${bia}@sd.invalid` } });
      let novos: Awaited<ReturnType<typeof avisosNovos>> = [];
      for (let i = 0; i < 50 && !novos.length; i++) { await new Promise((r) => setTimeout(r, 100)); novos = await avisosNovos(antes); }
      expect(novos).toEqual([{ para: 'Ana', tipo: 'work.clickup.status_changed', titulo: expect.stringMatching(/^ClickUp · Bia mudou o status de DT-\d+ Post de Natal para "em aprovação"$/), corpo: null, link: expect.stringMatching(/^\/daily-tasks\?task=/) }]);
    } finally {
      delete process.env.DAILY_SYNC_CLICKUP;
    }
    // Status igual na próxima leitura (é o caso da mudança feita no Daily que volta do ClickUp): sem aviso.
    const depois = await idsDeAviso();
    await M.sincronizarTarefaNoDaily('N1');
    expect(await avisosNovos(depois)).toEqual([]);
  });

  it('prazo, prioridade e nome mudados no ClickUp: um aviso de cada, para quem não mexeu; sem mudança, sem aviso', async () => {
    const antes = await idsDeAviso();
    const prazo = new Date('2026-12-20T15:00:00-03:00').getTime();
    servir(natal({ status: { status: 'em aprovação', type: 'custom', color: '#a0f' }, name: 'Post de Natal v2', priority: { id: '1' }, due_date: String(prazo) }), []);
    await M.sincronizarTarefaNoDaily('N1', { autorDoEvento: pelaAna });
    const novos = await avisosNovos(antes);
    expect(novos.every((n) => n.para === 'Bia')).toBe(true);
    expect(novos.map((n) => n.titulo).sort()).toEqual([
      expect.stringMatching(/^ClickUp · Ana mudou a prioridade de DT-\d+ Post de Natal v2 para Urgente$/),
      expect.stringMatching(/^ClickUp · Ana mudou o prazo de DT-\d+ Post de Natal v2 para 20\/12$/),
      expect.stringMatching(/^ClickUp · Ana renomeou "Post de Natal" para DT-\d+ Post de Natal v2$/),
    ].sort((a, b) => String(a).localeCompare(String(b))));
    expect(novos.map((n) => n.tipo).sort()).toEqual(['work.clickup.due_changed', 'work.clickup.priority_changed', 'work.clickup.renamed']);

    // Prazo no mesmo DIA com outra hora (o ClickUp ajusta a hora do prazo sem horário): não é mudança.
    const depois = await idsDeAviso();
    servir(natal({ status: { status: 'em aprovação', type: 'custom', color: '#a0f' }, name: 'Post de Natal v2', priority: { id: '1' }, due_date: String(prazo + 3_600_000) }), []);
    await M.sincronizarTarefaNoDaily('N1', { autorDoEvento: pelaAna });
    expect(await avisosNovos(depois)).toEqual([]);
  });

  it('anexo posto no ClickUp avisa quem está na tarefa', async () => {
    const antes = await idsDeAviso();
    const anexo = { id: 'A1', title: 'briefing.pdf', url: 'https://t.clickup.invalid/briefing.pdf', mimetype: 'application/pdf', size: 1200, date: agora(), user: { id: 2, email: `bia-${bia}@sd.invalid`, username: 'Bia' } };
    servir(natal({ status: { status: 'em aprovação', type: 'custom', color: '#a0f' }, name: 'Post de Natal v2', priority: { id: '1' }, due_date: String(new Date('2026-12-20T16:00:00-03:00').getTime()), attachments: [anexo] }), []);
    await M.sincronizarTarefaNoDaily('N1');
    expect(await avisosNovos(antes)).toEqual([{ para: 'Ana', tipo: 'work.clickup.attachment_added', titulo: expect.stringMatching(/^ClickUp · Bia anexou "briefing.pdf" em DT-\d+ Post de Natal v2$/), corpo: null, link: expect.stringMatching(/^\/daily-tasks\?task=/) }]);
  });

  it('status mudado no ClickUp por quem não tem conta aqui: todos da tarefa recebem, com o nome de lá', async () => {
    const antes = await idsDeAviso();
    servir(natal({ name: 'Post de Natal v2', priority: { id: '1' }, due_date: String(new Date('2026-12-20T16:00:00-03:00').getTime()), status: { status: 'feito', type: 'closed', color: '#222' } }), []);
    await M.sincronizarTarefaNoDaily('N1', { autorDoEvento: { id: '99', username: 'Cliente Convidado', email: 'convidado@cliente.invalid' } });
    const novos = await avisosNovos(antes);
    expect(novos.map((n) => n.para).sort()).toEqual(['Ana', 'Bia']);
    expect(novos.every((n) => /^ClickUp · Cliente Convidado mudou o status de DT-\d+ Post de Natal v2 para "feito"$/.test(n.titulo))).toBe(true);
  });

  it('montarSnapshotDaTarefa: lista sem pasta (hidden) não cria pasta', () => {
    const s = M.montarSnapshotDaTarefa({ membros, tarefa: tarefa(), comentarios: [], lista: { ...lista, folder: { id: 'X', hidden: true } }, espaco, camposDaLista: [] });
    expect(s.spaces![0]._folders).toEqual([]);
    expect(s.lists![0]._folder).toBeNull();
  });
});
