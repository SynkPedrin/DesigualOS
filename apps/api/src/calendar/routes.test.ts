import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type * as ToolGatewayModule from '@desigual-os/tool-gateway';

/**
 * Calendar Core (prompt "CALENDAR + AUTOMATIONS + BENTO V2", Partes A/B/E,
 * 06/10/2026): prova contra Postgres real que (1) conflito HARD bloqueia a
 * criação a menos que `force`, (2) evento privado nunca vaza título/descrição
 * pra quem não é dono nem participante — só "ocupado" (§27), e (3) a agenda
 * de uma organização nunca aparece pra outra.
 */
const state = vi.hoisted(() => ({ userId: '' }));
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Calendar tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: state.userId, roles: ['member'], permissions: [] };
  },
  requirePermission: () => async () => {},
}));

const resolveGoogleCalendarAccess = vi.fn();
const listGoogleCalendars = vi.fn();
const syncMemberGoogleCalendar = vi.fn();
const resolveMicrosoftCalendarAccess = vi.fn();
const listMicrosoftCalendars = vi.fn();
const syncMemberMicrosoftCalendar = vi.fn();

vi.mock('@desigual-os/tool-gateway', async () => {
  const actual = await vi.importActual<typeof ToolGatewayModule>('@desigual-os/tool-gateway');
  return { ...actual, resolveGoogleCalendarAccess, listGoogleCalendars, syncMemberGoogleCalendar, resolveMicrosoftCalendarAccess, listMicrosoftCalendars, syncMemberMicrosoftCalendar };
});

describe.skipIf(!enabled)('Calendar Core — conflito, privacidade e isolamento (Postgres real)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const jamille = randomUUID();
  const alicia = randomUUID();
  const fantasma = randomUUID();
  const app = Fastify();
  let connection: Sql;
  const jamilleGoogleConnectionId = randomUUID();
  const jamilleMicrosoftConnectionId = randomUUID();

  const amanha9h = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const amanha10h = new Date(amanha9h.getTime() + 60 * 60_000);

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${orgA}, 'QA Calendar A', ${orgA}), (${orgB}, 'QA Calendar B', ${orgB})`;
    await connection`insert into users(id, name, email) values
      (${jamille}, 'Jamille', ${jamille + '@cal-qa.invalid'}),
      (${alicia}, 'Alicia', ${alicia + '@cal-qa.invalid'}),
      (${fantasma}, 'Fantasma Org B', ${fantasma + '@cal-qa.invalid'})`;
    await connection`insert into organization_members(organization_id, user_id, role) values (${orgA}, ${jamille}, 'member'), (${orgA}, ${alicia}, 'member'), (${orgB}, ${fantasma}, 'owner')`;
    for (const user of [jamille, alicia, fantasma]) {
      await connection`insert into workspace_configs(user_id, modules) values (${user}, ${JSON.stringify(['calendario'])}::jsonb)`;
    }
    // Uma só conexão Google real por pessoa (integration_connections tem unique em user_id+provider) —
    // os testes de vínculo de agenda abaixo reaproveitam esta, nunca inserem uma segunda.
    await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status) values (${jamilleGoogleConnectionId}, ${jamille}, 'google_calendar', 'enc:fake', 'connected')`;
    // Idem pro Microsoft — mesma régua (unique user_id+provider), nunca reaproveitando a linha do Google.
    await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status) values (${jamilleMicrosoftConnectionId}, ${jamille}, 'microsoft_calendar', 'enc:fake', 'connected')`;

    const { registerCalendarRoutes } = await import('./routes');
    await app.register(registerCalendarRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await connection?.end();
  });

  it('Jamille cria um evento amanhã 9h-10h', async () => {
    state.userId = jamille;
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Alinhamento Cosentino', start_at: amanha9h.toISOString(), end_at: amanha10h.toISOString(), participant_user_ids: [jamille] },
    });
    expect(response.statusCode).toBe(201);
  });

  it('agendar Jamille 9h30 sem force detecta conflito HARD e não cria nada', async () => {
    state.userId = alicia;
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: {
        title: 'Outra reunião',
        start_at: new Date(amanha9h.getTime() + 30 * 60_000).toISOString(),
        end_at: new Date(amanha10h.getTime() + 30 * 60_000).toISOString(),
        participant_user_ids: [jamille],
      },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json() as { conflicts: Array<{ member_id: string }>; suggested_slots: unknown[] };
    expect(body.conflicts.map((c) => c.member_id)).toContain(jamille);
    expect(body.suggested_slots.length).toBeGreaterThan(0);
  });

  it('com force:true, cria mesmo com conflito — "continuar mesmo assim" (§19)', async () => {
    state.userId = alicia;
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: {
        title: 'Força mesmo assim',
        start_at: new Date(amanha9h.getTime() + 30 * 60_000).toISOString(),
        end_at: new Date(amanha10h.getTime() + 30 * 60_000).toISOString(),
        participant_user_ids: [jamille],
        force: true,
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it('evento PRIVADO: quem não é dono nem participante só vê "ocupado", nunca o título (§27)', async () => {
    state.userId = jamille;
    const criar = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: {
        title: 'Dentista',
        start_at: new Date(amanha9h.getTime() + 5 * 24 * 60 * 60_000).toISOString(),
        end_at: new Date(amanha10h.getTime() + 5 * 24 * 60 * 60_000).toISOString(),
        visibility: 'private',
      },
    });
    expect(criar.statusCode).toBe(201);

    const inicio = new Date(amanha9h.getTime() + 5 * 24 * 60 * 60_000 - 3_600_000).toISOString();
    const fim = new Date(amanha10h.getTime() + 5 * 24 * 60 * 60_000 + 3_600_000).toISOString();

    state.userId = alicia;
    const vistoPorAlicia = await app.inject({ method: 'GET', url: `/calendar/events?member_id=${jamille}&from=${inicio}&to=${fim}` });
    const eventoAlicia = (vistoPorAlicia.json().events as Array<{ title: string | null; visible: boolean }>).find((e) => e.visible === false || e.title === 'Dentista');
    expect(eventoAlicia?.visible).toBe(false);
    expect(eventoAlicia?.title).toBeNull();

    state.userId = jamille;
    const vistoPorJamille = await app.inject({ method: 'GET', url: `/calendar/events?member_id=${jamille}&from=${inicio}&to=${fim}` });
    const eventoJamille = (vistoPorJamille.json().events as Array<{ title: string | null }>).find((e) => e.title === 'Dentista');
    expect(eventoJamille?.title).toBe('Dentista');
  });

  it('participante de outra organização é recusado (400), nunca vira evento cross-tenant', async () => {
    state.userId = jamille;
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Tentativa cross-org', start_at: amanha9h.toISOString(), end_at: amanha10h.toISOString(), participant_user_ids: [fantasma] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('GET /calendar/availability encontra o horário comum livre depois do conflito', async () => {
    state.userId = jamille;
    const inicio = amanha9h.toISOString();
    const fim = new Date(amanha9h.getTime() + 8 * 60 * 60_000).toISOString();
    const response = await app.inject({ method: 'GET', url: `/calendar/availability?member_ids=${jamille},${alicia}&from=${inicio}&to=${fim}&duration_minutes=30` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { slots: Array<{ start: string }> };
    expect(body.slots.length).toBeGreaterThan(0);
    // o primeiro slot livre em comum é depois das 10h30 (fim do segundo evento de Jamille).
    expect(new Date(body.slots[0]!.start).getTime()).toBeGreaterThanOrEqual(new Date(amanha10h.getTime() + 30 * 60_000).getTime());
  });

  it('POST /calendar/google/accounts recusa agenda que a conexão da pessoa não enxerga (§24: credencial ≠ recurso)', async () => {
    resolveGoogleCalendarAccess.mockReset().mockResolvedValue({ accessToken: 'fake-token', connectionId: randomUUID() });
    listGoogleCalendars.mockReset().mockResolvedValue([{ id: 'outra@gmail.com', summary: 'Outra agenda', primary: false, accessRole: 'owner' }]);

    state.userId = jamille;
    const response = await app.inject({ method: 'POST', url: '/calendar/google/accounts', payload: { external_calendar_id: 'nao-autorizada@gmail.com' } });
    expect(response.statusCode).toBe(400);
  });

  it('POST /calendar/google/accounts vincula quando a agenda está entre as acessíveis, isolado por pessoa', async () => {
    resolveGoogleCalendarAccess.mockReset().mockResolvedValue({ accessToken: 'fake-token', connectionId: jamilleGoogleConnectionId });
    listGoogleCalendars.mockReset().mockResolvedValue([{ id: 'jamille@gmail.com', summary: 'Jamille', primary: true, accessRole: 'owner' }]);

    state.userId = jamille;
    const response = await app.inject({ method: 'POST', url: '/calendar/google/accounts', payload: { external_calendar_id: 'jamille@gmail.com' } });
    expect(response.statusCode).toBe(201);

    const lista = await app.inject({ method: 'GET', url: '/calendar/google/accounts' });
    const body = lista.json() as { accounts: Array<{ external_calendar_id: string }> };
    expect(body.accounts.map((a) => a.external_calendar_id)).toEqual(['jamille@gmail.com']);

    // Alicia não vê o vínculo da Jamille — cada um só lista o PRÓPRIO.
    state.userId = alicia;
    const listaAlicia = await app.inject({ method: 'GET', url: '/calendar/google/accounts' });
    expect((listaAlicia.json() as { accounts: unknown[] }).accounts).toHaveLength(0);
  });

  it('POST /calendar/google/accounts/:id/sync só deixa a PRÓPRIA pessoa sincronizar a própria conta', async () => {
    resolveGoogleCalendarAccess.mockReset().mockResolvedValue({ accessToken: 'fake-token', connectionId: jamilleGoogleConnectionId });
    listGoogleCalendars.mockReset().mockResolvedValue([{ id: 'jamille2@gmail.com', summary: 'Jamille 2', primary: true, accessRole: 'owner' }]);

    state.userId = jamille;
    const criar = await app.inject({ method: 'POST', url: '/calendar/google/accounts', payload: { external_calendar_id: 'jamille2@gmail.com' } });
    const accountId = (criar.json() as { id: string }).id;

    state.userId = alicia;
    const tentativaAlheia = await app.inject({ method: 'POST', url: `/calendar/google/accounts/${accountId}/sync` });
    expect(tentativaAlheia.statusCode).toBe(404);

    syncMemberGoogleCalendar.mockReset().mockResolvedValue({ upserted: 3, fullSync: true });
    state.userId = jamille;
    const tentativaPropria = await app.inject({ method: 'POST', url: `/calendar/google/accounts/${accountId}/sync` });
    expect(tentativaPropria.statusCode).toBe(200);
    expect(syncMemberGoogleCalendar).toHaveBeenCalledWith(accountId);
  });

  it('POST /calendar/microsoft/accounts recusa agenda que a conexão da pessoa não enxerga (mesma régua §24 do Google)', async () => {
    resolveMicrosoftCalendarAccess.mockReset().mockResolvedValue({ accessToken: 'fake-token', connectionId: randomUUID() });
    listMicrosoftCalendars.mockReset().mockResolvedValue([{ id: 'outra-agenda-id', name: 'Outra agenda', isDefault: false, canEdit: true }]);

    state.userId = jamille;
    const response = await app.inject({ method: 'POST', url: '/calendar/microsoft/accounts', payload: { external_calendar_id: 'nao-autorizada-id' } });
    expect(response.statusCode).toBe(400);
  });

  it('POST /calendar/microsoft/accounts vincula quando a agenda está entre as acessíveis, isolado por pessoa E por provider (nunca aparece junto do Google)', async () => {
    resolveMicrosoftCalendarAccess.mockReset().mockResolvedValue({ accessToken: 'fake-token', connectionId: jamilleMicrosoftConnectionId });
    listMicrosoftCalendars.mockReset().mockResolvedValue([{ id: 'jamille@outlook.com', name: 'Jamille', isDefault: true, canEdit: true }]);

    state.userId = jamille;
    const response = await app.inject({ method: 'POST', url: '/calendar/microsoft/accounts', payload: { external_calendar_id: 'jamille@outlook.com' } });
    expect(response.statusCode).toBe(201);

    const lista = await app.inject({ method: 'GET', url: '/calendar/microsoft/accounts' });
    const body = lista.json() as { accounts: Array<{ external_calendar_id: string }> };
    expect(body.accounts.map((a) => a.external_calendar_id)).toEqual(['jamille@outlook.com']);

    // A conta Google da Jamille (já vinculada no teste anterior) não vaza pra cá — filtro por provider, não só por pessoa.
    expect(body.accounts.some((a) => a.external_calendar_id === 'jamille2@gmail.com')).toBe(false);

    const listaGoogle = await app.inject({ method: 'GET', url: '/calendar/google/accounts' });
    const bodyGoogle = listaGoogle.json() as { accounts: Array<{ external_calendar_id: string }> };
    expect(bodyGoogle.accounts.some((a) => a.external_calendar_id === 'jamille@outlook.com')).toBe(false);
  });

  it('POST /calendar/microsoft/accounts/:id/sync só deixa a PRÓPRIA pessoa sincronizar a própria conta', async () => {
    resolveMicrosoftCalendarAccess.mockReset().mockResolvedValue({ accessToken: 'fake-token', connectionId: jamilleMicrosoftConnectionId });
    listMicrosoftCalendars.mockReset().mockResolvedValue([{ id: 'jamille3@outlook.com', name: 'Jamille 3', isDefault: false, canEdit: true }]);

    state.userId = jamille;
    const criar = await app.inject({ method: 'POST', url: '/calendar/microsoft/accounts', payload: { external_calendar_id: 'jamille3@outlook.com' } });
    const accountId = (criar.json() as { id: string }).id;

    state.userId = alicia;
    const tentativaAlheia = await app.inject({ method: 'POST', url: `/calendar/microsoft/accounts/${accountId}/sync` });
    expect(tentativaAlheia.statusCode).toBe(404);

    syncMemberMicrosoftCalendar.mockReset().mockResolvedValue({ upserted: 2, cancelled: 1 });
    state.userId = jamille;
    const tentativaPropria = await app.inject({ method: 'POST', url: `/calendar/microsoft/accounts/${accountId}/sync` });
    expect(tentativaPropria.statusCode).toBe(200);
    expect(syncMemberMicrosoftCalendar).toHaveBeenCalledWith(accountId);
  });
});
