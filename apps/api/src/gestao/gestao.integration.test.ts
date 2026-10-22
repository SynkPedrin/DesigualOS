import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * Gestão da equipe contra PostgreSQL real (TENANT_TEST_DATABASE_URL). Só o
 * ClickUp é falso (a função que devolve as tarefas da agência); papéis,
 * vínculos, quinzenas, aprovações, agenda e atividade são reais.
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);
const clickup = vi.hoisted(() => ({ falhar: false, tarefas: [] as unknown[] }));

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Gestão: testes só em PostgreSQL local isolado');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 4 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('../auth/middleware', async () => {
  const original = await vi.importActual<Record<string, unknown>>('../auth/middleware');
  return {
    ...original,
    requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }) => {
      const roles = String(request.headers['x-test-roles'] ?? '').split(',').filter(Boolean);
      request.authUser = { id: request.headers['x-test-user'], name: 'T', email: 't@t.invalid', roles, permissions: [] };
    },
  };
});

vi.mock('../clickup/routes', () => ({
  tarefasDaAgencia: async () => {
    if (clickup.falhar) throw new Error('ClickUp fora do ar');
    return { ok: true, tasks: clickup.tarefas, truncated: false, clientByListId: new Map(), clientesIndisponiveis: [] };
  },
}));

describe.skipIf(!enabled)('Gestão da equipe (Postgres real)', () => {
  const org = randomUUID(), outra = randomUUID();
  const tammy = randomUUID(), alicia = randomUUID(), matheus = randomUUID(), outroAdmin = randomUUID(), deFora = randomUUID(), desativado = randomUUID();
  const cliente = randomUUID();
  const app = Fastify();
  let connection: Sql;
  const get = (user: string, url: string, roles = 'master') => app.inject({ method: 'GET', url, headers: { 'x-test-user': user, 'x-test-roles': roles } });
  const agora = Date.now();

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;
    await connection`insert into organizations(id, name, slug) values (${org}, 'Gestão T', ${org}), (${outra}, 'Outra T', ${outra})`;
    await connection`insert into users(id, name, email, active, clickup_email) values
      (${tammy}, 'Tammy', ${tammy + '@g.invalid'}, true, null), (${alicia}, 'Alicia', ${alicia + '@g.invalid'}, true, null),
      (${matheus}, 'Matheus', ${matheus + '@g.invalid'}, true, ${'clickup-' + matheus + '@g.invalid'}),
      (${outroAdmin}, 'Outro Admin', ${outroAdmin + '@g.invalid'}, true, null), (${deFora}, 'De Fora', ${deFora + '@g.invalid'}, true, null),
      (${desativado}, 'Desativado', ${desativado + '@g.invalid'}, false, null)`;
    await connection`insert into organization_members(organization_id, user_id, role) values
      (${org}, ${tammy}, 'admin'), (${org}, ${alicia}, 'member'), (${org}, ${matheus}, 'member'), (${org}, ${outroAdmin}, 'admin'),
      (${org}, ${desativado}, 'member'), (${outra}, ${deFora}, 'member')`;
    // Banco de teste sem o seed: os dois papéis do sistema (idempotente).
    await connection`insert into roles(name) values ('master'), ('colaborador') on conflict (name) do nothing`;
    await connection`insert into user_roles(user_id, role_id) select u, r.id from roles r, unnest(array[${tammy}, ${outroAdmin}]::uuid[]) u where r.name = 'master' on conflict do nothing`;
    await connection`insert into user_roles(user_id, role_id) select u, r.id from roles r, unnest(array[${alicia}, ${matheus}, ${deFora}, ${desativado}]::uuid[]) u where r.name = 'colaborador' on conflict do nothing`;
    await connection`insert into clients(id, name, slug, organization_id) values (${cliente}, 'Café Aurora T', ${cliente}, ${org})`;
    await connection`insert into client_users(client_id, user_id, responsibility) values (${cliente}, ${alicia}, 'account')`;
    await connection`insert into demands(organization_id, client_id, created_by, owner_id, title, source, status, due_date) values
      (${org}, ${cliente}, ${tammy}, ${alicia}, 'Quinzena atrasada', 'manual', 'in_production', now() - interval '2 days'),
      (${org}, ${cliente}, ${tammy}, ${alicia}, 'Quinzena em dia', 'manual', 'new', now() + interval '5 days'),
      (${org}, ${cliente}, ${tammy}, ${alicia}, 'Quinzena entregue', 'manual', 'done', now() - interval '9 days')`;
    // Agenda de hoje da Alicia: uma reunião normal e um compromisso particular.
    const [reuniao] = await connection`insert into calendar_events(organization_id, title, start_at, end_at, timezone, source, visibility, status, created_by)
      values (${org}, 'Reunião com o Café Aurora', now() - interval '10 minutes', now() + interval '50 minutes', 'America/Sao_Paulo', 'manual', 'default', 'confirmed', ${alicia}) returning id`;
    const [particular] = await connection`insert into calendar_events(organization_id, title, start_at, end_at, timezone, source, visibility, status, created_by)
      values (${org}, 'Médico', now() + interval '2 hours', now() + interval '3 hours', 'America/Sao_Paulo', 'manual', 'private', 'confirmed', ${alicia}) returning id`;
    await connection`insert into calendar_event_participants(event_id, member_id) values (${reuniao!.id}, ${alicia}), (${particular!.id}, ${alicia})`;
    await connection`insert into operational_events(source, type, summary, organization_id, user_id, occurred_at) values ('clickup', 'task.status', 'Moveu "Post de primavera" para pronto', ${org}, ${alicia}, now() - interval '5 minutes')`;
    clickup.tarefas = [
      { id: 't1', name: 'Post de primavera', status: 'alteração', statusType: 'custom', dueDate: agora - 3_600_000, updatedAt: agora - 60_000, assigneeEmails: [alicia + '@g.invalid'], listId: null, listName: 'L', url: null },
      { id: 't2', name: 'Roteiro do Reels', status: 'aberto', statusType: 'open', dueDate: agora + 86_400_000, updatedAt: agora, assigneeEmails: ['clickup-' + matheus + '@g.invalid'], listId: null, listName: 'L', url: null },
    ];
    const { registerGestaoRoutes } = await import('./routes');
    await app.register(registerGestaoRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection`delete from organizations where id in (${org}, ${outra})`;
    await connection`delete from users where id in (${tammy}, ${alicia}, ${matheus}, ${outroAdmin}, ${deFora}, ${desativado})`;
  });

  it('só administrador vê; colaborador recebe 403', async () => {
    expect((await get(alicia, '/gestao/equipe', 'colaborador')).statusCode).toBe(403);
    expect((await get(alicia, `/gestao/equipe/${matheus}`, 'colaborador')).statusCode).toBe(403);
    expect((await get(tammy, '/gestao/equipe')).statusCode).toBe(200);
  });

  it('a equipe: colaboradores ativos da empresa — sem administradores, desativados ou gente de outra empresa', async () => {
    const r = (await get(tammy, '/gestao/equipe')).json();
    expect(r.pessoas.map((p: { name: string }) => p.name)).toEqual(['Alicia', 'Matheus']);
  });

  it('por pessoa: tarefas (pelo e-mail do ClickUp vinculado), quinzenas, clientes, agenda e última atividade', async () => {
    const r = (await get(tammy, '/gestao/equipe')).json();
    const a = r.pessoas.find((p: { id: string }) => p.id === alicia);
    const m = r.pessoas.find((p: { id: string }) => p.id === matheus);
    expect(a.tarefas).toMatchObject({ abertas: 1, atrasadas: 1, em_andamento: 1 });
    expect(a.tarefas.agora[0]).toMatchObject({ name: 'Post de primavera' });
    expect(a.tarefas.lista).toBeUndefined();
    expect(m.tarefas).toMatchObject({ abertas: 1, atrasadas: 0 });
    expect(a.demandas).toEqual({ abertas: 2, atrasadas: 1 });
    expect(a.clientes).toBe(1);
    expect(a.agenda.agora).toMatchObject({ title: 'Reunião com o Café Aurora', visible: true });
    expect(a.ultima_atividade).toMatchObject({ summary: 'Moveu "Post de primavera" para pronto' });
  });

  it('compromisso particular aparece só como "ocupado" (sem título, local ou link)', async () => {
    const r = (await get(tammy, '/gestao/equipe')).json();
    const a = r.pessoas.find((p: { id: string }) => p.id === alicia);
    expect(a.agenda.proximo).toMatchObject({ visible: false, title: null, description: null, location: null, meeting_url: null });
    expect(JSON.stringify(r)).not.toContain('Médico');
  });

  it('detalhe de uma pessoa: lista de tarefas, quinzenas abertas, clientes e atividade', async () => {
    const r = (await get(tammy, `/gestao/equipe/${alicia}`)).json();
    expect(r.tarefas.lista).toHaveLength(1);
    expect(r.demandas.map((d: { title: string }) => d.title)).toEqual(['Quinzena atrasada', 'Quinzena em dia']);
    expect(r.demandas[0].atrasada).toBe(true);
    expect(r.clientes).toEqual([{ id: cliente, name: 'Café Aurora T', responsabilidades: ['account'] }]);
    expect(r.atividade).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('Médico');
  });

  it('detalhe de quem não é da equipe (administrador, outra empresa, id malformado) é 404', async () => {
    expect((await get(tammy, `/gestao/equipe/${outroAdmin}`)).statusCode).toBe(404);
    expect((await get(tammy, `/gestao/equipe/${deFora}`)).statusCode).toBe(404);
    expect((await get(tammy, '/gestao/equipe/nao-e-uuid')).statusCode).toBe(404);
  });

  it('ClickUp fora do ar: o painel chega com o resto e diz o que faltou', async () => {
    clickup.falhar = true;
    const r = await get(tammy, '/gestao/equipe');
    clickup.falhar = false;
    expect(r.statusCode).toBe(200);
    expect(r.json().tarefas).toMatchObject({ disponivel: false });
    expect(r.json().pessoas[0].tarefas).toBeNull();
    expect(r.json().pessoas[0].demandas.abertas).toBe(2);
  });
});
