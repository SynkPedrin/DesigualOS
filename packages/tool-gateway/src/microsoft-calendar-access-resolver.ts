import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken, encryptToken } from './token-crypto';
import { refreshMicrosoftCalendarAccessToken, type MicrosoftCalendarOAuthConfig } from './microsoft-calendar-oauth';

export const MICROSOFT_CALENDAR_PROVIDER = 'microsoft_calendar';

/**
 * microsoft-calendar-access-resolver.ts — mesmo padrão de
 * google-calendar-access-resolver.ts: fica em tool-gateway (não em
 * apps/api) porque o worker PRECISA disto pra rodar a sync periódica
 * (apps/worker/src/scheduler), e apps não importam uns dos outros.
 */
export function getMicrosoftCalendarEnvConfig(): MicrosoftCalendarOAuthConfig | null {
  const clientId = process.env.MICROSOFT_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_CALENDAR_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  // 'common' aceita conta pessoal E corporativa — suficiente pra uma agência
  // que não precisa travar o login num tenant Entra específico. Um valor
  // explícito em env sobrescreve quando isso for necessário.
  const tenant = process.env.MICROSOFT_CALENDAR_TENANT || 'common';
  return { clientId, clientSecret, redirectUri, tenant };
}

export async function getMicrosoftCalendarConnection(userId: string) {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, MICROSOFT_CALENDAR_PROVIDER)));
  return connection ?? null;
}

export interface MicrosoftCalendarAccess {
  accessToken: string;
  connectionId: string;
}

async function renovar(connectionId: string, refreshTokenEncrypted: string): Promise<MicrosoftCalendarAccess | null> {
  const config = getMicrosoftCalendarEnvConfig();
  if (!config) return null;
  const refreshToken = decryptToken(refreshTokenEncrypted);
  if (!refreshToken) return null;
  try {
    const tokens = await refreshMicrosoftCalendarAccessToken(config, refreshToken);
    // A Microsoft pode trocar o refresh_token a cada renovação — se vier um
    // novo, grava por cima do antigo agora, senão a PRÓXIMA renovação usaria
    // um token já descartado pela própria Microsoft e falharia.
    if (tokens.refreshToken) {
      await db.update(schema.integrationConnections).set({ accessTokenEncrypted: encryptToken(tokens.refreshToken) }).where(eq(schema.integrationConnections.id, connectionId));
    }
    return { accessToken: tokens.accessToken, connectionId };
  } catch {
    return null;
  }
}

export async function resolveMicrosoftCalendarAccess(userId: string): Promise<MicrosoftCalendarAccess | null> {
  const connection = await getMicrosoftCalendarConnection(userId);
  if (!connection || connection.status !== 'connected') return null;
  return renovar(connection.id, connection.accessTokenEncrypted);
}

/** Pelo `connectionId` gravado em member_calendar_accounts — o worker de sync usa este, nunca o de userId (não há "usuário olhando" num job agendado). */
export async function resolveMicrosoftCalendarAccessByConnectionId(connectionId: string): Promise<MicrosoftCalendarAccess | null> {
  const [connection] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId));
  if (!connection || connection.status !== 'connected') return null;
  return renovar(connection.id, connection.accessTokenEncrypted);
}
