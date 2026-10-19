import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildMicrosoftCalendarAuthorizeUrl,
  exchangeMicrosoftCalendarCode,
  listMicrosoftCalendars,
  MICROSOFT_CALENDAR_PROVIDER,
  getMicrosoftCalendarEnvConfig,
  getMicrosoftCalendarConnection,
  resolveMicrosoftCalendarAccess,
  type MicrosoftCalendarOAuthConfig,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { encryptToken } from '../lib/token-crypto';
import { buildOAuthState, frontendUrl, parseOAuthState } from './routes';

const logger = createLogger({ service: 'integrations-microsoft-calendar' });

/**
 * integrations/microsoft-calendar-routes.ts — OAuth do Microsoft 365/Outlook
 * Calendar POR COLABORADOR (07/10/2026, pedido explícito do usuário: "o
 * calendário que a operação vai usar é o do Outlook"). MESMO desenho de
 * google-calendar-routes.ts, caminho próprio pra não colidir com quem mexe
 * em integrations/routes.ts.
 *
 * `/integrations/microsoft-calendar/authorize|callback`, NÃO
 * `/api/auth/microsoft/callback` — o registro de app já existente no Entra
 * ("desigual os - calendar") foi criado com essa segunda URL (convenção de
 * rota do Next.js, porta 3000), mas o resto da plataforma usa Fastify na API
 * (porta 3001) pra todo provider — Meta, Google Ads, Google Calendar,
 * ClickUp, Notion. Seguir essa convenção aqui, e não a URL já cadastrada,
 * evita uma segunda arquitetura de OAuth só pra este provider. Isso exige
 * trocar a redirect URI cadastrada no Entra — ver a lista de URLs de
 * redirecionamento entregue ao usuário.
 */
export async function registerMicrosoftCalendarIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/microsoft-calendar/authorize', { preHandler: [requireAuth, requireModule('calendario')] }, async (request, reply) => {
    const config = getMicrosoftCalendarEnvConfig();
    if (!config) {
      reply.code(500);
      return { error: 'MICROSOFT_CALENDAR_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI not configured on the Orchestrator' };
    }
    const state = buildOAuthState(request.authUser!.id);
    return { authorize_url: buildMicrosoftCalendarAuthorizeUrl(config, state) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/integrations/microsoft-calendar/callback', async (request, reply) => {
    const config = getMicrosoftCalendarEnvConfig();
    if (!config) return reply.redirect(frontendUrl('/calendar?microsoft_calendar=erro_config'));

    const { code, state, error } = request.query;
    if (error) return reply.redirect(frontendUrl('/calendar?microsoft_calendar=negado'));
    if (!code || !state) return reply.redirect(frontendUrl('/calendar?microsoft_calendar=erro_parametros'));

    const parsed = parseOAuthState(state);
    if (!parsed) return reply.redirect(frontendUrl('/calendar?microsoft_calendar=erro_state'));

    try {
      const tokens = await exchangeMicrosoftCalendarCode(config as MicrosoftCalendarOAuthConfig, code);
      if (!tokens.refreshToken) {
        logger.error({ userId: parsed.userId }, 'Microsoft Calendar OAuth concluído sem refresh_token');
        return reply.redirect(frontendUrl('/calendar?microsoft_calendar=erro_sem_refresh_token'));
      }

      await db
        .insert(schema.integrationConnections)
        .values({ userId: parsed.userId, provider: MICROSOFT_CALENDAR_PROVIDER, accessTokenEncrypted: encryptToken(tokens.refreshToken), status: 'connected' })
        .onConflictDoUpdate({
          target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
          set: { accessTokenEncrypted: encryptToken(tokens.refreshToken), status: 'connected', updatedAt: new Date() },
        });

      await db.insert(schema.auditLogs).values({ userId: parsed.userId, action: 'integration.microsoft_calendar.connected', result: 'completed', metadata: {} });
      logger.info({ userId: parsed.userId }, 'Microsoft Calendar conectado');
      return reply.redirect(frontendUrl('/calendar?microsoft_calendar=conectado'));
    } catch (err) {
      logger.error({ error: err }, 'Falha ao concluir OAuth do Microsoft Calendar');
      return reply.redirect(frontendUrl('/calendar?microsoft_calendar=erro_troca'));
    }
  });

  app.get('/integrations/microsoft-calendar/status', { preHandler: requireAuth }, async (request) => {
    const connection = await getMicrosoftCalendarConnection(request.authUser!.id);
    if (!connection || connection.status !== 'connected') return { connected: false, configured: getMicrosoftCalendarEnvConfig() !== null };
    return { connected: true, configured: true, connected_at: connection.createdAt.toISOString() };
  });

  app.delete('/integrations/microsoft-calendar', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.authUser!.id;
    const connection = await getMicrosoftCalendarConnection(userId);
    if (!connection) {
      reply.code(404);
      return { error: 'No Microsoft Calendar connection for this user' };
    }
    await db.update(schema.integrationConnections).set({ status: 'revoked', accessTokenEncrypted: encryptToken(''), updatedAt: new Date() }).where(eq(schema.integrationConnections.id, connection.id));
    await db.insert(schema.auditLogs).values({ userId, action: 'integration.microsoft_calendar.disconnected', result: 'completed', metadata: {} });
    // Mesma régua do Google: desconectar não apaga os eventos já sincronizados — só impede sync novo até reconectar.
    return { connected: false };
  });

  app.get('/integrations/microsoft-calendar/calendars', { preHandler: [requireAuth, requireModule('calendario')] }, async (request, reply) => {
    const connection = await getMicrosoftCalendarConnection(request.authUser!.id);
    const config = getMicrosoftCalendarEnvConfig();
    if (!connection || connection.status !== 'connected' || !config) {
      reply.code(409);
      return { error: 'Microsoft Calendar not connected for this user' };
    }
    try {
      const access = await resolveMicrosoftCalendarAccess(request.authUser!.id);
      if (!access) {
        reply.code(409);
        return { error: 'Microsoft Calendar connection expired, reconecte.' };
      }
      const agendas = await listMicrosoftCalendars(access.accessToken);
      return { calendars: agendas.map((a) => ({ id: a.id, name: a.name, is_default: a.isDefault, can_edit: a.canEdit })) };
    } catch (err) {
      logger.error({ error: err }, 'Falha ao listar agendas do Microsoft Calendar');
      reply.code(502);
      return { error: err instanceof Error ? err.message : 'Microsoft Graph /me/calendars lookup failed' };
    }
  });
}
