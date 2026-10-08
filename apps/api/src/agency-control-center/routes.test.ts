import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * Prova de correção + isolamento da query única de /agency-control-center
 * (§52-59 do prompt de refinamento). A query é grande (um `WITH` só, mesma
 * disciplina de panorama.ts) e é exatamente onde um JOIN errado vira
 * contagem errada em silêncio — por isso Postgres real, não mock de linha.
 *
 * `contextoCompletoDe` é mockado (resolve direto pro org do estado do
 * teste): a resolução de "empresa de trabalho" já tem teste próprio em
 * organizations/contexto.test.ts, aqui o alvo é só a CTE nova.
 */
const state = vi.hoisted(() => ({ userId: '', orgId: '' }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Agency Control Center tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: state.userId, roles: ['member'], permissions: [] };
  },
}));

vi.mock('../organizations/contexto', () => ({
  contextoCompletoDe: async () => ({
    escopo: { organizacoesVisiveis: [state.orgId], comoProvedor: false },
    organizacoes: [],
    ativa: null,
    deTrabalho: { id: state.orgId, name: 'QA', slug: 'qa', marca: {}, eh_provedora: false },
  }),
}));

describe.skipIf(!enabled)('isolamento e correção de /agency-control-center (Postgres real)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const ana = randomUUID();
  const bruno = randomUUID();
  const clienteX = randomUUID();
  const clienteY = randomUUID();
  const clienteFantasma = randomUUID(); // org B — nunca deve aparecer na resposta de org A

  const app = Fastify();
  let connection: Sql;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${orgA}, 'QA A', ${orgA}), (${orgB}, 'QA B', ${orgB})`;
    await connection`insert into users(id, name, email, active) values
      (${ana}, 'Ana', ${ana + '@acc-qa.invalid'}, true),
      (${bruno}, 'Bruno', ${bruno + '@acc-qa.invalid'}, true)`;
    await connection`insert into organization_members(organization_id, user_id, role) values (${orgA}, ${ana}, 'member'), (${orgA}, ${bruno}, 'member')`;
    // requireModule('operacao') (Workspace Builder, 06/10/2026): sem isto, Ana
    // (sem workspace configurado) cai no padrão de colaborador, que não inclui
    // "operacao" — toda chamada desta suíte tomaria 403 antes da CTE rodar.
    await connection`insert into workspace_configs(user_id, modules) values (${ana}, ${JSON.stringify(['operacao'])}::jsonb)`;
    await connection`insert into clients(id, name, slug, organization_id) values
      (${clienteX}, 'Cliente X', ${clienteX}, ${orgA}),
      (${clienteY}, 'Cliente Y', ${clienteY}, ${orgA}),
      (${clienteFantasma}, 'Cliente Fantasma (org B)', ${clienteFantasma}, ${orgB})`;
    await connection`insert into client_users(client_id, user_id, role, responsibility) values (${clienteX}, ${ana}, 'editor', 'account')`;

    // Conversa aguardando resposta da agência, só em Cliente X.
    const contato = randomUUID();
    await connection`insert into contacts(id, organization_id, client_id, name)
      values (${contato}, ${orgA}, ${clienteX}, 'QA Contato')`;
    await connection`insert into conversation_threads(organization_id, client_id, contact_id, channel, status)
      values (${orgA}, ${clienteX}, ${contato}, 'whatsapp', 'waiting_agency')`;

    const demanda = (status: string, clientId: string, ownerId: string, dueDate: string | null) => connection`
      insert into demands(id, organization_id, client_id, created_by, owner_id, title, source, status, due_date)
      values (${randomUUID()}, ${orgA}, ${clientId}, ${ownerId}, ${ownerId}, 'QA', 'manual', ${status}, ${dueDate})
      returning id`;

    const duasAtras = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    // 1h à frente, não "agora" (vira passado nos ms entre o insert e a query,
    // devido a `due_date < now()`) nem "23:59 no horário local da máquina"
    // (devido a `due_date::date = current_date` ser avaliado em UTC pelo
    // Postgres — 23:59 BRT já é o dia seguinte em UTC).
    const finalDeHoje = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const d1 = (await demanda('new', clienteX, ana, null))[0]!.id as string;
    const d2 = (await demanda('briefing', clienteX, ana, null))[0]!.id as string;
    const d3 = (await demanda('in_production', clienteX, ana, null))[0]!.id as string; // produção limpa
    const d4 = (await demanda('in_production', clienteY, bruno, null))[0]!.id as string; // vai ganhar approval pending -> aprovação
    const d5 = (await demanda('in_production', clienteY, bruno, null))[0]!.id as string; // vai ganhar approval changes_requested -> revisão
    const d6 = (await demanda('done', clienteX, ana, null))[0]!.id as string;
    const d7 = (await demanda('in_production', clienteX, ana, duasAtras))[0]!.id as string; // atrasada
    const d8 = (await demanda('briefing', clienteX, ana, finalDeHoje))[0]!.id as string; // prevista pra hoje

    // Org B: mesma forma, nunca deve contaminar a resposta de org A.
    await connection`insert into demands(id, organization_id, client_id, created_by, owner_id, title, source, status)
      values (${randomUUID()}, ${orgB}, ${clienteFantasma}, ${ana}, ${ana}, 'QA fantasma', 'manual', 'new')`;

    const brief = (demandId: string, clientId: string) => connection`
      insert into briefs(id, organization_id, client_id, demand_id, created_by, status)
      values (${randomUUID()}, ${orgA}, ${clientId}, ${demandId}, ${bruno}, 'in_review') returning id`;
    const b1 = (await brief(d4, clienteY))[0]!.id as string;
    const b2 = (await brief(d5, clienteY))[0]!.id as string;

    await connection`insert into approval_requests(id, organization_id, client_id, resource_type, resource_id, requested_by, approver_id, status)
      values (${randomUUID()}, ${orgA}, ${clienteY}, 'brief', ${b1}, ${bruno}, ${bruno}, 'pending')`;
    await connection`insert into approval_requests(id, organization_id, client_id, resource_type, resource_id, requested_by, status)
      values (${randomUUID()}, ${orgA}, ${clienteY}, 'brief', ${b2}, ${bruno}, 'changes_requested')`;

    void d1; void d2; void d3; void d6; void d7; void d8;

    const { registerAgencyControlCenterRoutes } = await import('./routes');
    await app.register(registerAgencyControlCenterRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection?.end();
  });

  it('KPIs batem com o cenário semeado, e nunca contam a org B', async () => {
    state.userId = ana;
    state.orgId = orgA;
    const response = await app.inject({ method: 'GET', url: '/agency-control-center' });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.kpis).toEqual({
      clientes_ativos: 2,
      conversas_aguardando: 1,
      demandas_abertas: 7, // tudo menos d6 (done) — a demanda fantasma da org B nunca entra
      atrasados: 1,
      aguardando_aprovacao: 1,
      previstas_hoje: 1,
    });
  });

  it('o funil separa produção de revisão/aprovação usando o approval do brief, não só demand.status', async () => {
    state.userId = ana;
    state.orgId = orgA;
    const response = await app.inject({ method: 'GET', url: '/agency-control-center' });
    const body = response.json();

    expect(body.funil_de_workflow).toEqual({
      novas: 1,
      briefing: 2,
      producao: 2, // d3 e d7 — d4/d5 saíram daqui porque têm approval em aberto
      revisao: 1, // d5, via b2 com status changes_requested
      aprovacao: 1, // d4, via b1 com status pending
      concluido: 1,
    });
  });

  it('clientes em atenção: Cliente X por atraso, Cliente Y por aprovação pendente — nunca o Cliente Fantasma da org B', async () => {
    state.userId = ana;
    state.orgId = orgA;
    const response = await app.inject({ method: 'GET', url: '/agency-control-center' });
    const body = response.json() as { clientes_em_atencao: Array<{ client_name: string; responsavel: string | null; demandas_atrasadas: number; aprovacoes_pendentes: number }> };

    const porNome = Object.fromEntries(body.clientes_em_atencao.map((c) => [c.client_name, c]));
    expect(porNome['Cliente X']).toMatchObject({ responsavel: 'Ana', demandas_atrasadas: 1, aprovacoes_pendentes: 0 });
    expect(porNome['Cliente Y']).toMatchObject({ responsavel: null, demandas_atrasadas: 0, aprovacoes_pendentes: 1 });
    expect(porNome['Cliente Fantasma (org B)']).toBeUndefined();
  });

  it('operação por colaborador: Ana carrega Cliente X, Bruno resolve as aprovações dele mesmo', async () => {
    state.userId = ana;
    state.orgId = orgA;
    const response = await app.inject({ method: 'GET', url: '/agency-control-center' });
    const body = response.json() as { operacao_por_colaborador: Array<{ name: string; clientes: number; em_andamento: number; atrasados: number; aprovacoes_pendentes: number }> };

    const porNome = Object.fromEntries(body.operacao_por_colaborador.map((p) => [p.name, p]));
    expect(porNome.Ana).toMatchObject({ clientes: 1, em_andamento: 5, atrasados: 1 });
    expect(porNome.Bruno).toMatchObject({ clientes: 0, em_andamento: 2, atrasados: 0, aprovacoes_pendentes: 1 });
  });

  it('usuário de outra organização nunca recebe os dados da org A (contexto resolve pra org B)', async () => {
    state.userId = ana;
    state.orgId = orgB;
    const response = await app.inject({ method: 'GET', url: '/agency-control-center' });
    const body = response.json();

    expect(body.kpis.clientes_ativos).toBe(1); // só o Cliente Fantasma
    expect(body.clientes_em_atencao.find((c: { client_name: string }) => c.client_name === 'Cliente X')).toBeUndefined();
  });
});
