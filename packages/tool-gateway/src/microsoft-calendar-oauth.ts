import { z } from 'zod';

/**
 * microsoft-calendar-oauth.ts — OAuth do Microsoft 365/Outlook Calendar POR
 * COLABORADOR (07/10/2026, pedido explícito do usuário: "o calendário que a
 * operação vai usar é o do Outlook" — substitui/complementa o Google Calendar
 * já construído, reaproveitando o MESMO schema `calendar_events`/
 * `member_calendar_accounts`, só com `externalProvider`/`provider` = 'microsoft'
 * em vez de 'google' — nenhuma migration nova precisou existir).
 *
 * Contrato medido contra a documentação oficial da Microsoft (learn.microsoft.com,
 * consultado em 07/10/2026 — nunca de memória):
 *   authorize: GET https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 *   token:     POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   Graph:     GET https://graph.microsoft.com/v1.0/me/calendars
 *              GET https://graph.microsoft.com/v1.0/me/calendars/{id}/calendarView?startDateTime=...&endDateTime=...
 *
 * SEM sync incremental (delta query) nesta primeira versão — Microsoft Graph
 * suporta `@odata.deltaLink`, mas isso é uma segunda API inteira
 * (subscription + delta token) que não entrava no orçamento desta rodada.
 * Em vez disso: busca uma JANELA de tempo inteira a cada sync (como o Google
 * fazia no full-sync) e o worker (`microsoft-calendar-sync.ts`) decide o que
 * sumiu comparando com o que já estava gravado — mais chamadas de API, menos
 * sofisticado, mas correto e sem exigir infraestrutura de subscription/
 * renovação de webhook.
 */
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const MICROSOFT_OAUTH_TOKEN_URL_BASE = 'https://login.microsoftonline.com';
const FETCH_TIMEOUT_MS = 20_000;

async function fetchMicrosoft(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Microsoft Graph não respondeu em ${FETCH_TIMEOUT_MS / 1000}s (timeout de rede)`);
    }
    throw error;
  }
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${context} (${response.status}): ${await response.text()}`);
}

export interface MicrosoftCalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** 'common' (padrão) aceita contas pessoais E corporativas; um tenant id fixa numa organização só. */
  tenant: string;
}

/** `Calendars.ReadWrite` (não só `.Read`): §30-equivalente do Google — criar evento do lado Desigual quando fizer sentido, não só ler. `offline_access` é o que garante refresh_token. */
const SCOPES = ['openid', 'offline_access', 'Calendars.ReadWrite'] as const;

export function buildMicrosoftCalendarAuthorizeUrl(config: MicrosoftCalendarOAuthConfig, state: string): string {
  const url = new URL(`${MICROSOFT_OAUTH_TOKEN_URL_BASE}/${config.tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  // offline_access já pede refresh token; prompt=consent garante que ele volte
  // mesmo numa reconexão (o usuário pode já ter consentido antes sem offline_access).
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional() });

export interface MicrosoftOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
}

export async function exchangeMicrosoftCalendarCode(config: MicrosoftCalendarOAuthConfig, code: string): Promise<MicrosoftOAuthTokens> {
  const response = await fetchMicrosoft(`${MICROSOFT_OAUTH_TOKEN_URL_BASE}/${config.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: 'authorization_code',
      scope: SCOPES.join(' '),
    }),
  });
  await assertOk(response, 'Microsoft Calendar OAuth token exchange failed');
  const parsed = tokenResponseSchema.parse(await response.json());
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token ?? null };
}

export async function refreshMicrosoftCalendarAccessToken(
  config: Pick<MicrosoftCalendarOAuthConfig, 'clientId' | 'clientSecret' | 'tenant'>,
  refreshToken: string,
): Promise<MicrosoftOAuthTokens> {
  const response = await fetchMicrosoft(`${MICROSOFT_OAUTH_TOKEN_URL_BASE}/${config.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES.join(' '),
    }),
  });
  await assertOk(response, 'Microsoft Calendar OAuth token refresh failed');
  const parsed = tokenResponseSchema.parse(await response.json());
  // Microsoft pode devolver um refresh_token NOVO a cada troca — o antigo tem
  // que ser descartado (doc oficial, seção "Refresh the access token").
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token ?? null };
}

const calendarListSchema = z.object({
  value: z.array(z.object({ id: z.string(), name: z.string().nullish(), isDefaultCalendar: z.boolean().nullish(), canEdit: z.boolean().nullish() })),
});

export interface MicrosoftCalendarListEntry {
  id: string;
  name: string | null;
  isDefault: boolean;
  canEdit: boolean;
}

/** As agendas que esta conta Microsoft enxerga — mesmo papel de listGoogleCalendars no seletor "qual agenda é a sua". */
export async function listMicrosoftCalendars(accessToken: string): Promise<MicrosoftCalendarListEntry[]> {
  const response = await fetchMicrosoft(`${GRAPH_API_BASE}/me/calendars`, { headers: { Authorization: `Bearer ${accessToken}` } });
  await assertOk(response, 'Microsoft Graph /me/calendars lookup failed');
  const parsed = calendarListSchema.parse(await response.json());
  return parsed.value.map((item) => ({ id: item.id, name: item.name ?? null, isDefault: item.isDefaultCalendar ?? false, canEdit: item.canEdit ?? false }));
}

const eventsListSchema = z.object({
  value: z.array(
    z.object({
      id: z.string(),
      subject: z.string().nullish(),
      bodyPreview: z.string().nullish(),
      isCancelled: z.boolean().nullish(),
      sensitivity: z.string().nullish(),
      isAllDay: z.boolean().nullish(),
      webLink: z.string().nullish(),
      onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish(),
      location: z.object({ displayName: z.string().nullish() }).nullish(),
      start: z.object({ dateTime: z.string(), timeZone: z.string().nullish() }),
      end: z.object({ dateTime: z.string(), timeZone: z.string().nullish() }),
      attendees: z
        .array(z.object({ emailAddress: z.object({ address: z.string().nullish() }).nullish(), status: z.object({ response: z.string().nullish() }).nullish(), type: z.string().nullish() }))
        .optional(),
    }),
  ),
  '@odata.nextLink': z.string().nullish(),
});

export interface MicrosoftCalendarEvent {
  id: string;
  /** Graph não tem um "status" único tipo o Google — deriva de `isCancelled`. */
  status: 'confirmed' | 'cancelled';
  subject: string | null;
  description: string | null;
  location: string | null;
  /** 'normal' | 'private' | 'personal' | 'confidential' — mapeado pro nosso calendar_events.visibility (default/private). */
  sensitivity: string | null;
  meetingUrl: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string | null;
  allDay: boolean;
  attendees: Array<{ email: string; responseStatus: string; required: boolean }>;
}

export interface MicrosoftCalendarWindowResult {
  events: MicrosoftCalendarEvent[];
}

/**
 * `calendarView` (não `events`): devolve as instâncias DENTRO da janela,
 * já expandindo recorrência — exatamente o que `events` pede pra fazer na
 * mão (ver nota de `calendar-list-events` na doc oficial: "to get expanded
 * event instances, use calendarView"). Pagina via `@odata.nextLink` até
 * esgotar — Graph não limita por `maxResults` configurável aqui.
 */
export async function listMicrosoftCalendarEvents(accessToken: string, calendarId: string, startIso: string, endIso: string): Promise<MicrosoftCalendarWindowResult> {
  const eventos: MicrosoftCalendarEvent[] = [];
  let url: string | null = (() => {
    const u = new URL(`${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`);
    u.searchParams.set('startDateTime', startIso);
    u.searchParams.set('endDateTime', endIso);
    u.searchParams.set('$top', '100');
    return u.toString();
  })();

  while (url) {
    const response: Response = await fetchMicrosoft(url, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' } });
    await assertOk(response, `Microsoft Graph calendarView failed for calendar ${calendarId}`);
    const parsed = eventsListSchema.parse(await response.json());
    for (const item of parsed.value) {
      eventos.push({
        id: item.id,
        status: item.isCancelled ? 'cancelled' : 'confirmed',
        subject: item.subject ?? null,
        description: item.bodyPreview ?? null,
        location: item.location?.displayName ?? null,
        sensitivity: item.sensitivity ?? null,
        meetingUrl: item.onlineMeeting?.joinUrl ?? null,
        startAt: new Date(`${item.start.dateTime}Z`),
        endAt: new Date(`${item.end.dateTime}Z`),
        timezone: item.start.timeZone ?? null,
        allDay: item.isAllDay ?? false,
        attendees: (item.attendees ?? [])
          .filter((a): a is { emailAddress: { address: string }; status?: { response?: string | null } | null; type?: string | null } => Boolean(a.emailAddress?.address))
          .map((a) => ({ email: a.emailAddress.address, responseStatus: a.status?.response ?? 'none', required: a.type !== 'optional' })),
      });
    }
    url = parsed['@odata.nextLink'] ?? null;
  }

  return { events: eventos };
}

const createdEventSchema = z.object({ id: z.string(), webLink: z.string().nullish(), onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish() });

/** Cria evento do lado Microsoft — só chamado quando o colaborador tem conexão ativa; nunca finge sucesso se a API falhar. */
export async function createMicrosoftCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: { subject: string; description?: string; location?: string; startIso: string; endIso: string; timezone: string; attendeeEmails?: string[]; requestTeamsMeeting?: boolean },
): Promise<{ id: string; webLink: string | null; meetingUrl: string | null }> {
  const response = await fetchMicrosoft(`${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: event.subject,
      body: event.description ? { contentType: 'text', content: event.description } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: { dateTime: event.startIso, timeZone: event.timezone },
      end: { dateTime: event.endIso, timeZone: event.timezone },
      attendees: event.attendeeEmails?.map((email) => ({ emailAddress: { address: email }, type: 'required' })),
      isOnlineMeeting: event.requestTeamsMeeting ?? false,
      onlineMeetingProvider: event.requestTeamsMeeting ? 'teamsForBusiness' : undefined,
    }),
  });
  await assertOk(response, 'Microsoft Graph event create failed');
  const parsed = createdEventSchema.parse(await response.json());
  return { id: parsed.id, webLink: parsed.webLink ?? null, meetingUrl: parsed.onlineMeeting?.joinUrl ?? null };
}
