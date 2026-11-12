import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * O caso da Ana Luiza (12/11/2026), contra PostgreSQL REAL e isolado: duas contas com o mesmo e-mail do ClickUp
 * deixavam as tarefas dela sem responsável. Conectar o ClickUp liga a conta pelo dono do token, as tarefas passam
 * para ela e a sincronia volta a atribuir. O ClickUp é simulado. Pulado sem banco local.
 */
const url = process.env.DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:/.test(url);

const clickup = vi.hoisted(() => ({ respostas: new Map<string, unknown>(), donoDoToken: '' }));
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

describe.skipIf(!enabled)('vínculo com o ClickUp pelo token × PostgreSQL real', () => {
  const org = randomUUID();
  const clienteId = randomUUID();
  const antiga = randomUUID();
  const nova = randomUUID();
  const sufixo = org.slice(0, 8);
  const emailCU = `analuiza-${sufixo}@cu.invalid`;
  let S: typeof import('../clickup/sincronia-daily');
  let V: typeof import('./vinculo-clickup');
  let dbm: typeof import('@desigual-os/database');

  const tarefa = {
    id: `V-${sufixo}`, name: 'Caderno - Colpar 2027', list: { id: 'LV' }, space: { id: 'SV' }, folder: { id: 'FV' },
    status: { status: 'aberto', type: 'open', color: '#111' }, priority: null, date_created: '1700000000000',
    assignees: [{ id: 88410206, email: emailCU, username: 'Ana Luiza' }], checklists: [], dependencies: [], tags: [], attachments: [],
  };

  async function responsaveis() {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const [t] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org));
    return (await db.select().from(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, t!.id))).map((a) => a.userId);
  }
  async function vinculoDe(id: string) {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const [u] = await db.select({ clickupEmail: schema.users.clickupEmail }).from(schema.users).where(eq(schema.users.id, id));
    return u?.clickupEmail ?? null;
  }

  beforeAll(async () => {
    process.env.CLICKUP_API_KEY = 'chave-de-teste';
    process.env.CLICKUP_TEAM_ID = 'TEAM';
    const fetchReal = globalThis.fetch;
    vi.stubGlobal('fetch', async (alvo: string | URL | Request, init?: RequestInit) => {
      if (String(alvo).endsWith('/api/v2/user')) return new Response(JSON.stringify({ user: { id: 88410206, email: clickup.donoDoToken } }), { status: 200 });
      return fetchReal(alvo, init);
    });
    dbm = await import('@desigual-os/database');
    S = await import('../clickup/sincronia-daily');
    V = await import('./vinculo-clickup');
    const { db, schema } = dbm;
    await db.insert(schema.organizations).values({ id: org, name: `VC ${sufixo}`, slug: `vc-${org}` });
    // A conta antiga tem o e-mail do ClickUp como LOGIN e como vínculo; a nova ganhou o mesmo vínculo por palpite.
    await db.insert(schema.users).values([
      { id: antiga, name: 'Ana Luiza', email: emailCU, clickupEmail: emailCU },
      { id: nova, name: 'Ana Luiza', email: `analuiza-${sufixo}@os.invalid`, clickupEmail: emailCU },
    ]);
    await db.insert(schema.organizationMembers).values([
      { organizationId: org, userId: antiga, role: 'collaborator' },
      { organizationId: org, userId: nova, role: 'collaborator' },
    ]);
    await db.insert(schema.clients).values({ id: clienteId, name: 'Colpar VC', slug: clienteId, organizationId: org, clickupListId: 'LV' });
    clickup.respostas.set('/team/TEAM', { team: { members: [{ user: { id: 88410206, username: 'Ana Luiza', email: emailCU } }] } });
    clickup.respostas.set('/list/LV', { id: 'LV', name: 'Colpar VC', content: null, folder: { id: 'FV', name: 'Clientes', hidden: false }, space: { id: 'SV' } });
    clickup.respostas.set('/space/SV', { id: 'SV', name: 'Agência', color: '#fff', statuses: [{ status: 'aberto', type: 'open', color: '#111' }, { status: 'feito', type: 'closed', color: '#222' }] });
    clickup.respostas.set('/list/LV/field', { fields: [] });
    clickup.respostas.set(`/task/${tarefa.id}`, tarefa);
    clickup.respostas.set(`/task/${tarefa.id}/comment`, { comments: [] });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    const { db, schema } = dbm;
    const { eq, inArray } = await import('drizzle-orm');
    await db.delete(schema.clients).where(eq(schema.clients.id, clienteId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, org));
    await db.delete(schema.users).where(inArray(schema.users.id, [antiga, nova]));
  });

  it('com o mesmo e-mail do ClickUp em duas contas, a tarefa fica sem responsável (o defeito)', async () => {
    S.esquecerEstruturaDoClickUp();
    expect((await S.sincronizarTarefaNoDaily(tarefa.id)).acao).toBe('sincronizada');
    expect(await responsaveis()).toEqual([]);
  });

  it('o token diz quem ela é: a conta nova fica com o vínculo, recebe o que era da antiga e a sincronia atribui', async () => {
    const { db, schema } = dbm;
    const { eq } = await import('drizzle-orm');
    const [t] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.organizationId, org));
    // O que a conta antiga tinha (atribuição e acompanhamento) passa para a nova.
    await db.insert(schema.workTaskAssignees).values({ taskId: t!.id, userId: antiga, organizationId: org });
    await db.insert(schema.workTaskFollowers).values({ taskId: t!.id, userId: antiga, organizationId: org });

    clickup.donoDoToken = emailCU;
    expect(await V.vincularPeloTokenDoClickUp(nova, 'token-da-ana')).toBe(emailCU);
    expect(await vinculoDe(nova)).toBe(emailCU);
    expect(await vinculoDe(antiga)).toBeNull();
    expect(await responsaveis()).toEqual([nova]);
    const seguidores = await db.select().from(schema.workTaskFollowers).where(eq(schema.workTaskFollowers.taskId, t!.id));
    expect(seguidores.map((s) => s.userId)).toEqual([nova]);

    // A conta antiga continua com o e-mail do ClickUp como LOGIN; o vínculo da nova manda na sincronia.
    await db.delete(schema.workTaskAssignees).where(eq(schema.workTaskAssignees.taskId, t!.id));
    S.esquecerEstruturaDoClickUp();
    expect((await S.sincronizarTarefaNoDaily(tarefa.id)).acao).toBe('sincronizada');
    expect(await responsaveis()).toEqual([nova]);
  });

  it('duas contas conectadas ao mesmo usuário do ClickUp: fica com quem conectou primeiro, sem passar de uma para a outra', async () => {
    const { db, schema } = dbm;
    await db.insert(schema.integrationConnections).values([
      { userId: nova, provider: 'clickup', accessTokenEncrypted: 'x', status: 'connected', createdAt: new Date('2026-11-01T00:00:00Z') },
      { userId: antiga, provider: 'clickup', accessTokenEncrypted: 'y', status: 'connected', createdAt: new Date('2026-11-12T00:00:00Z') },
    ]);
    clickup.donoDoToken = emailCU;
    // A antiga conectou depois: não toma o vínculo da nova.
    expect(await V.vincularPeloTokenDoClickUp(antiga, 'token-da-antiga')).toBeNull();
    expect(await vinculoDe(nova)).toBe(emailCU);
    expect(await vinculoDe(antiga)).toBeNull();
    // A nova (primeira) confirma e continua com ele.
    expect(await V.vincularPeloTokenDoClickUp(nova, 'token-da-nova')).toBe(emailCU);
    expect(await vinculoDe(nova)).toBe(emailCU);
    const { inArray } = await import('drizzle-orm');
    await db.delete(schema.integrationConnections).where(inArray(schema.integrationConnections.userId, [nova, antiga]));
  });

  it('token que não identifica ninguém não mexe em nada', async () => {
    clickup.donoDoToken = '';
    expect(await V.vincularPeloTokenDoClickUp(antiga, 'token-quebrado')).toBeNull();
    expect(await vinculoDe(nova)).toBe(emailCU);
  });
});
