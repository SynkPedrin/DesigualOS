import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * MEDIÇÃO DO ENVIO (não é teste de regra; só roda com HUB_BENCH=1).
 *
 * Mesmo driver da produção (prepare:false, pool 12, postgres-js com o patch
 * sem pipeline) contra um PostgreSQL local atrás de um proxy que atrasa cada
 * sentido (TENANT_TEST_DATABASE_URL apontando para o proxy). Com 62 ms por
 * sentido, uma ida e volta custa ~125 ms — o que a VPS mede até o Supabase.
 *
 *   HUB_BENCH=1 TENANT_TEST_DATABASE_URL=postgres://...@127.0.0.1:55499/hub pnpm exec vitest run src/internal-chat/envio.bench.integration.test.ts
 */
const enabled = Boolean(process.env.HUB_BENCH && process.env.TENANT_TEST_DATABASE_URL);
const contagem = vi.hoisted(() => ({ consultas: 0 }));

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.HUB_BENCH || !process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('medição só em PostgreSQL local');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 12, prepare: false, debug: () => { contagem.consultas++; } });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('@desigual-os/orchestrator', async () => {
  const original = await vi.importActual<Record<string, unknown>>('@desigual-os/orchestrator');
  return {
    ...original,
    // Redis da VPS fica na mesma máquina da API: ~1 ms. Simulado com 1 ms.
    publishWsEvent: async () => { await new Promise((ok) => setTimeout(ok, 1)); },
    getRedisConnection: () => ({ set: async () => 'OK', expire: async () => 1, mget: async (...keys: string[]) => keys.map(() => null) }),
  };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { headers: Record<string, unknown>; authUser?: unknown }) => {
    request.authUser = { id: request.headers['x-test-user'], name: 'Teste', email: 't@t.invalid', roles: [], permissions: [{ resource: 'chat', action: 'write' }] };
  },
  requirePermission: () => async () => {},
}));
vi.mock('../lib/auditoria', () => ({ auditarAcao: async () => undefined }));

function percentil(valores: number[], p: number) {
  const ordenados = [...valores].sort((a, b) => a - b);
  return Math.round(ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)]!);
}

describe.skipIf(!enabled)('medição do envio da Comunicação', () => {
  const org = randomUUID();
  const ana = randomUUID(), bia = randomUUID(), caio = randomUUID();
  const app = Fastify();
  let connection: Sql;
  let canal = '';
  let geral = '';
  const headers = (user: string) => ({ 'x-test-user': user });

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;
    await connection`insert into organizations(id, name, slug) values (${org}, 'Bench', ${org})`;
    await connection`insert into users(id, name, email, active) values (${ana}, 'Ana', ${ana + '@b.invalid'}, true), (${bia}, 'Bia', ${bia + '@b.invalid'}, true), (${caio}, 'Caio', ${caio + '@b.invalid'}, true)`;
    await connection`insert into organization_members(organization_id, user_id, role) values (${org}, ${ana}, 'member'), (${org}, ${bia}, 'member'), (${org}, ${caio}, 'member')`;
    const { registerInternalChatRoutes } = await import('./routes');
    await app.register(registerInternalChatRoutes);
    await app.ready();
    geral = (await app.inject({ method: 'GET', url: '/internal-chat/conversations', headers: headers(ana) })).json().conversations[0].id;
    canal = (await app.inject({ method: 'POST', url: '/internal-chat/channels', headers: headers(ana), payload: { name: `bench-${org.slice(0, 6)}`, visibility: 'private', memberIds: [bia, caio] } })).json().id;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await connection`delete from organizations where id = ${org}`;
    await connection`delete from users where id in (${ana}, ${bia}, ${caio})`;
  });

  async function medir(nome: string, n: number, fazer: (i: number) => Promise<{ statusCode: number; headers?: Record<string, unknown> }>) {
    const tempos: number[] = [];
    const consultas: number[] = [];
    for (let i = 0; i < n; i++) {
      contagem.consultas = 0;
      const t = performance.now();
      const r = await fazer(i);
      const ms = performance.now() - t;
      tempos.push(ms);
      if (ms > 500) console.log(`  lenta: ${Math.round(ms)} ms · ${String((r as { headers?: Record<string, unknown> }).headers?.['server-timing'] ?? '')}`);
      consultas.push(contagem.consultas);
      expect(r.statusCode).toBeLessThan(300);
      // O que roda depois da resposta (notificações, eventos) não pode contaminar a próxima medição.
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    console.log(`MEDIÇÃO ${nome}: p50 ${percentil(tempos, 50)} ms · p95 ${percentil(tempos, 95)} ms · consultas no caminho ${Math.min(...consultas)}–${Math.max(...consultas)}`);
  }

  it('envio, thread, menção, geral, não lidas', async () => {
    const enviar = (user: string, conversa: string, extra: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/internal-chat/conversations/${conversa}/messages`, headers: headers(user), payload: { clientMessageId: `bench-${randomUUID()}`, content: 'mensagem de medição', ...extra } });
    // Primeiro acesso de cada pessoa (cache frio): medido à parte, porque acontece uma vez por pessoa a cada subida/2 min parada.
    for (const quem of [ana, bia]) {
      const t = performance.now();
      await app.inject({ method: 'GET', url: '/internal-chat/unread', headers: headers(quem) });
      console.log(`MEDIÇÃO primeiro acesso (cache frio): ${Math.round(performance.now() - t)} ms`);
    }
    await enviar(ana, canal);
    await new Promise((ok) => setTimeout(ok, 3000));
    await medir('envio simples (canal privado)', 12, () => enviar(ana, canal));
    await medir('envio no #Geral', 12, () => enviar(ana, geral));
    await medir('envio com menção', 12, () => enviar(ana, canal, { mentions: [bia] }));
    const raiz = (await enviar(ana, canal)).json().id;
    await medir('resposta em thread', 12, () => enviar(bia, canal, { threadRootId: raiz }));
    await medir('GET não lidas', 12, () => app.inject({ method: 'GET', url: '/internal-chat/unread', headers: headers(bia) }));
    await medir('GET mensagens', 12, () => app.inject({ method: 'GET', url: `/internal-chat/conversations/${canal}/messages?limit=40`, headers: headers(bia) }));
  }, 600_000);
});
