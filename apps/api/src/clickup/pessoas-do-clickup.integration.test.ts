import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Pessoas que só existem no ClickUp, contra PostgreSQL REAL e isolado: a tarefa importada sem a pessoa ganha o
 * responsável quando ela é cadastrada, a sincronia ao vivo mantém, a lista de atribuíveis do Daily a mostra e o
 * convite adota o cadastro. O ClickUp é simulado. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const clickup = vi.hoisted(() => ({ respostas: new Map<string, unknown>() }));
vi.mock('@desigual-os/tool-gateway', async (importOriginal) => {
  const real = await importOriginal<typeof import('@desigual-os/tool-gateway')>();
  return {
    ...real,
    lerClickUpCru: async (_config: unknown, caminho: string) => {
      const chave = caminho.split('?')[0]!;
      if (!clickup.respostas.has(chave)) throw new real.ClickUpHttpError(404, chave, 'not found');
      return clickup.respostas.get(chave);
    },
  };
});
vi.mock('@desigual-os/orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@desigual-os/orchestrator')>()),
  getRedisConnection: () => { throw new Error('sem Redis no teste'); },
}));

describe.skipIf(!enabled)('pessoas só do ClickUp × PostgreSQL real', () => {
  const org = randomUUID();
  const clienteId = randomUUID();
  const ana = randomUUID();
  const sufixo = org.slice(0, 8);
  const emailAna = `ana-${sufixo}@pc.invalid`;
  const emailGui = `gui-${sufixo}@pc.invalid`;
  const idGui = 900_000_000 + Math.floor(Math.random() * 99_999_999); // vira o e-mail técnico: único por execução
  let S: typeof import('./sincronia-daily');
  let P: typeof import('./pessoas-do-clickup');
  let A: typeof import('@desigual-os/auth');
  let dbm: typeof import('@desigual-os/database');

  const membrosCU = [
    { id: 1, username: 'Ana', email: emailAna, profilePicture: null, initials: null, color: null },
    { id: idGui, username: 'Gui Designer', email: emailGui, profilePicture: 'https://cdn.clickup.test/gui.png', initials: 'GD', color: null },
  ];
  const tarefa = {
    id: `T-${sufixo}`, name: 'Arte do Gui', list: { id: 'LP' }, space: { id: 'SP' }, folder: { id: 'FP' },
    status: { status: 'aberto', type: 'open', color: '#111' }, priority: null, date_created: '1700000000000',
    assignees: [{ id: idGui, email: emailGui, username: 'Gui Designer' }], checklists: [], dependencies: [], tags: [], attachments: [],
  };

  async function responsaveis() {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const [t] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org));
    return (await db.select().from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, t!.id))).map((a) => a.userId);
  }
  async function gui() {
    const { db, schema } = dbm;
    const { sql } = await import('drizzle-orm');
    const [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.clickupEmail}) = ${emailGui}`);
    return u;
  }

  beforeAll(async () => {
    process.env.CLICKUP_API_KEY = 'chave-de-teste';
    process.env.CLICKUP_TEAM_ID = 'TEAM';
    dbm = await import('@desigual-os/database');
    S = await import('./sincronia-daily');
    P = await import('./pessoas-do-clickup');
    A = await import('@desigual-os/auth');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: `PC ${sufixo}`, slug: `pc-${org}` });
    await db.insert(schema.users).values({ id: ana, name: 'Ana', email: emailAna });
    await db.insert(schema.organizationMembers).values({ organizationId: org, userId: ana, role: 'collaborator' });
    await db.insert(schema.clients).values({ id: clienteId, name: 'Cliente PC', slug: clienteId, organizationId: org, clickupListId: 'LP' });
    clickup.respostas.set('/team/TEAM', { team: { members: membrosCU.map((m) => ({ user: m })) } });
    clickup.respostas.set('/list/LP', { id: 'LP', name: 'Cliente PC', content: null, folder: { id: 'FP', name: 'Clientes', hidden: false }, space: { id: 'SP' } });
    clickup.respostas.set('/space/SP', { id: 'SP', name: 'Agência', color: '#fff', statuses: [{ status: 'aberto', type: 'open', color: '#111' }, { status: 'feito', type: 'closed', color: '#222' }] });
    clickup.respostas.set('/list/LP/field', { fields: [] });
    clickup.respostas.set(`/task/${tarefa.id}`, tarefa);
    clickup.respostas.set(`/task/${tarefa.id}/comment`, { comments: [] });
  });

  afterAll(async () => {
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    const g = await gui();
    await db.delete(schema.clients).where(eq(schema.clients.id, clienteId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(inArray(schema.users.id, [ana, ...(g ? [g.id] : [])]));
  });

  it('sem cadastro, a tarefa entra sem o Gui (o estado de antes)', async () => {
    S.esquecerEstruturaDoClickUp();
    expect((await S.sincronizarTarefaNoDaily(tarefa.id)).acao).toBe('sincronizada');
    expect(await responsaveis()).toEqual([]);
  });

  it('cadastra o Gui como pessoa só do ClickUp, na empresa, e a tarefa que já existia ganha o responsável', async () => {
    const r = await P.garantirPessoasDoClickUp(org, membrosCU);
    expect(r).toMatchObject({ criadas: 1, naEmpresa: 1, responsaveis: 1 });
    const g = (await gui())!;
    expect(g.email).toBe(`${idGui}@${A.DOMINIO_DE_PESSOA_DO_CLICKUP}`);
    expect(g.active).toBe(false);
    expect(g.authUserId).toBeNull();
    expect(g.name).toBe('Gui Designer');
    expect(g.avatarUrl).toBe('https://cdn.clickup.test/gui.png');
    expect(await responsaveis()).toEqual([g.id]);
  });

  it('é idempotente e não toca quem já tem conta', async () => {
    const r = await P.garantirPessoasDoClickUp(org, membrosCU);
    expect(r).toMatchObject({ criadas: 0, naEmpresa: 0, responsaveis: 0 });
    const { db, schema } = dbm;
    const { sql } = await import('drizzle-orm');
    const contas = await db.select().from(schema.users).where(sql`lower(${schema.users.clickupEmail}) = ${emailAna} or lower(${schema.users.email}) = ${emailAna}`);
    expect(contas.map((u) => u.id)).toEqual([ana]);
  });

  it('a sincronia ao vivo casa o Gui pelo e-mail do ClickUp e mantém o responsável', async () => {
    S.esquecerEstruturaDoClickUp();
    expect((await S.sincronizarTarefaNoDaily(tarefa.id)).acao).toBe('sincronizada');
    expect(await responsaveis()).toEqual([(await gui())!.id]);
  });

  it('no ClickUp tiraram o Gui: a sincronia tira, e uma nova passada de cadastro não recoloca', async () => {
    clickup.respostas.set(`/task/${tarefa.id}`, { ...tarefa, assignees: [] });
    S.esquecerEstruturaDoClickUp();
    await S.sincronizarTarefaNoDaily(tarefa.id);
    expect(await responsaveis()).toEqual([]);
    await P.garantirPessoasDoClickUp(org, membrosCU);
    expect(await responsaveis()).toEqual([]);
    clickup.respostas.set(`/task/${tarefa.id}`, tarefa);
  });

  it('o convite adota o cadastro: mesma pessoa, agora com login, ativa e ainda na empresa', async () => {
    const antes = (await gui())!;
    const authUserId = randomUUID();
    const adotada = await A.adotarPessoaDoClickUp({ authUserId, email: emailGui });
    expect(adotada?.id).toBe(antes.id);
    expect(adotada).toMatchObject({ authUserId, email: emailGui, active: true });
    const { db, schema } = dbm;
    const { and, eq } = await import('drizzle-orm');
    const [membro] = await db.select().from(schema.organizationMembers).where(and(eq(schema.organizationMembers.organizationId, org), eq(schema.organizationMembers.userId, antes.id)));
    expect(membro).toBeTruthy();
    // Já adotada (tem login): uma segunda conta com o mesmo e-mail não leva o cadastro.
    expect(await A.adotarPessoaDoClickUp({ authUserId: randomUUID(), email: emailGui })).toBeNull();
    // Conta comum nunca é adotada.
    expect(await A.adotarPessoaDoClickUp({ authUserId: randomUUID(), email: emailAna })).toBeNull();
  });
});
