import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';
import type { listMicrosoftCalendarEvents as ListMicrosoftCalendarEvents } from './microsoft-calendar-oauth';
import type * as OAuthModule from './microsoft-calendar-oauth';
import type * as AccessResolverModule from './microsoft-calendar-access-resolver';

/**
 * microsoft-calendar-sync.test.ts (07/10/2026): prova a decisão específica
 * desta sync (sem syncToken, janela inteira a cada rodada) — idempotência
 * (reimportar o mesmo evento atualiza a MESMA linha) e detecção de
 * cancelamento POR AUSÊNCIA (evento que sumiu da resposta, dentro da janela,
 * vira `status='cancelled'`, nunca é apagado).
 *
 * Mesmo padrão de google-calendar-sync.test.ts: mocka os módulos vizinhos
 * por IMPORT RELATIVO (não via '@desigual-os/tool-gateway'), porque são as
 * dependências que microsoft-calendar-sync.ts importa de verdade.
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

const listMicrosoftCalendarEvents = vi.fn<typeof ListMicrosoftCalendarEvents>();

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Microsoft Calendar sync tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

vi.mock('./microsoft-calendar-oauth', async () => {
  const actual = await vi.importActual<typeof OAuthModule>('./microsoft-calendar-oauth');
  return { ...actual, listMicrosoftCalendarEvents };
});

vi.mock('./microsoft-calendar-access-resolver', async () => {
  const actual = await vi.importActual<typeof AccessResolverModule>('./microsoft-calendar-access-resolver');
  return { ...actual, resolveMicrosoftCalendarAccessByConnectionId: async () => ({ accessToken: 'fake-token', connectionId: 'fake-connection' }) };
});

describe.skipIf(!enabled)('syncMemberMicrosoftCalendar — idempotência e cancelamento por ausência (Postgres real)', () => {
  const org = randomUUID();
  const jamille = randomUUID();
  const connectionId = randomUUID();
  let accountId: string;
  let connection: Sql;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${org}, 'QA Microsoft Calendar', ${org})`;
    await connection`insert into users(id, name, email) values (${jamille}, 'Jamille', ${jamille + '@mscal-qa.invalid'})`;
    await connection`insert into integration_connections(id, user_id, provider, access_token_encrypted, status) values (${connectionId}, ${jamille}, 'microsoft_calendar', 'enc:fake-refresh', 'connected')`;
    const [conta] = await connection`insert into member_calendar_accounts(user_id, organization_id, connection_id, external_calendar_id, is_primary)
      values (${jamille}, ${org}, ${connectionId}, 'jamille@mscal-qa.invalid', true) returning id`;
    accountId = conta!.id as string;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it('full fetch cria o evento; rodada seguinte sem ele na janela marca como cancelado — na MESMA linha, nunca DELETE', async () => {
    const eventId = `mscal-${randomUUID()}`;
    const startAt = new Date(Date.now() + 3_600_000);
    const endAt = new Date(Date.now() + 7_200_000);

    listMicrosoftCalendarEvents.mockReset().mockResolvedValueOnce({
      events: [
        {
          id: eventId,
          status: 'confirmed',
          subject: 'Reunião com cliente',
          description: null,
          location: null,
          sensitivity: 'private',
          meetingUrl: 'https://teams.microsoft.com/l/meetup-join/fake',
          startAt,
          endAt,
          timezone: 'America/Sao_Paulo',
          allDay: false,
          attendees: [],
        },
      ],
    });

    const primeira = await import('@desigual-os/database');
    const resultado1 = await (await import('./microsoft-calendar-sync')).syncMemberMicrosoftCalendar(accountId);
    expect(resultado1.upserted).toBe(1);
    expect(resultado1.cancelled).toBe(0);

    const { db, schema } = primeira;
    const { eq } = await import('drizzle-orm');
    const [linha1] = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.externalEventId, eventId));
    expect(linha1?.status).toBe('confirmed');
    expect(linha1?.visibility).toBe('private'); // sensitivity 'private' mapeado 1:1 (§27-equivalente)
    expect(linha1?.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/fake');
    expect(linha1?.organizationId).toBe(org);

    const participantesAntes = await db.select().from(schema.calendarEventParticipants).where(eq(schema.calendarEventParticipants.eventId, linha1!.id));
    expect(participantesAntes).toHaveLength(1);

    // Segunda rodada: o Graph não devolve MAIS este evento na janela (foi apagado do Outlook).
    listMicrosoftCalendarEvents.mockReset().mockResolvedValueOnce({ events: [] });

    const resultado2 = await (await import('./microsoft-calendar-sync')).syncMemberMicrosoftCalendar(accountId);
    expect(resultado2.upserted).toBe(0);
    expect(resultado2.cancelled).toBe(1);

    const linhasDepois = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.externalEventId, eventId));
    expect(linhasDepois).toHaveLength(1); // NUNCA um DELETE — a mesma linha, só o status muda.
    expect(linhasDepois[0]?.status).toBe('cancelled');
  });

  it('evento fora da janela de sync nunca é tocado, mesmo sumindo da resposta', async () => {
    const eventForaDaJanela = `mscal-fora-${randomUUID()}`;
    const inicioForaDaJanela = new Date(Date.now() + 200 * 86_400_000); // bem além dos 180 dias futuros da janela

    const { db, schema } = await import('@desigual-os/database');
    const [criado] = await db
      .insert(schema.calendarEvents)
      .values({
        organizationId: org,
        title: 'Evento distante',
        startAt: inicioForaDaJanela,
        endAt: new Date(inicioForaDaJanela.getTime() + 3_600_000),
        source: 'microsoft',
        externalProvider: 'microsoft_calendar',
        externalEventId: eventForaDaJanela,
        externalCalendarId: 'jamille@mscal-qa.invalid',
        status: 'confirmed',
        createdBy: jamille,
      })
      .returning();

    listMicrosoftCalendarEvents.mockReset().mockResolvedValueOnce({ events: [] });
    await (await import('./microsoft-calendar-sync')).syncMemberMicrosoftCalendar(accountId);

    const { eq } = await import('drizzle-orm');
    const [depois] = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.id, criado!.id));
    expect(depois?.status).toBe('confirmed'); // continua intacto — nunca entrou na janela da sync pra ser candidato a cancelamento.
  });
});
