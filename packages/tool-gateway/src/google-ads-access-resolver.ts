import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from './token-crypto';
import { refreshGoogleAdsAccessToken, type GoogleAdsOAuthConfig } from './google-ads-oauth';

export const GOOGLE_ADS_PROVIDER = 'google_ads';

/**
 * google-ads-access-resolver.ts — movido de
 * apps/api/src/integrations/google-ads-access.ts (06/10/2026, Relatórios
 * PDF), mesmo motivo de meta-access-resolver.ts: o worker precisa gerar
 * relatório sem importar de apps/api.
 *
 * DIFERENÇA ESTRUTURAL em relação ao Meta: o que fica gravado em
 * `accessTokenEncrypted` aqui é o REFRESH_TOKEN (de longa duração), não um
 * access_token de verdade. O Google não tem o endpoint `GET /me` barato que
 * o Meta tem pra "só confirmar que ainda é válido" — renovar JÁ É a
 * confirmação, então toda leitura troca o refresh_token por um access_token
 * novo, nunca reaproveita um token em cache entre requisições.
 */
export function getGoogleAdsEnvConfig(): Omit<GoogleAdsOAuthConfig, 'loginCustomerId'> | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret || !redirectUri || !developerToken) return null;
  return { clientId, clientSecret, redirectUri, developerToken };
}

export async function getGoogleAdsConnection(userId: string) {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, GOOGLE_ADS_PROVIDER)));
  return connection ?? null;
}

export interface GoogleAdsAccess {
  accessToken: string;
  connectionId: string;
  /** `loginCustomerId` fica de fora de propósito: quem chama decide (vem da linha de client_google_ads_accounts, não da conexão). */
  config: Omit<GoogleAdsOAuthConfig, 'loginCustomerId'>;
}

/**
 * Renova o access_token a partir da conexão pessoal do colaborador. `null`
 * tanto pra "nunca conectou" quanto pra "o refresh falhou" (revogado no
 * Google, ou nunca recebemos um refresh_token) — o chamador trata os dois
 * como "sem acesso", igual ao Meta.
 */
export async function resolveGoogleAdsAccess(userId: string): Promise<GoogleAdsAccess | null> {
  const config = getGoogleAdsEnvConfig();
  if (!config) return null;

  const connection = await getGoogleAdsConnection(userId);
  if (!connection || connection.status !== 'connected') return null;

  const refreshToken = decryptToken(connection.accessTokenEncrypted);
  if (!refreshToken) return null;

  try {
    const accessToken = await refreshGoogleAdsAccessToken(config, refreshToken);
    return { accessToken, connectionId: connection.id, config };
  } catch {
    return null;
  }
}

/** Mesmo acesso, pelo `connectionId` gravado no vínculo — ver resolveMetaAccessByConnectionId pro raciocínio completo. */
export async function resolveGoogleAdsAccessByConnectionId(connectionId: string): Promise<GoogleAdsAccess | null> {
  const config = getGoogleAdsEnvConfig();
  if (!config) return null;

  const [connection] = await db.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.id, connectionId));
  if (!connection || connection.status !== 'connected') return null;

  const refreshToken = decryptToken(connection.accessTokenEncrypted);
  if (!refreshToken) return null;

  try {
    const accessToken = await refreshGoogleAdsAccessToken(config, refreshToken);
    return { accessToken, connectionId: connection.id, config };
  } catch {
    return null;
  }
}
