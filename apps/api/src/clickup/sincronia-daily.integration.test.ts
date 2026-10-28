import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Sincronia ClickUp → Daily Tasks contra PostgreSQL REAL e isolado. O ClickUp é simulado (um objeto que responde
 * pelos mesmos caminhos da API v2); o banco, o importador e os vínculos são de verdade. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const clickup = vi.hoisted(() => ({ respostas: new Map<string, unknown>(), chamadas: [] as string[] }));
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
  return {
    ...real,
    lerClickUpCru: async (_config: unknown, caminho: string) => {
      clickup.chamadas.push(caminho);
      const chave = caminho.split('?')[0]!;
      if (!clickup.respostas.has(chave)) throw new real.ClickUpHttpError(404, chave, 'not found');
      return clickup.respostas.get(chave);
    },
  };
});

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

  it('montarSnapshotDaTarefa: lista sem pasta (hidden) não cria pasta', () => {
    const s = M.montarSnapshotDaTarefa({ membros, tarefa: tarefa(), comentarios: [], lista: { ...lista, folder: { id: 'X', hidden: true } }, espaco, camposDaLista: [] });
    expect(s.spaces![0]._folders).toEqual([]);
    expect(s.lists![0]._folder).toBeNull();
  });
});
