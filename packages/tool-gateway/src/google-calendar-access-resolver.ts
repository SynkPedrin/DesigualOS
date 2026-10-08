import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from './token-crypto';
import { refreshGoogleCalendarAccessToken, type GoogleCalendarOAuthConfig } from './google-calendar-oauth';

export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';

/**
 * google-calendar-access-resolver.ts — mesmo padrão de
 * meta-access-resolver.ts/google-ads-access-resolver.ts: fica em
 * tool-gateway (não em apps/api) porque o worker PRECISA disto pra rodar a
 * sync periódica (apps/worker/src/scheduler), e apps não importam uns dos
 * outros.
 */
export function getGoogleCalendarEnvConfig(): GoogleCalendarOAuthConfig | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export async function getGoogleCalendarConnection(userId: string) {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, GOOGLE_CALENDAR_PROVIDER)));
  return connection ?? null;
}

export interface GoogleCalendarAccess {
  accessToken: string;
  connectionId: string;
}

async function renovar(connectionId: string, refreshTokenEncrypted: string): Promise<GoogleCalendarAccess | null> {
  const config = getGoogleCalendarEnvConfig();
  if (!config) return null;
  const refreshToken = decryptToken(refreshTokenEncrypted);
  if (!refreshToken) return null;
  try {
    const accessToken = await refreshGoogleCalendarAccessToken(config, refreshToken);
    return { accessToken, connectionId };
  } catch {
    return null;
  }
}

export async function resolveGoogleCalendarAccess(userId: string): Promise<GoogleCalendarAccess | null> {
  const connection = await getGoogleCalendarConnection(userId);
  if (!connection || connection.status !== 'connected') return null;
  return renovar(connection.id, connection.accessTokenEncrypted);
}

/** Pelo `connectionId` gravado em member_calendar_accounts — o worker de sync usa este, nunca o de userId (não há "usuário olhando" num job agendado). */
export async function resolveGoogleCalendarAccessByConnectionId(connectionId: string): Promise<GoogleCalendarAccess | null> {
  const [connection] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId));
  if (!connection || connection.status !== 'connected') return null;
  return renovar(connection.id, connection.accessTokenEncrypted);
}
