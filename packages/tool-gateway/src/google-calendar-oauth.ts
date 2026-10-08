import { z } from 'zod';

/**
 * google-calendar-oauth.ts — OAuth do Google Calendar POR COLABORADOR (Parte
 * F do prompt "CALENDAR + AUTOMATIONS + BENTO V2", §22-26, 06/10/2026).
 *
 * MESMA fronteira de credential vs resource do Meta Ads/Google Ads (§24): "um
 * único token da agência" nunca representa a agenda pessoal de todo mundo —
 * cada colaborador conecta A PRÓPRIA conta Google. `organization_connectors`
 * NÃO é usado aqui (ao contrário do que §22 sugere) pela mesma razão que
 * Meta/Google Ads não usam: aquela tabela é credencial POR EMPRESA (ClickUp,
 * WhatsApp — "a plataforma de tarefas desta empresa"), não por pessoa. O
 * padrão real já em produção pra "credencial pessoal, por colaborador" é
 * `integration_connections` (ver meta-access-resolver.ts) — evoluído aqui,
 * não duplicado: mesmo provider column, novo valor 'google_calendar'.
 */
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_OAUTH_AUTHORIZE_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FETCH_TIMEOUT_MS = 20_000;

async function fetchGoogle(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Google Calendar API não respondeu em ${FETCH_TIMEOUT_MS / 1000}s (timeout de rede)`);
    }
    throw error;
  }
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${context} (${response.status}): ${await response.text()}`);
}

export interface GoogleCalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * `calendar` (não `calendar.readonly`): §30 pede criar evento/Meet do lado
 * Desigual quando a conta suportar, não só ler.
 */
const SCOPES = ['https://www.googleapis.com/auth/calendar'] as const;

export function buildGoogleCalendarAuthorizeUrl(config: GoogleCalendarOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_BASE);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional() });

export interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
}

export async function exchangeGoogleCalendarCode(config: GoogleCalendarOAuthConfig, code: string): Promise<GoogleOAuthTokens> {
  const response = await fetchGoogle(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code, grant_type: 'authorization_code' }),
  });
  await assertOk(response, 'Google Calendar OAuth token exchange failed');
  const parsed = tokenResponseSchema.parse(await response.json());
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token ?? null };
}

export async function refreshGoogleCalendarAccessToken(config: Pick<GoogleCalendarOAuthConfig, 'clientId' | 'clientSecret'>, refreshToken: string): Promise<string> {
  const response = await fetchGoogle(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  await assertOk(response, 'Google Calendar OAuth token refresh failed');
  return tokenResponseSchema.parse(await response.json()).access_token;
}

const calendarListSchema = z.object({
  items: z.array(z.object({ id: z.string(), summary: z.string().nullish(), primary: z.boolean().nullish(), accessRole: z.string().nullish() })),
});

export interface GoogleCalendarListEntry {
  id: string;
  summary: string | null;
  primary: boolean;
  accessRole: string;
}

/** As agendas que este login Google enxerga — alimenta o seletor "qual agenda é a sua" (§24). */
export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const response = await fetchGoogle(`${CALENDAR_API_BASE}/users/me/calendarList`, { headers: { Authorization: `Bearer ${accessToken}` } });
  await assertOk(response, 'Google calendarList lookup failed');
  const parsed = calendarListSchema.parse(await response.json());
  return parsed.items.map((item) => ({ id: item.id, summary: item.summary ?? null, primary: item.primary ?? false, accessRole: item.accessRole ?? 'reader' }));
}

const eventsListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      summary: z.string().nullish(),
      description: z.string().nullish(),
      location: z.string().nullish(),
      visibility: z.string().nullish(),
      htmlLink: z.string().nullish(),
      hangoutLink: z.string().nullish(),
      start: z.object({ dateTime: z.string().nullish(), date: z.string().nullish(), timeZone: z.string().nullish() }),
      end: z.object({ dateTime: z.string().nullish(), date: z.string().nullish() }),
      attendees: z.array(z.object({ email: z.string().nullish(), responseStatus: z.string().nullish(), optional: z.boolean().nullish() })).optional(),
    }),
  ),
  nextPageToken: z.string().nullish(),
  nextSyncToken: z.string().nullish(),
});

export interface GoogleCalendarEvent {
  id: string;
  /** 'confirmed' | 'tentative' | 'cancelled'. */
  status: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  /** 'default' | 'public' | 'private' — mapeado 1:1 pro nosso calendar_events.visibility (§27). */
  visibility: string | null;
  meetingUrl: string | null;
  startAt: Date | null;
  endAt: Date | null;
  timezone: string | null;
  /** Evento de dia inteiro (campo `date`, não `dateTime`) — não entra na Availability Engine por ora (§17 trata só horário marcado). */
  allDay: boolean;
  attendees: Array<{ email: string; responseStatus: string; required: boolean }>;
}

export interface GoogleCalendarSyncPage {
  events: GoogleCalendarEvent[];
  nextPageToken: string | null;
  /** Só vem na ÚLTIMA página — o checkpoint pra próxima sync incremental (§25). */
  nextSyncToken: string | null;
}

/**
 * Lista eventos de UMA agenda. Com `syncToken`: incremental (só o que mudou
 * desde o checkpoint, incluindo cancelados — §25/§6 "deleted events"). Sem
 * `syncToken`: full sync, janela `timeMinIso..timeMaxIso` obrigatória (a API
 * do Google recusa full sync sem limite de tempo).
 */
export async function listGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  options: { syncToken?: string; timeMinIso?: string; timeMaxIso?: string; pageToken?: string },
): Promise<GoogleCalendarSyncPage> {
  const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('maxResults', '250');
  if (options.syncToken) {
    url.searchParams.set('syncToken', options.syncToken);
  } else {
    if (options.timeMinIso) url.searchParams.set('timeMin', options.timeMinIso);
    if (options.timeMaxIso) url.searchParams.set('timeMax', options.timeMaxIso);
  }
  if (options.pageToken) url.searchParams.set('pageToken', options.pageToken);

  const response = await fetchGoogle(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  // 410 Gone = syncToken expirado/inválido — o chamador precisa descartar o checkpoint e refazer full sync (§25).
  if (response.status === 410) {
    throw Object.assign(new Error('Google sync token expired'), { code: 'SYNC_TOKEN_EXPIRED' });
  }
  await assertOk(response, `Google events.list failed for calendar ${calendarId}`);
  const parsed = eventsListSchema.parse(await response.json());

  return {
    events: parsed.items.map((item) => {
      const allDay = Boolean(item.start.date && !item.start.dateTime);
      return {
        id: item.id,
        status: item.status,
        summary: item.summary ?? null,
        description: item.description ?? null,
        location: item.location ?? null,
        visibility: item.visibility ?? null,
        meetingUrl: item.hangoutLink ?? null,
        startAt: item.start.dateTime ? new Date(item.start.dateTime) : item.start.date ? new Date(`${item.start.date}T00:00:00Z`) : null,
        endAt: item.end.dateTime ? new Date(item.end.dateTime) : item.end.date ? new Date(`${item.end.date}T00:00:00Z`) : null,
        timezone: item.start.timeZone ?? null,
        allDay,
        attendees: (item.attendees ?? []).filter((a): a is { email: string; responseStatus: string | null | undefined; optional: boolean | null | undefined } => Boolean(a.email)).map((a) => ({
          email: a.email,
          responseStatus: a.responseStatus ?? 'needsAction',
          required: !a.optional,
        })),
      };
    }),
    nextPageToken: parsed.nextPageToken ?? null,
    nextSyncToken: parsed.nextSyncToken ?? null,
  };
}

const createdEventSchema = z.object({ id: z.string(), htmlLink: z.string().nullish(), hangoutLink: z.string().nullish() });

/** Cria evento do lado Google (§30) — só chamado quando o colaborador tem conexão Google ativa; nunca finge sucesso se a API falhar. */
export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: { summary: string; description?: string; location?: string; startIso: string; endIso: string; timezone: string; attendeeEmails?: string[]; requestMeetLink?: boolean },
): Promise<{ id: string; htmlLink: string | null; meetingUrl: string | null }> {
  const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  if (event.requestMeetLink) url.searchParams.set('conferenceDataVersion', '1');

  const response = await fetchGoogle(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.startIso, timeZone: event.timezone },
      end: { dateTime: event.endIso, timeZone: event.timezone },
      attendees: event.attendeeEmails?.map((email) => ({ email })),
      ...(event.requestMeetLink ? { conferenceData: { createRequest: { requestId: crypto.randomUUID() } } } : {}),
    }),
  });
  await assertOk(response, 'Google events.insert failed');
  const parsed = createdEventSchema.parse(await response.json());
  return { id: parsed.id, htmlLink: parsed.htmlLink ?? null, meetingUrl: parsed.hangoutLink ?? null };
}
