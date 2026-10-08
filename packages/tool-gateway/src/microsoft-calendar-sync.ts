import { and, eq, gte, lt, ne, notInArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { listMicrosoftCalendarEvents } from './microsoft-calendar-oauth';
import { MICROSOFT_CALENDAR_PROVIDER, resolveMicrosoftCalendarAccessByConnectionId } from './microsoft-calendar-access-resolver';

/** Mesma janela do Google (§25-equivalente): passado curto, futuro generoso. */
const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 180;

export interface MicrosoftCalendarSyncResult {
  upserted: number;
  cancelled: number;
}

/**
 * microsoft-calendar-sync.ts — puxa eventos do Microsoft Graph pra
 * `calendar_events` (07/10/2026). Mesmo papel de `google-calendar-sync.ts`,
 * DESENHO DIFERENTE na detecção de cancelamento:
 *
 * Graph não tem o equivalente de `syncToken` do Google nesta integração (a
 * versão real disso, `@odata.deltaLink`, é uma API de subscription própria,
 * fora do orçamento desta rodada — ver cabeçalho de microsoft-calendar-oauth.ts).
 * Em vez de confiar num checkpoint incremental, cada sync busca a JANELA
 * inteira de novo e:
 *   1. upsert de todo evento que voltou (mesma chave `externalProvider` +
 *      `externalEventId` + `externalCalendarId` do Google);
 *   2. qualquer evento NOSSO, desta conta, com `startAt` dentro da janela,
 *      que NÃO veio na resposta — ou seja, sumiu do Outlook — vira
 *      `status='cancelled'` aqui (nunca DELETE, mesma regra do Google: "havia
 *      algo aqui" é rastro, não ausência).
 * Mais caro em chamadas de API que um delta real, mas correto, e não exige
 * infraestrutura de subscription/renovação de webhook.
 */
export async function syncMemberMicrosoftCalendar(accountId: string): Promise<MicrosoftCalendarSyncResult> {
  const [conta] = await db.select().from(schema.memberCalendarAccounts).where(eq(schema.memberCalendarAccounts.id, accountId));
  if (!conta) throw new Error(`member_calendar_accounts '${accountId}' não encontrado`);
  if (!conta.connectionId) throw new Error('Conta sem conexão OAuth associada — reconecte o Microsoft Calendar.');

  const access = await resolveMicrosoftCalendarAccessByConnectionId(conta.connectionId);
  if (!access) throw new Error('Conexão Microsoft Calendar desconectada ou expirada.');

  const agora = new Date();
  const janelaInicio = new Date(agora.getTime() - SYNC_PAST_DAYS * 86_400_000);
  const janelaFim = new Date(agora.getTime() + SYNC_FUTURE_DAYS * 86_400_000);

  const { events } = await listMicrosoftCalendarEvents(access.accessToken, conta.externalCalendarId, janelaInicio.toISOString(), janelaFim.toISOString());

  let upserted = 0;
  const idsVistos: string[] = [];

  for (const evento of events) {
    if (evento.allDay) continue; // mesma decisão do Google: dia inteiro não entra na Availability Engine.
    idsVistos.push(evento.id);

    const visibilidade = evento.sensitivity === 'private' || evento.sensitivity === 'confidential' ? 'private' : 'default';

    const [linha] = await db
      .insert(schema.calendarEvents)
      .values({
        organizationId: conta.organizationId,
        title: evento.subject ?? '(sem título)',
        description: evento.description,
        startAt: evento.startAt,
        endAt: evento.endAt,
        timezone: evento.timezone ?? 'America/Sao_Paulo',
        location: evento.location,
        meetingUrl: evento.meetingUrl,
        source: 'microsoft',
        externalProvider: MICROSOFT_CALENDAR_PROVIDER,
        externalEventId: evento.id,
        externalCalendarId: conta.externalCalendarId,
        visibility: visibilidade,
        status: evento.status,
        createdBy: conta.userId,
      })
      .onConflictDoUpdate({
        target: [schema.calendarEvents.externalProvider, schema.calendarEvents.externalEventId, schema.calendarEvents.externalCalendarId],
        set: {
          title: evento.subject ?? '(sem título)',
          description: evento.description,
          startAt: evento.startAt,
          endAt: evento.endAt,
          location: evento.location,
          meetingUrl: evento.meetingUrl,
          visibility: visibilidade,
          status: evento.status,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.calendarEvents.id });

    await db
      .insert(schema.calendarEventParticipants)
      .values({ eventId: linha!.id, memberId: conta.userId, required: true, responseStatus: 'accepted' })
      .onConflictDoNothing({ target: [schema.calendarEventParticipants.eventId, schema.calendarEventParticipants.memberId] });

    upserted += 1;
  }

  // Sumiu do Outlook DENTRO DA JANELA, mas ainda está 'confirmed'/'tentative'
  // aqui -> foi apagado/cancelado do lado de lá. Vira cancelled, nunca DELETE.
  // Escopado por startAt na janela: um evento de fora dela nunca devia ter
  // sido buscado agora, então sumir da resposta não diz nada sobre ele.
  const condicaoDeFora = [
    eq(schema.calendarEvents.externalProvider, MICROSOFT_CALENDAR_PROVIDER),
    eq(schema.calendarEvents.externalCalendarId, conta.externalCalendarId),
    ne(schema.calendarEvents.status, 'cancelled'),
    gte(schema.calendarEvents.startAt, janelaInicio),
    lt(schema.calendarEvents.startAt, janelaFim),
  ];
  if (idsVistos.length > 0) condicaoDeFora.push(notInArray(schema.calendarEvents.externalEventId, idsVistos));

  const cancelados = await db
    .update(schema.calendarEvents)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(...condicaoDeFora))
    .returning({ id: schema.calendarEvents.id });

  await db
    .update(schema.memberCalendarAccounts)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.memberCalendarAccounts.id, accountId));

  return { upserted, cancelled: cancelados.length };
}
