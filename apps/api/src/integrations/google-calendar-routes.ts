import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildGoogleCalendarAuthorizeUrl,
  exchangeGoogleCalendarCode,
  listGoogleCalendars,
  GOOGLE_CALENDAR_PROVIDER,
  getGoogleCalendarEnvConfig,
  getGoogleCalendarConnection,
  resolveGoogleCalendarAccess,
  type GoogleCalendarOAuthConfig,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { encryptToken } from '../lib/token-crypto';
import { buildOAuthState, frontendUrl, parseOAuthState } from './routes';

const logger = createLogger({ service: 'integrations-google-calendar' });

/**
 * integrations/google-calendar-routes.ts — OAuth do Google Calendar POR
 * COLABORADOR (Parte F, 06/10/2026). Mesmo desenho de meta-routes.ts/
 * google-ads-routes.ts: arquivo separado pra não colidir com quem mexe em
 * integrations/routes.ts.
 */
export async function registerGoogleCalendarIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/google-calendar/authorize', { preHandler: [requireAuth, requireModule('calendario')] }, async (request, reply) => {
    const config = getGoogleCalendarEnvConfig();
    if (!config) {
      reply.code(500);
      return { error: 'GOOGLE_CALENDAR_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI not configured on the Orchestrator' };
    }
    const state = buildOAuthState(request.authUser!.id);
    return { authorize_url: buildGoogleCalendarAuthorizeUrl(config, state) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/integrations/google-calendar/callback', async (request, reply) => {
    const config = getGoogleCalendarEnvConfig();
    if (!config) return reply.redirect(frontendUrl('/calendar?google_calendar=erro_config'));

    const { code, state, error } = request.query;
    if (error) return reply.redirect(frontendUrl('/calendar?google_calendar=negado'));
    if (!code || !state) return reply.redirect(frontendUrl('/calendar?google_calendar=erro_parametros'));

    const parsed = parseOAuthState(state);
    if (!parsed) return reply.redirect(frontendUrl('/calendar?google_calendar=erro_state'));

    try {
      const tokens = await exchangeGoogleCalendarCode(config as GoogleCalendarOAuthConfig, code);
      if (!tokens.refreshToken) {
        logger.error({ userId: parsed.userId }, 'Google Calendar OAuth concluído sem refresh_token');
        return reply.redirect(frontendUrl('/calendar?google_calendar=erro_sem_refresh_token'));
      }

      await db
        .insert(schema.integrationConnections)
        .values({ userId: parsed.userId, provider: GOOGLE_CALENDAR_PROVIDER, accessTokenEncrypted: encryptToken(tokens.refreshToken), status: 'connected' })
        .onConflictDoUpdate({
          target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
          set: { accessTokenEncrypted: encryptToken(tokens.refreshToken), status: 'connected', updatedAt: new Date() },
        });

      await db.insert(schema.auditLogs).values({ userId: parsed.userId, action: 'integration.google_calendar.connected', result: 'completed', metadata: {} });
      logger.info({ userId: parsed.userId }, 'Google Calendar conectado');
      return reply.redirect(frontendUrl('/calendar?google_calendar=conectado'));
    } catch (err) {
      logger.error({ error: err }, 'Falha ao concluir OAuth do Google Calendar');
      return reply.redirect(frontendUrl('/calendar?google_calendar=erro_troca'));
    }
  });

  app.get('/integrations/google-calendar/status', { preHandler: requireAuth }, async (request) => {
    const connection = await getGoogleCalendarConnection(request.authUser!.id);
    if (!connection || connection.status !== 'connected') return { connected: false, configured: getGoogleCalendarEnvConfig() !== null };
    return { connected: true, configured: true, connected_at: connection.createdAt.toISOString() };
  });

  app.delete('/integrations/google-calendar', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.authUser!.id;
    const connection = await getGoogleCalendarConnection(userId);
    if (!connection) {
      reply.code(404);
      return { error: 'No Google Calendar connection for this user' };
    }
    await db.update(schema.integrationConnections).set({ status: 'revoked', accessTokenEncrypted: encryptToken(''), updatedAt: new Date() }).where(eq(schema.integrationConnections.id, connection.id));
    await db.insert(schema.auditLogs).values({ userId, action: 'integration.google_calendar.disconnected', result: 'completed', metadata: {} });
    // Desconectar não some com os eventos já sincronizados (histórico auditável, mesma régua do resto
    // do produto) — só impede sync novo até reconectar. A linha em member_calendar_accounts fica órfã
    // de connectionId na próxima sync (o resolver já trata connectionId nulo/revogado como "sem acesso").
    return { connected: false };
  });

  app.get('/integrations/google-calendar/calendars', { preHandler: [requireAuth, requireModule('calendario')] }, async (request, reply) => {
    const connection = await getGoogleCalendarConnection(request.authUser!.id);
    const config = getGoogleCalendarEnvConfig();
    if (!connection || connection.status !== 'connected' || !config) {
      reply.code(409);
      return { error: 'Google Calendar not connected for this user' };
    }
    try {
      const access = await resolveGoogleCalendarAccess(request.authUser!.id);
      if (!access) {
        reply.code(409);
        return { error: 'Google Calendar connection expired, reconecte.' };
      }
      const agendas = await listGoogleCalendars(access.accessToken);
      return { calendars: agendas.map((a) => ({ id: a.id, summary: a.summary, primary: a.primary, access_role: a.accessRole })) };
    } catch (err) {
      logger.error({ error: err }, 'Falha ao listar agendas do Google Calendar');
      reply.code(502);
      return { error: err instanceof Error ? err.message : 'Google calendarList lookup failed' };
    }
  });
}
