import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type { listGoogleCalendarEvents as ListGoogleCalendarEvents } from './google-calendar-oauth';
import type * as OAuthModule from './google-calendar-oauth';
import type * as AccessResolverModule from './google-calendar-access-resolver';

/**
 * google-calendar-sync.test.ts (§25/§77 do prompt "CALENDAR + AUTOMATIONS +
 * BENTO V2"): prova que a sync é IDEMPOTENTE (reimportar o mesmo evento
 * atualiza a mesma linha, nunca duplica — nem o evento, nem o participante),
 * que "deleted" vira `status='cancelled'` em vez de sumir, e que um
 * syncToken expirado (410) refaz full sync em vez de travar pra sempre.
 *
 * Mocka `./google-calendar-oauth` e `./google-calendar-access-resolver` por
 * IMPORT RELATIVO (não via '@desigual-os/tool-gateway') — são as mesmas
 * dependências que google-calendar-sync.ts importa de verdade; mockar o
 * índice público do pacote de fora não afetaria essa chamada interna (ver
 * o mesmo problema documentado em apps/api/src/clients/meta-accounts.test.ts).
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

const listGoogleCalendarEvents = vi.fn<typeof ListGoogleCalendarEvents>();

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Google Calendar sync tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('./google-calendar-oauth', async () => {
  const actual = await vi.importActual<typeof OAuthModule>('./google-calendar-oauth');
  return { ...actual, listGoogleCalendarEvents };
});

vi.mock('./google-calendar-access-resolver', async () => {
  const actual = await vi.importActual<typeof AccessResolverModule>('./google-calendar-access-resolver');
  return { ...actual, resolveGoogleCalendarAccessByConnectionId: async () => ({ accessToken: 'fake-token', connectionId: 'fake-connection' }) };
});

describe.skipIf(!enabled)('syncMemberGoogleCalendar — idempotência, cancelamento e syncToken expirado (Postgres real)', () => {
  const org = randomUUID();
  const jamille = randomUUID();
  const connectionId = randomUUID();
  let accountId: string;
  let connection: Sql;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${org}, 'QA Google Calendar', ${org})`;
    await connection`insert into users(id, name, email) values (${jamille}, 'Jamille', ${jamille + '@gcal-qa.invalid'})`;
    await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status) values (${connectionId}, ${jamille}, 'google_calendar', 'enc:fake-refresh', 'connected')`;
    const [conta] = await connection`insert into member_calendar_accounts(user_id, organization_id, connection_id, external_calendar_id, is_primary)
      values (${jamille}, ${org}, ${connectionId}, 'jamille@gcal-qa.invalid', true) returning id`;
    accountId = conta!.id as string;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it('full sync cria o evento; sync incremental seguinte marca ele como cancelado — na MESMA linha', async () => {
    const googleEventId = `gcal-${randomUUID()}`;
    listGoogleCalendarEvents.mockReset().mockResolvedValueOnce({
      events: [
        {
          id: googleEventId,
          status: 'confirmed',
          summary: 'Dentista',
          description: null,
          location: null,
          visibility: 'private',
          meetingUrl: null,
          startAt: new Date(Date.now() + 3_600_000),
          endAt: new Date(Date.now() + 7_200_000),
          timezone: 'America/Sao_Paulo',
          allDay: false,
          attendees: [],
        },
      ],
      nextPageToken: null,
      nextSyncToken: 'sync-token-1',
    });

    const primeira = await import('@desigual-os/database');
    const resultado1 = await (await import('./google-calendar-sync')).syncMemberGoogleCalendar(accountId);
    expect(resultado1.fullSync).toBe(true);
    expect(resultado1.upserted).toBe(1);

    const { db, schema } = primeira;
    const { eq } = await import('drizzle-orm');
    const [linha1] = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.externalEventId, googleEventId));
    expect(linha1?.status).toBe('confirmed');
    expect(linha1?.visibility).toBe('private'); // mapeado 1:1 — a mesma redação de privacidade da API já se aplica (§27).
    expect(linha1?.organizationId).toBe(org);

    const participantesAntes = await db.select().from(schema.calendarEventParticipants).where(eq(schema.calendarEventParticipants.eventId, linha1!.id));
    expect(participantesAntes).toHaveLength(1);

    const [contaAposPrimeira] = await db.select().from(schema.memberCalendarAccounts).where(eq(schema.memberCalendarAccounts.id, accountId));
    expect(contaAposPrimeira?.syncToken).toBe('sync-token-1');

    // Sync incremental: o MESMO evento agora vem como cancelado — idempotência: mesma linha, nunca uma segunda.
    listGoogleCalendarEvents.mockReset().mockResolvedValueOnce({
      events: [{ ...{ id: googleEventId, status: 'cancelled', summary: 'Dentista', description: null, location: null, visibility: 'private', meetingUrl: null, startAt: linha1!.startAt, endAt: linha1!.endAt, timezone: 'America/Sao_Paulo', allDay: false, attendees: [] } }],
      nextPageToken: null,
      nextSyncToken: 'sync-token-2',
    });

    const resultado2 = await (await import('./google-calendar-sync')).syncMemberGoogleCalendar(accountId);
    expect(resultado2.fullSync).toBe(false); // usou o syncToken salvo, não refez full sync
    expect(listGoogleCalendarEvents).toHaveBeenCalledWith(expect.any(String), 'jamille@gcal-qa.invalid', expect.objectContaining({ syncToken: 'sync-token-1' }));

    const linhasComMesmoExternalId = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.externalEventId, googleEventId));
    expect(linhasComMesmoExternalId).toHaveLength(1); // nunca duplicou
    expect(linhasComMesmoExternalId[0]?.status).toBe('cancelled');

    const participantesDepois = await db.select().from(schema.calendarEventParticipants).where(eq(schema.calendarEventParticipants.eventId, linha1!.id));
    expect(participantesDepois).toHaveLength(1); // onConflictDoNothing não duplicou o participante
  });

  it('syncToken expirado (410) refaz full sync automaticamente, uma vez só', async () => {
    const erro410 = Object.assign(new Error('Google sync token expired'), { code: 'SYNC_TOKEN_EXPIRED' });
    listGoogleCalendarEvents
      .mockReset()
      .mockRejectedValueOnce(erro410) // primeira tentativa, com syncToken salvo de antes
      .mockResolvedValueOnce({ events: [], nextPageToken: null, nextSyncToken: 'sync-token-3' }); // retry sem syncToken (full sync)

    const resultado = await (await import('./google-calendar-sync')).syncMemberGoogleCalendar(accountId);
    expect(resultado.fullSync).toBe(true);
    expect(listGoogleCalendarEvents).toHaveBeenCalledTimes(2);
    const segundaChamada = listGoogleCalendarEvents.mock.calls[1]!;
    expect(segundaChamada[2]).not.toHaveProperty('syncToken');
  });
});
