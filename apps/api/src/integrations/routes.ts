import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildClickUpAuthorizeUrl,
  exchangeClickUpCode,
  getAuthorizedTeams,
  type ClickUpOAuthConfig,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth, requirePermission } from '../auth/middleware';
import { encryptToken } from '../lib/token-crypto';
import { CLICKUP_PROVIDER, getClickUpConnection, resolveClickUpAccess } from './access';
import { syncClickUpClients } from './clickup-sync';

const logger = createLogger({ service: 'integrations' });
const STATE_TTL_MS = 10 * 60 * 1000;

function getOAuthConfig(): ClickUpOAuthConfig | null {
  const clientId = process.env.CLICKUP_CLIENT_ID;
  const clientSecret = process.env.CLICKUP_CLIENT_SECRET;
  const redirectUri = process.env.CLICKUP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function stateSecret(): string {
  const secret = process.env.NODE_SECRET;
  if (!secret) throw new Error('NODE_SECRET not configured; cannot sign OAuth state');
  return secret;
}

/**
 * O callback do OAuth chega como navegação do browser, sem Authorization
 * header — então o `state` é a ÚNICA coisa que diz de quem é aquele code.
 * Por isso ele é assinado (HMAC) e tem validade curta: sem assinatura,
 * qualquer um poderia forjar um state e amarrar a própria conta do ClickUp
 * ao usuário de outra pessoa.
 */
function buildOAuthState(userId: string): string {
  const payload = `${userId}.${Date.now() + STATE_TTL_MS}`;
  const signature = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

function parseOAuthState(state: string): { userId: string } | null {
  const [payloadPart, signature] = state.split('.');
  if (!payloadPart || !signature) return null;

  const payload = Buffer.from(payloadPart, 'base64url').toString('utf8');
  const expected = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

  const [userId, expiresAt] = payload.split('.');
  if (!userId || !expiresAt || Number(expiresAt) < Date.now()) return null;
  return { userId };
}

function frontendUrl(path: string): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}`;
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  /** Passo 1: o frontend chama isso e manda o browser pra `authorize_url`. */
  app.get('/integrations/clickup/authorize', { preHandler: requireAuth }, async (request, reply) => {
    const config = getOAuthConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_CLIENT_ID/CLICKUP_CLIENT_SECRET/CLICKUP_REDIRECT_URI not configured on the Orchestrator' };
    }
    const state = buildOAuthState(request.authUser!.id);
    return { authorize_url: buildClickUpAuthorizeUrl(config, state) };
  });

  /**
   * Passo 2 (PÚBLICA por definição do OAuth: é o ClickUp redirecionando o
   * browser de volta, sem token nosso). A defesa aqui é o `state` assinado
   * mais o fato de que trocar o `code` exige o client_secret, que só existe
   * no servidor. Responde com redirect pro frontend, nunca com JSON: quem
   * está do outro lado é uma aba do navegador, não um fetch.
   */
  app.get<{ Querystring: { code?: string; state?: string } }>('/integrations/clickup/callback', async (request, reply) => {
    const config = getOAuthConfig();
    if (!config) return reply.redirect(frontendUrl('/settings?clickup=erro_config'));

    const { code, state } = request.query;
    if (!code || !state) return reply.redirect(frontendUrl('/settings?clickup=erro_parametros'));

    const parsed = parseOAuthState(state);
    if (!parsed) {
      logger.warn('Callback do ClickUp com state inválido ou expirado');
      return reply.redirect(frontendUrl('/settings?clickup=erro_state'));
    }

    try {
      const token = await exchangeClickUpCode(config, code);
      const teams = await getAuthorizedTeams(token);
      const team = teams[0] ?? null;

      await db
        .insert(schema.integrationConnections)
        .values({
          userId: parsed.userId,
          provider: CLICKUP_PROVIDER,
          accessTokenEncrypted: encryptToken(token),
          externalWorkspaceId: team?.id ?? null,
          externalWorkspaceName: team?.name ?? null,
          status: 'connected',
        })
        .onConflictDoUpdate({
          target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
          set: {
            accessTokenEncrypted: encryptToken(token),
            externalWorkspaceId: team?.id ?? null,
            externalWorkspaceName: team?.name ?? null,
            status: 'connected',
            updatedAt: new Date(),
          },
        });

      await db.insert(schema.auditLogs).values({
        userId: parsed.userId,
        action: 'integration.clickup.connected',
        result: 'completed',
        metadata: { workspace_id: team?.id ?? null, workspace_name: team?.name ?? null },
      });

      logger.info({ userId: parsed.userId, workspace: team?.name }, 'ClickUp conectado');
      return reply.redirect(frontendUrl('/settings?clickup=conectado'));
    } catch (error) {
      logger.error({ error }, 'Falha ao concluir OAuth do ClickUp');
      return reply.redirect(frontendUrl('/settings?clickup=erro_troca'));
    }
  });

  app.get('/integrations/clickup/status', { preHandler: requireAuth }, async (request) => {
    const connection = await getClickUpConnection(request.authUser!.id);
    if (!connection || connection.status !== 'connected') {
      return { connected: false, configured: getOAuthConfig() !== null };
    }
    return {
      connected: true,
      configured: true,
      workspace_id: connection.externalWorkspaceId,
      workspace_name: connection.externalWorkspaceName,
      last_synced_at: connection.lastSyncedAt?.toISOString() ?? null,
      connected_at: connection.createdAt.toISOString(),
    };
  });

  /**
   * Desconectar marca como `revoked` em vez de apagar a linha (mesma lógica
   * de ACTIVE/INACTIVE pedida pro Admin: preserva histórico). O token em si
   * é sobrescrito por vazio — não faz sentido guardar segredo de uma
   * conexão que o colaborador acabou de revogar.
   */
  app.delete('/integrations/clickup', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.authUser!.id;
    const connection = await getClickUpConnection(userId);
    if (!connection) {
      reply.code(404);
      return { error: 'No ClickUp connection for this user' };
    }

    await db
      .update(schema.integrationConnections)
      .set({ status: 'revoked', accessTokenEncrypted: encryptToken(''), updatedAt: new Date() })
      .where(eq(schema.integrationConnections.id, connection.id));

    await db.insert(schema.auditLogs).values({
      userId,
      action: 'integration.clickup.disconnected',
      result: 'completed',
      metadata: {},
    });

    return { connected: false };
  });

  /**
   * Importa os CLIENTES do ClickUp. Estrutura real conferida na API em
   * 03/09/2026: cada LISTA dentro de um folder "CLIENTES *" é um cliente
   * (50 no total), e o folder define o status. Ver getClientLists().
   *
   * O ClickUp é a fonte de verdade (decisão do Endrigo): espelhamos só o
   * suficiente pra ter a área de Clientes navegável, correlacionando por
   * clients.clickup_list_id pra reimportar nunca duplicar.
   */
  app.post('/integrations/clickup/sync', { preHandler: [requireAuth, requirePermission('clients', 'write')] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const source = await resolveClickUpAccess(userId);
    if (!source) {
      reply.code(400);
      return { error: 'ClickUp is not connected for this user and no shared API key is configured' };
    }

    try {
      const result = await syncClickUpClients(source);

      if (source.connectionId) {
        await db
          .update(schema.integrationConnections)
          .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.integrationConnections.id, source.connectionId));
      }

      await db.insert(schema.auditLogs).values({
        userId,
        action: 'integration.clickup.synced',
        result: 'completed',
        metadata: { ...result, via: source.connectionId ? 'oauth' : 'shared_key' },
      });

      logger.info({ userId, ...result }, 'Sync do ClickUp concluído');
      return { spaces_found: result.found, clients_created: result.created, clients_updated: result.updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error }, 'Sync do ClickUp falhou');
      reply.code(502);
      return { error: message };
    }
  });
}
