import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildMetaAuthorizeUrl,
  exchangeForLongLivedToken,
  exchangeMetaCode,
  getMetaAdAccounts,
  getMetaBusinesses,
  type MetaOAuthConfig,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { encryptToken } from '../lib/token-crypto';
import { buildOAuthState, frontendUrl, parseOAuthState } from './routes';
import { META_PROVIDER, getMetaConnection, resolveMetaAccess } from './meta-access';
import { conferirEnderecoDeRetorno } from '../lib/endereco-de-retorno';

const logger = createLogger({ service: 'integrations-meta' });

/**
 * integrations/meta-routes.ts — OAuth do Meta for Business POR COLABORADOR,
 * mesmo desenho do ClickUp (integrations/routes.ts). Só autentica "quem fala
 * com o Meta"; qual Ad Account pertence a qual cliente é decidido depois, em
 * clients/routes.ts (§38 do prompt de refinamento: credencial ≠ mapeamento).
 *
 * Arquivo separado de integrations/routes.ts de propósito: evita qualquer
 * conflito de edição com quem já mexe naquele arquivo (ClickUp/Notion).
 */
function getOAuthConfig(): MetaOAuthConfig | null {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) return null;
  return { appId, appSecret, redirectUri };
}

export async function registerMetaIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/meta/authorize', { preHandler: [requireAuth, requireModule('meta_ads')] }, async (request, reply) => {
    const config = getOAuthConfig();
    if (!config) {
      reply.code(500);
      return { error: 'META_APP_ID/META_APP_SECRET/META_REDIRECT_URI not configured on the Orchestrator' };
    }
    // Mesma armadilha do ClickUp, e o Meta é ainda menos explícito quando o
    // redirect não bate. Ver lib/endereco-de-retorno.ts.
    const retorno = await conferirEnderecoDeRetorno(config.redirectUri, 'Meta', 'META_REDIRECT_URI');
    if (!retorno.ok) {
      reply.code(503);
      return { error: retorno.motivo };
    }

    const state = buildOAuthState(request.authUser!.id);
    return { authorize_url: buildMetaAuthorizeUrl(config, state) };
  });

  /** Callback público (o Facebook redireciona o browser) — mesma defesa do ClickUp: state assinado + secret só no servidor. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/integrations/meta/callback',
    async (request, reply) => {
      const config = getOAuthConfig();
      if (!config) return reply.redirect(frontendUrl('/settings?meta=erro_config'));

      const { code, state, error } = request.query;
      if (error) {
        logger.warn({ error }, 'Pessoa negou ou cancelou a autorização do Meta');
        return reply.redirect(frontendUrl('/settings?meta=negado'));
      }
      if (!code || !state) return reply.redirect(frontendUrl('/settings?meta=erro_parametros'));

      const parsed = parseOAuthState(state);
      if (!parsed) {
        logger.warn('Callback do Meta com state inválido ou expirado');
        return reply.redirect(frontendUrl('/settings?meta=erro_state'));
      }

      try {
        const shortLivedToken = await exchangeMetaCode(config, code);
        const longLivedToken = await exchangeForLongLivedToken(config, shortLivedToken);

        await db
          .insert(schema.integrationConnections)
          .values({
            userId: parsed.userId,
            provider: META_PROVIDER,
            accessTokenEncrypted: encryptToken(longLivedToken),
            status: 'connected',
          })
          .onConflictDoUpdate({
            target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
            set: { accessTokenEncrypted: encryptToken(longLivedToken), status: 'connected', updatedAt: new Date() },
          });

        await db.insert(schema.auditLogs).values({
          userId: parsed.userId,
          action: 'integration.meta.connected',
          result: 'completed',
          metadata: {},
        });

        logger.info({ userId: parsed.userId }, 'Meta conectado');
        return reply.redirect(frontendUrl('/settings?meta=conectado'));
      } catch (err) {
        logger.error({ error: err }, 'Falha ao concluir OAuth do Meta');
        return reply.redirect(frontendUrl('/settings?meta=erro_troca'));
      }
    },
  );

  app.get('/integrations/meta/status', { preHandler: requireAuth }, async (request) => {
    const connection = await getMetaConnection(request.authUser!.id);
    if (!connection || connection.status !== 'connected') {
      return { connected: false, configured: getOAuthConfig() !== null };
    }
    return { connected: true, configured: true, connected_at: connection.createdAt.toISOString() };
  });

  app.delete('/integrations/meta', { preHandler: [requireAuth, requireModule('meta_ads')] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const connection = await getMetaConnection(userId);
    if (!connection) {
      reply.code(404);
      return { error: 'No Meta connection for this user' };
    }

    await db
      .update(schema.integrationConnections)
      .set({ status: 'revoked', accessTokenEncrypted: encryptToken(''), updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, connection.id));

    await db.insert(schema.auditLogs).values({ userId, action: 'integration.meta.disconnected', result: 'completed', metadata: {} });

    return { connected: false };
  });

  /** Business Managers que a conexão deste colaborador enxerga — alimenta o seletor em Cliente → Integrações. */
  app.get('/integrations/meta/businesses', { preHandler: [requireAuth, requireModule('meta_ads')] }, async (request, reply) => {
    const access = await resolveMetaAccess(request.authUser!.id);
    if (!access) {
      reply.code(409);
      return { error: 'Meta not connected or token expired for this user' };
    }

    try {
      return { businesses: await getMetaBusinesses(access.token) };
    } catch (err) {
      logger.error({ error: err }, 'Falha ao listar Business Managers do Meta');
      reply.code(502);
      return { error: err instanceof Error ? err.message : 'Meta businesses lookup failed' };
    }
  });

  /** Ad Accounts de uma BM (ou de todas, sem business_id) — passo seguinte do mesmo seletor. */
  app.get<{ Querystring: { business_id?: string } }>('/integrations/meta/ad-accounts', { preHandler: [requireAuth, requireModule('meta_ads')] }, async (request, reply) => {
    const access = await resolveMetaAccess(request.authUser!.id);
    if (!access) {
      reply.code(409);
      return { error: 'Meta not connected or token expired for this user' };
    }

    try {
      return { ad_accounts: await getMetaAdAccounts(access.token, request.query.business_id) };
    } catch (err) {
      logger.error({ error: err }, 'Falha ao listar Ad Accounts do Meta');
      reply.code(502);
      return { error: err instanceof Error ? err.message : 'Meta ad accounts lookup failed' };
    }
  });
}
