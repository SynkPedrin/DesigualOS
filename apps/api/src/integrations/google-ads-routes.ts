import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { buildGoogleAdsAuthorizeUrl, exchangeGoogleAdsCode, getGoogleAdsAccounts, type GoogleAdsOAuthConfig } from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { encryptToken } from '../lib/token-crypto';
import { buildOAuthState, frontendUrl, parseOAuthState } from './routes';
import { GOOGLE_ADS_PROVIDER, getGoogleAdsConnection, getGoogleAdsEnvConfig, resolveGoogleAdsAccess } from './google-ads-access';

const logger = createLogger({ service: 'integrations-google-ads' });

/**
 * integrations/google-ads-routes.ts — OAuth do Google Ads POR COLABORADOR,
 * mesmo desenho de meta-routes.ts. Arquivo separado pela mesma razão: evitar
 * qualquer conflito de edição com quem mexe em integrations/routes.ts.
 */
function buildFullConfig(loginCustomerId?: string): GoogleAdsOAuthConfig | null {
  const base = getGoogleAdsEnvConfig();
  if (!base) return null;
  return loginCustomerId ? { ...base, loginCustomerId } : base;
}

export async function registerGoogleAdsIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/google-ads/authorize', { preHandler: [requireAuth, requireModule('google_ads')] }, async (request, reply) => {
    const config = getGoogleAdsEnvConfig();
    if (!config) {
      reply.code(500);
      return { error: 'GOOGLE_ADS_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/DEVELOPER_TOKEN not configured on the Orchestrator' };
    }
    const state = buildOAuthState(request.authUser!.id);
    return { authorize_url: buildGoogleAdsAuthorizeUrl(config, state) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/integrations/google-ads/callback',
    async (request, reply) => {
      const config = getGoogleAdsEnvConfig();
      if (!config) return reply.redirect(frontendUrl('/settings?google_ads=erro_config'));

      const { code, state, error } = request.query;
      if (error) {
        logger.warn({ error }, 'Pessoa negou ou cancelou a autorização do Google Ads');
        return reply.redirect(frontendUrl('/settings?google_ads=negado'));
      }
      if (!code || !state) return reply.redirect(frontendUrl('/settings?google_ads=erro_parametros'));

      const parsed = parseOAuthState(state);
      if (!parsed) {
        logger.warn('Callback do Google Ads com state inválido ou expirado');
        return reply.redirect(frontendUrl('/settings?google_ads=erro_state'));
      }

      try {
        const tokens = await exchangeGoogleAdsCode(config, code);
        if (!tokens.refreshToken) {
          // Sem refresh_token a conexão morre em ~1h sem jeito de renovar. Acontece quando a
          // pessoa já tinha autorizado este App antes e o Google não reemite por padrão -
          // `prompt=consent` em buildGoogleAdsAuthorizeUrl deveria evitar isso, mas se mesmo
          // assim faltar, é melhor falhar aqui e pedir reconexão do que gravar uma conexão fantasma.
          logger.error({ userId: parsed.userId }, 'Google OAuth concluído sem refresh_token');
          return reply.redirect(frontendUrl('/settings?google_ads=erro_sem_refresh_token'));
        }

        await db
          .insert(schema.integrationConnections)
          .values({
            userId: parsed.userId,
            provider: GOOGLE_ADS_PROVIDER,
            accessTokenEncrypted: encryptToken(tokens.refreshToken),
            status: 'connected',
          })
          .onConflictDoUpdate({
            target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
            set: { accessTokenEncrypted: encryptToken(tokens.refreshToken), status: 'connected', updatedAt: new Date() },
          });

        await db.insert(schema.auditLogs).values({ userId: parsed.userId, action: 'integration.google_ads.connected', result: 'completed', metadata: {} });

        logger.info({ userId: parsed.userId }, 'Google Ads conectado');
        return reply.redirect(frontendUrl('/settings?google_ads=conectado'));
      } catch (err) {
        logger.error({ error: err }, 'Falha ao concluir OAuth do Google Ads');
        return reply.redirect(frontendUrl('/settings?google_ads=erro_troca'));
      }
    },
  );

  app.get('/integrations/google-ads/status', { preHandler: requireAuth }, async (request) => {
    const connection = await getGoogleAdsConnection(request.authUser!.id);
    if (!connection || connection.status !== 'connected') {
      return { connected: false, configured: getGoogleAdsEnvConfig() !== null };
    }
    return { connected: true, configured: true, connected_at: connection.createdAt.toISOString() };
  });

  app.delete('/integrations/google-ads', { preHandler: [requireAuth, requireModule('google_ads')] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const connection = await getGoogleAdsConnection(userId);
    if (!connection) {
      reply.code(404);
      return { error: 'No Google Ads connection for this user' };
    }

    await db
      .update(schema.integrationConnections)
      .set({ status: 'revoked', accessTokenEncrypted: encryptToken(''), updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, connection.id));

    await db.insert(schema.auditLogs).values({ userId, action: 'integration.google_ads.disconnected', result: 'completed', metadata: {} });

    return { connected: false };
  });

  /**
   * Contas acessíveis — sem `login_customer_id`: contas diretas do token.
   * Com `login_customer_id`: sub-contas daquele MCC (ver getGoogleAdsAccounts).
   * Alimenta o seletor em Cliente → Mídia, mesmo papel de /integrations/meta/ad-accounts.
   */
  app.get<{ Querystring: { login_customer_id?: string } }>('/integrations/google-ads/accounts', { preHandler: [requireAuth, requireModule('google_ads')] }, async (request, reply) => {
    const access = await resolveGoogleAdsAccess(request.authUser!.id);
    if (!access) {
      reply.code(409);
      return { error: 'Google Ads not connected or refresh token expired for this user' };
    }

    const config = buildFullConfig(request.query.login_customer_id);
    if (!config) {
      reply.code(500);
      return { error: 'Google Ads not configured on the Orchestrator' };
    }

    try {
      return { accounts: await getGoogleAdsAccounts(config, access.accessToken, request.query.login_customer_id) };
    } catch (err) {
      logger.error({ error: err }, 'Falha ao listar contas do Google Ads');
      reply.code(502);
      return { error: err instanceof Error ? err.message : 'Google Ads accounts lookup failed' };
    }
  });
}
