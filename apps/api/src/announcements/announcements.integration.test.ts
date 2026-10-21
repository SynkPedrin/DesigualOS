import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * Anúncios de funcionalidade contra PostgreSQL real (TENANT_TEST_DATABASE_URL):
 * quem é elegível, a apresentação automática UMA vez (mesmo com duas abas ao
 * mesmo tempo), o estado que persiste entre aparelhos, o aviso no sino sem
 * duplicar e a administração só da Desigual. Login e módulos do workspace são
 * substituídos por versões que leem do banco e de um mapa — o resto é real.
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);
const modulosPorPessoa = vi.hoisted(() => new Map<string, string[]>());

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Anúncios: testes só em PostgreSQL local isolado');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 4 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('../auth/middleware', async () => {
  const original = await vi.importActual<Record<string, unknown>>('../auth/middleware');
  return {
    ...original,
    // Como o real: conta desativada recebe 403 antes de qualquer rota.
    requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
      const id = String(request.headers['x-test-user']);
      const { testConnection } = (await import('@desigual-os/database')) as unknown as { testConnection: Sql };
      const [u] = await testConnection`select active from users where id = ${id}`;
      if (!u?.active) { reply.code(403).send({ error: 'User account is deactivated' }); return; }
      const roles = String(request.headers['x-test-roles'] ?? '').split(',').filter(Boolean);
      request.authUser = { id, name: 'Teste', email: `${id}@a.invalid`, roles, permissions: [] };
    },
  };
});

vi.mock('../auth/require-module', () => ({
  resolveEnabledModulesCached: async (id: string) => ({ modules: new Set(modulosPorPessoa.get(id) ?? []) }),
}));

vi.mock('../lib/auditoria', () => ({ auditarAcao: async () => undefined }));

describe.skipIf(!enabled)('Anúncios de funcionalidade (Postgres real)', () => {
  const desigual = randomUUID();
  const cliente = randomUUID();
  const staff = randomUUID(), ana = randomUUID(), semModulo = randomUUID(), desativado = randomUUID(), masterCliente = randomUUID();
  const chave = `teste_lancamento_${randomUUID().slice(0, 8)}`;
  const app = Fastify();
  let connection: Sql;

  const h = (user: string, roles = '') => ({ 'x-test-user': user, 'x-test-roles': roles });
  const get = (user: string, url: string, roles = '') => app.inject({ method: 'GET', url, headers: h(user, roles) });
  const evento = (user: string, event: string, step?: number) => app.inject({ method: 'POST', url: `/announcements/${chave}/events`, headers: h(user), payload: { event, ...(step !== undefined ? { step } : {}) } });
  const admin = (user: string, payload: unknown, roles = 'master') => app.inject({ method: 'PATCH', url: `/admin/announcements/${chave}`, headers: h(user, roles), payload: payload as never });
  const meus = async (user: string) => (await get(user, '/announcements')).json().announcements.filter((a: { key: string }) => a.key === chave);

  beforeAll(async () => {
    process.env.PROVIDER_ORGANIZATION_ID = desigual;
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;
    await connection`insert into organizations(id, name, slug) values (${desigual}, 'Desigual T', ${desigual}), (${cliente}, 'Cliente T', ${cliente})`;
    await connection`insert into users(id, name, email, active) values
      (${staff}, 'Staff', ${staff + '@a.invalid'}, true), (${ana}, 'Ana', ${ana + '@a.invalid'}, true),
      (${semModulo}, 'Sem', ${semModulo + '@a.invalid'}, true), (${desativado}, 'Off', ${desativado + '@a.invalid'}, true),
      (${masterCliente}, 'MC', ${masterCliente + '@a.invalid'}, true)`;
    await connection`insert into organization_members(organization_id, user_id, role) values
      (${desigual}, ${staff}, 'admin'), (${cliente}, ${ana}, 'member'), (${cliente}, ${semModulo}, 'member'),
      (${cliente}, ${desativado}, 'member'), (${cliente}, ${masterCliente}, 'admin')`;
    for (const id of [staff, ana, desativado, masterCliente]) modulosPorPessoa.set(id, ['comunicacao', 'hoje']);
    modulosPorPessoa.set(semModulo, ['hoje']);
    await connection`insert into feature_announcements (key, title, description, audience, rollout, primary_cta, tutorial_id, priority, display)
      values (${chave}, 'Novidade de teste', 'Descrição', ${JSON.stringify({ modules: ['comunicacao'] })}::jsonb, 'off',
        ${JSON.stringify({ label: 'Conhecer', action: 'start_tutorial' })}::jsonb, 'communication_hub_v1', 900,
        ${JSON.stringify({ auto_open: true, notification: { title: 'Nova funcionalidade: Teste', body: 'Corpo', action_label: 'Conhecer', link: '/comunicacao?tour=x' } })}::jsonb)`;
    const { registerAnnouncementRoutes } = await import('./routes');
    await app.register(registerAnnouncementRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection`delete from feature_announcements where key = ${chave}`;
    await connection`delete from organizations where id in (${desigual}, ${cliente})`;
    await connection`delete from users where id in (${staff}, ${ana}, ${semModulo}, ${desativado}, ${masterCliente})`;
  });

  it('desligado (rollout off) ninguém vê; master de empresa cliente não administra; a Desigual sim', async () => {
    expect(await meus(ana)).toHaveLength(0);
    expect(await meus(staff)).toHaveLength(0);
    expect((await admin(masterCliente, { rollout: 'all' })).statusCode).toBe(403);
    expect((await admin(ana, { rollout: 'all' }, '')).statusCode).toBe(403);
    expect((await get(masterCliente, '/admin/announcements', 'master')).statusCode).toBe(403);
    expect((await admin(staff, { rollout: 'qa', qa_user_ids: [staff] })).statusCode).toBe(200);
  });

  it('rollout QA: só quem está na lista de QA vê; o resto da empresa continua sem', async () => {
    expect(await meus(staff)).toMatchObject([{ key: chave, auto_open: true, state: 'not_seen', tutorial_id: 'communication_hub_v1' }]);
    expect(await meus(ana)).toHaveLength(0);
    // fora do público não grava estado
    expect((await evento(ana, 'shown')).statusCode).toBe(404);
  });

  it('para todos: elegível vê; sem o módulo não vê; conta desativada não chega a perguntar', async () => {
    expect((await admin(staff, { rollout: 'all' })).statusCode).toBe(200);
    expect(await meus(ana)).toMatchObject([{ key: chave, auto_open: true }]);
    expect(await meus(semModulo)).toHaveLength(0);
    expect((await evento(semModulo, 'shown')).statusCode).toBe(404);
    await connection`update users set active = false where id = ${desativado}`;
    expect((await get(desativado, '/announcements')).statusCode).toBe(403);
  });

  it('apresentação automática uma vez só — duas abas ao mesmo tempo: só uma abre', async () => {
    const [a, b] = await Promise.all([evento(ana, 'shown'), evento(ana, 'shown')]);
    expect([a.json().first, b.json().first].sort()).toEqual([false, true]);
    expect(await meus(ana)).toMatchObject([{ auto_open: false, state: 'not_seen' }]);
    expect((await evento(ana, 'shown')).json().first).toBe(false);
  });

  it('o aviso no sino nasce com a primeira apresentação e não duplica', async () => {
    await evento(ana, 'shown');
    const avisos = await connection`select title, link, organization_id from notifications where user_id = ${ana} and dedupe_key = ${'announcement:' + chave}`;
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ title: 'Nova funcionalidade: Teste', link: '/comunicacao?tour=x', organization_id: cliente });
  });

  it('tutorial: começar, avançar (etapa guardada para outro aparelho), concluir; concluir de novo e dispensar depois não "desconcluem"', async () => {
    expect((await evento(ana, 'started', 0)).json().announcement).toMatchObject({ state: 'in_progress', tutorial_step: 0 });
    await evento(ana, 'step', 3);
    // "outro aparelho": é só perguntar de novo — o estado mora no banco
    expect(await meus(ana)).toMatchObject([{ state: 'in_progress', tutorial_step: 3 }]);
    expect((await evento(ana, 'completed')).json().announcement).toMatchObject({ state: 'completed' });
    const [linha] = await connection`select completed_at from feature_announcement_states s join feature_announcements a on a.id = s.announcement_id where a.key = ${chave} and s.user_id = ${ana}`;
    await evento(ana, 'completed');
    await evento(ana, 'dismissed');
    await evento(ana, 'started', 0);
    const [depois] = await connection`select state, completed_at from feature_announcement_states s join feature_announcements a on a.id = s.announcement_id where a.key = ${chave} and s.user_id = ${ana}`;
    expect(depois).toMatchObject({ state: 'completed' });
    expect(String(depois!.completed_at)).toBe(String(linha!.completed_at));
    const linhas = await connection`select count(*)::int as n from feature_announcement_states s join feature_announcements a on a.id = s.announcement_id where a.key = ${chave} and s.user_id = ${ana}`;
    expect(linhas[0]!.n).toBe(1);
  });

  it('dispensar ("Explorar depois") não abre de novo sozinho, mas o tutorial continua disponível', async () => {
    await evento(staff, 'dismissed');
    expect(await meus(staff)).toMatchObject([{ state: 'dismissed', auto_open: false }]);
    // dispensado não reivindica apresentação automática
    expect((await evento(staff, 'shown')).json().first).toBe(false);
    // reabrir pela Ajuda grava andamento normalmente
    expect((await evento(staff, 'started', 0)).json().announcement).toMatchObject({ state: 'in_progress' });
  });

  it('desativar o anúncio tira de todo mundo na hora; admin vê os números', async () => {
    const lista = (await get(staff, '/admin/announcements', 'master')).json().announcements;
    expect(lista.find((a: { key: string }) => a.key === chave)).toMatchObject({ rollout: 'all', stats: { apresentados: 1, concluidos: 1, em_andamento: 1 } });
    expect((await admin(staff, { active: false })).statusCode).toBe(200);
    expect(await meus(ana)).toHaveLength(0);
    expect((await admin(staff, { rollout: 'tudo' })).statusCode).toBe(400);
  });
});
