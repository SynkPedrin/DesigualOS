import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { listGoogleCalendarEvents } from './google-calendar-oauth';
import { resolveGoogleCalendarAccessByConnectionId } from './google-calendar-access-resolver';

const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';
/** Janela de full sync (§25): passado curto (reunião de 2 meses atrás não importa pra disponibilidade) até um futuro generoso. */
const FULL_SYNC_PAST_DAYS = 7;
const FULL_SYNC_FUTURE_DAYS = 180;

export interface GoogleCalendarSyncResult {
  upserted: number;
  fullSync: boolean;
}

/**
 * google-calendar-sync.ts — puxa eventos do Google pra `calendar_events`
 * (§25 do prompt: "initial sync, incremental sync, checkpoint/sync token,
 * updated events, deleted events"). Usado por `POST /calendar/google/sync`
 * (manual, API) e pelo job periódico do worker — por isso mora aqui, não em
 * apps/api (mesma razão de todo resolver nesta lista de arquivos).
 *
 * DECISÕES DELIBERADAS, documentadas em vez de escondidas:
 *  - Evento de dia inteiro (`allDay`) é IGNORADO nesta versão: não entra na
 *    Availability Engine (§17 só fala de horário marcado) e misturar um
 *    "dia todo" num grid de hora quebraria a UX sem ganho correspondente.
 *  - Convidados do Google (`attendees`) não viram `calendar_event_participants`
 *    — só o DONO da agenda sincronizada entra como participante. O que a
 *    Availability Engine precisa é "esta pessoa está ocupada", que isso já
 *    garante; cruzar e-mail de convidado externo com usuário Desigual fica
 *    pra quando houver necessidade real (hoje nenhuma tela pede isso).
 */
export async function syncMemberGoogleCalendar(accountId: string): Promise<GoogleCalendarSyncResult> {
  const [conta] = await db.select().from(schema.memberCalendarAccounts).where(eq(schema.memberCalendarAccounts.id, accountId));
  if (!conta) throw new Error(`member_calendar_accounts '${accountId}' não encontrado`);
  if (!conta.connectionId) throw new Error('Conta sem conexão OAuth associada — reconecte o Google Calendar.');

  const access = await resolveGoogleCalendarAccessByConnectionId(conta.connectionId);
  if (!access) throw new Error('Conexão Google Calendar desconectada ou expirada.');

  let syncToken = conta.syncToken ?? undefined;
  let fullSync = !syncToken;
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let upserted = 0;

  const agora = new Date();
  const timeMinIso = new Date(agora.getTime() - FULL_SYNC_PAST_DAYS * 86_400_000).toISOString();
  const timeMaxIso = new Date(agora.getTime() + FULL_SYNC_FUTURE_DAYS * 86_400_000).toISOString();

  for (;;) {
    let pagina;
    try {
      pagina = await listGoogleCalendarEvents(access.accessToken, conta.externalCalendarId, {
        ...(syncToken ? { syncToken } : { timeMinIso, timeMaxIso }),
        ...(pageToken ? { pageToken } : {}),
      });
    } catch (error) {
      // Checkpoint expirado (§25): descarta o syncToken e refaz full sync UMA vez, nunca em loop.
      if (error instanceof Error && 'code' in error && error.code === 'SYNC_TOKEN_EXPIRED' && !fullSync) {
        syncToken = undefined;
        fullSync = true;
        pageToken = undefined;
        continue;
      }
      throw error;
    }

    for (const evento of pagina.events) {
      if (evento.allDay || !evento.startAt || !evento.endAt) continue;

      const visibilidade = evento.visibility === 'private' ? 'private' : 'default';
      const status = evento.status === 'cancelled' ? 'cancelled' : evento.status === 'tentative' ? 'tentative' : 'confirmed';

      const [linha] = await db
        .insert(schema.calendarEvents)
        .values({
          organizationId: conta.organizationId,
          title: evento.summary ?? '(sem título)',
          description: evento.description,
          startAt: evento.startAt,
          endAt: evento.endAt,
          timezone: evento.timezone ?? 'America/Sao_Paulo',
          location: evento.location,
          meetingUrl: evento.meetingUrl,
          source: 'google',
          externalProvider: GOOGLE_CALENDAR_PROVIDER,
          externalEventId: evento.id,
          externalCalendarId: conta.externalCalendarId,
          visibility: visibilidade,
          status,
          createdBy: conta.userId,
        })
        .onConflictDoUpdate({
          target: [schema.calendarEvents.externalProvider, schema.calendarEvents.externalEventId, schema.calendarEvents.externalCalendarId],
          set: {
            title: evento.summary ?? '(sem título)',
            description: evento.description,
            startAt: evento.startAt,
            endAt: evento.endAt,
            location: evento.location,
            meetingUrl: evento.meetingUrl,
            visibility: visibilidade,
            status,
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

    if (pagina.nextSyncToken) nextSyncToken = pagina.nextSyncToken;
    if (!pagina.nextPageToken) break;
    pageToken = pagina.nextPageToken;
  }

  await db
    .update(schema.memberCalendarAccounts)
    .set({ syncToken: nextSyncToken ?? conta.syncToken, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.memberCalendarAccounts.id, accountId));

  return { upserted, fullSync };
}

/**
 * Contas de calendário ativas DE UM PROVIDER — o job periódico do worker
 * varre esta lista (§25, não full-fetch a cada abertura de página).
 *
 * FILTRA POR PROVIDER DE PROPÓSITO (07/10/2026, ao introduzir o Microsoft
 * Calendar): sem o filtro, o job do Google varreria TAMBÉM contas Microsoft
 * (e vice-versa) — `resolve*AccessByConnectionId` não confere o provider da
 * conexão antes de tentar renovar o token, então uma conta Microsoft caindo
 * no sync do Google falharia tarde, com um erro confuso, em vez de nunca ser
 * nem tentada.
 */
export async function listActiveMemberCalendarAccountIds(provider: string): Promise<string[]> {
  const linhas = await db
    .select({ id: schema.memberCalendarAccounts.id })
    .from(schema.memberCalendarAccounts)
    .innerJoin(schema.integrationConnections, eq(schema.integrationConnections.id, schema.memberCalendarAccounts.connectionId))
    .where(and(eq(schema.integrationConnections.status, 'connected'), eq(schema.integrationConnections.provider, provider)));
  return linhas.map((l) => l.id);
}
