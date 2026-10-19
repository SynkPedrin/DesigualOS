import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * GUARDA DAS DUAS REGRAS do /today/summary (13/10/2026):
 *
 * 1. FALHA PARCIAL NUNCA É 500 INTEIRO — a seção que falhou volta
 *    `ok: false` com o status original, as outras voltam intactas, e uma
 *    lista vazia de verdade continua sendo `ok: true` com `[]` (vazio não é
 *    erro, e erro não é vazio).
 * 2. AUTENTICAÇÃO É EXIGIDA — sem credencial, 401 antes de qualquer
 *    subchamada.
 *
 * As rotas de origem são stubs neste app de teste: o que se afirma aqui é o
 * COMPORTAMENTO DO AGREGADO (degradação, repasse de credencial e de
 * parâmetros), não o conteúdo de cada rota — cada uma tem a própria suíte.
 */

const state = vi.hoisted(() => ({
  user: { id: 'user-1', roles: ['master'], permissions: [] } as { id: string; roles: string[]; permissions: never[] },
  /** url da rota de origem -> status que ela deve devolver neste teste. */
  falhas: {} as Record<string, number>,
  /** url da rota de origem que nunca responde neste teste. */
  presa: null as string | null,
  chamadas: [] as Array<{ url: string; organizationId: unknown; authorization: unknown }>,
}));

vi.mock('../auth/middleware', () => ({
  requireAuth: async (
    request: { headers: Record<string, unknown>; authUser?: unknown },
    reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (!request.headers['authorization']) {
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }
    request.authUser = state.user;
  },
}));

const app = Fastify();

function stub(caminho: string, payload: unknown) {
  app.get(caminho, async (request, reply) => {
    state.chamadas.push({
      url: request.url,
      organizationId: request.headers['x-organization-id'],
      authorization: request.headers['authorization'],
    });
    if (state.presa === caminho) return new Promise(() => undefined);
    const falha = state.falhas[caminho];
    if (falha) {
      reply.code(falha);
      return { error: 'falhou de propósito' };
    }
    return payload;
  });
}

stub('/me', { id: 'user-1', name: 'Pessoa Teste' });
stub('/clickup/tasks/me', { tasks: [{ id: 't1' }], truncated: false });
stub('/clickup/tasks/agency', { tasks: [{ id: 't1' }, { id: 't2' }], truncated: false });
stub('/inbox/threads', { threads: [] });
stub('/calendar/events', { events: [] });
stub('/approvals', { approvals: [] });
stub('/demands', { demands: [] });
stub('/clients', { clients: [] });

const { registerTodayRoutes } = await import('./routes');
await app.register(registerTodayRoutes);
await app.ready();

const PARAMS = 'from=2026-10-13T03:00:00.000Z&to=2026-10-14T02:59:59.999Z';
const AUTH = { authorization: 'Bearer token-de-teste' };

describe('/today/summary', () => {
  beforeEach(() => {
    state.falhas = {};
    state.chamadas.length = 0;
  });

  it('exige autenticação: sem credencial, 401 e nenhuma subchamada', async () => {
    const res = await app.inject({ method: 'GET', url: `/today/summary?${PARAMS}` });
    expect(res.statusCode).toBe(401);
    expect(state.chamadas.length).toBe(0);
  });

  it('falha parcial de uma seção não derruba as outras nem o resumo', async () => {
    state.falhas['/clickup/tasks/agency'] = 502;

    const res = await app.inject({ method: 'GET', url: `/today/summary?${PARAMS}`, headers: AUTH });
    expect(res.statusCode).toBe(200);

    const corpo = res.json();
    expect(corpo.tarefas_da_agencia).toEqual({ ok: false, status: 502 });
    expect(corpo.me).toEqual({ ok: true, dados: { id: 'user-1', name: 'Pessoa Teste' } });
    expect(corpo.minhas_tarefas.ok).toBe(true);
    // Lista vazia REAL continua ok: vazio não é falha de leitura.
    expect(corpo.conversas_aguardando).toEqual({ ok: true, dados: { threads: [] } });
    expect(typeof corpo.gerado_em).toBe('string');
  });

  it('o 409 de "ClickUp não vinculado" chega intacto, distinguível de falha e de vazio', async () => {
    state.falhas['/clickup/tasks/me'] = 409;

    const res = await app.inject({ method: 'GET', url: `/today/summary?${PARAMS}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().minhas_tarefas).toEqual({ ok: false, status: 409 });
  });

  it('repassa credencial, empresa de trabalho e os parâmetros de cada rota de origem', async () => {
    const headers = { ...AUTH, 'x-organization-id': '22222222-2222-2222-2222-222222222222' };
    const res = await app.inject({ method: 'GET', url: `/today/summary?${PARAMS}`, headers });
    expect(res.statusCode).toBe(200);

    // Toda subchamada carrega a credencial e a empresa escolhida — sem isto,
    // o agregado leria um tenant e as seções outro.
    expect(state.chamadas.length).toBe(10);
    for (const chamada of state.chamadas) {
      expect(chamada.authorization).toBe('Bearer token-de-teste');
      expect(chamada.organizationId).toBe('22222222-2222-2222-2222-222222222222');
    }

    const urls = state.chamadas.map((c) => c.url);
    // O dono das demandas é resolvido no servidor, sem esperar o /me.
    expect(urls).toContain('/demands?ownerId=user-1&limit=30');
    expect(urls).toContain(`/calendar/events?from=${encodeURIComponent('2026-10-13T03:00:00.000Z')}&to=${encodeURIComponent('2026-10-14T02:59:59.999Z')}`);
    expect(urls).toContain('/inbox/threads?status=waiting_agency&limit=30');
    expect(urls).toContain('/inbox/threads?status=waiting_agency&assigned=me&limit=30');
    expect(urls).toContain('/inbox/threads?assigned=me&limit=4');
    expect(urls).toContain('/approvals?status=pending&limit=30');
  });

  it('seção que nunca responde vira falha só dela, as outras voltam (teto por seção)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      state.presa = '/clickup/tasks/agency';
      const pendente = app.inject({ method: 'GET', url: `/today/summary?from=${encodeURIComponent('2026-10-19T03:00:00.000Z')}&to=${encodeURIComponent('2026-10-20T02:59:59.999Z')}`, headers: { authorization: 'Bearer t' } });
      await vi.advanceTimersByTimeAsync(8_100);
      const res = await pendente;
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tarefas_da_agencia).toEqual({ ok: false, status: 504 });
      expect(body.minhas_tarefas.ok).toBe(true);
      expect(body.me.ok).toBe(true);
    } finally {
      state.presa = null;
      vi.useRealTimers();
    }
  });
});
