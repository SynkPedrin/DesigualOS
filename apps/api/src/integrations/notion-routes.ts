import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildNotionAuthorizeUrl,
  exchangeNotionCode,
  getNotionOAuthConfig,
  listarDestinosNotion,
  variaveisFaltantesDoNotion,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { decryptToken, encryptToken } from '../lib/token-crypto';
import { buildOAuthState, frontendUrl, parseOAuthState } from './routes';
import { conferirEnderecoDeRetorno } from '../lib/endereco-de-retorno';

/**
 * notion-routes.ts — "o colaborador clica, conecta no Notion dele, e depois de
 * conectar uma vez fica sempre conectado" (pedido da operação, 28/09/2026).
 *
 * É o MESMO fluxo do ClickUp, de propósito: authorize → callback → token
 * cifrado em `integration_connections`, uma linha por (usuário, provider). O
 * `provider` daquela tabela sempre foi vocabulário aberto, então nada de
 * schema novo, e o `state` assinado é o mesmo helper — dois jeitos de assinar
 * state seriam dois jeitos de errar.
 *
 * A diferença que importa em relação a um token único da agência: a página
 * nasce no workspace de QUEM PEDIU, assinada por quem pediu no histórico do
 * Notion. Token compartilhado criaria tudo no mesmo lugar, em nome de ninguém.
 */

const logger = createLogger({ service: 'integrations-notion' });
export const NOTION_PROVIDER = 'notion';

/** O token cifrado de quem pediu, ou null quando essa pessoa nunca conectou. */
export async function getNotionToken(userId: string): Promise<string | null> {
  const [linha] = await db
    .select({ token: schema.integrationConnections.accessTokenEncrypted, status: schema.integrationConnections.status })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.userId, userId),
        eq(schema.integrationConnections.provider, NOTION_PROVIDER),
      ),
    )
    .limit(1);
  if (!linha || linha.status !== 'connected') return null;
  try {
    return decryptToken(linha.token);
  } catch (error) {
    logger.error({ error, userId }, 'Falha ao decifrar token do Notion');
    return null;
  }
}

export async function registerNotionRoutes(app: FastifyInstance): Promise<void> {
  /** Passo 1: o frontend pede a URL e manda o browser pra lá. */
  app.get('/integrations/notion/authorize', { preHandler: requireAuth }, async (request, reply) => {
    const config = getNotionOAuthConfig();
    if (!config) {
      reply.code(500);
      return {
        error: `Falta configurar no servidor: ${variaveisFaltantesDoNotion().join(', ')}. As credenciais saem de uma integração pública criada em notion.so/my-integrations.`,
      };
    }

    /**
     * O MESMO cuidado do ClickUp, pela mesma razão: endereço de retorno morto
     * vira erro no domínio do provedor, longe daqui e sem conserto à vista.
     * Ver lib/endereco-de-retorno.ts — e o histórico do túnel efêmero que
     * derrubou o ClickUp em 07/10/2026.
     */
    const retorno = await conferirEnderecoDeRetorno(config.redirectUri, 'Notion', 'NOTION_REDIRECT_URI');
    if (!retorno.ok) {
      logger.warn({ redirectUri: config.redirectUri }, 'Endereço de retorno do Notion inalcançável');
      reply.code(503);
      return { error: retorno.motivo };
    }

    return { authorize_url: buildNotionAuthorizeUrl(config, buildOAuthState(request.authUser!.id)) };
  });

  /**
   * Passo 2, PÚBLICA por definição do OAuth: quem chega aqui é o Notion
   * redirecionando uma aba do navegador, sem token nosso. A defesa é o `state`
   * assinado mais o client_secret, que só existe no servidor. Responde sempre
   * com redirect — do outro lado tem uma pessoa olhando, não um fetch.
   */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/integrations/notion/callback',
    async (request, reply) => {
      const config = getNotionOAuthConfig();
      if (!config) return reply.redirect(frontendUrl('/integrations?notion=erro_config'));
      if (request.query.error) return reply.redirect(frontendUrl('/integrations?notion=recusado'));

      const { code, state } = request.query;
      if (!code || !state) return reply.redirect(frontendUrl('/integrations?notion=erro_parametros'));

      const parsed = parseOAuthState(state);
      if (!parsed) {
        logger.warn('Callback do Notion com state inválido ou expirado');
        return reply.redirect(frontendUrl('/integrations?notion=erro_state'));
      }

      try {
        const grant = await exchangeNotionCode(config, code);
        const valores = {
          accessTokenEncrypted: encryptToken(grant.accessToken),
          externalWorkspaceId: grant.workspaceId,
          externalWorkspaceName: grant.workspaceName,
          status: 'connected',
        };
        await db
          .insert(schema.integrationConnections)
          .values({ userId: parsed.userId, provider: NOTION_PROVIDER, ...valores })
          .onConflictDoUpdate({
            target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
            set: { ...valores, updatedAt: new Date() },
          });

        await db.insert(schema.auditLogs).values({
          userId: parsed.userId,
          action: 'integration.notion.connected',
          result: 'completed',
          metadata: { workspace_id: grant.workspaceId, workspace_name: grant.workspaceName },
        });

        logger.info({ userId: parsed.userId, workspace: grant.workspaceName }, 'Notion conectado');
        return reply.redirect(frontendUrl('/integrations?notion=conectado'));
      } catch (error) {
        logger.error({ error }, 'Falha ao concluir OAuth do Notion');
        return reply.redirect(frontendUrl('/integrations?notion=erro_troca'));
      }
    },
  );

  /**
   * Status. Devolve também os DESTINOS: uma integração do Notion só enxerga o
   * que a pessoa liberou na hora de conectar, e conectar sem liberar página
   * nenhuma é o erro silencioso mais provável aqui — melhor a tela dizer isso
   * antes do primeiro `@notion` falhar.
   */
  app.get('/integrations/notion/status', { preHandler: requireAuth }, async (request) => {
    const [linha] = await db
      .select({
        workspaceName: schema.integrationConnections.externalWorkspaceName,
        status: schema.integrationConnections.status,
        updatedAt: schema.integrationConnections.updatedAt,
      })
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.userId, request.authUser!.id),
          eq(schema.integrationConnections.provider, NOTION_PROVIDER),
        ),
      )
      .limit(1);

    if (!linha || linha.status !== 'connected') {
      const faltando = variaveisFaltantesDoNotion();
      return {
        connected: false,
        workspace_name: null,
        destinos: [],
        configured: faltando.length === 0,
        // O NOME do que falta, não só o fato de faltar: quem lê este aviso na
        // agência é quem tem permissão de resolvê-lo.
        missing_env: faltando,
      };
    }

    const token = await getNotionToken(request.authUser!.id);
    const destinos = token ? await listarDestinosNotion(token, 10).catch(() => []) : [];
    return {
      connected: true,
      workspace_name: linha.workspaceName,
      connected_at: linha.updatedAt,
      destinos: destinos.map((d) => ({ id: d.id, title: d.title })),
      configured: true,
      missing_env: [],
    };
  });

  /** Desconectar marca como revogado e preserva o histórico, igual ao ClickUp. */
  app.delete('/integrations/notion', { preHandler: requireAuth }, async (request, reply) => {
    await db
      .update(schema.integrationConnections)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrationConnections.userId, request.authUser!.id),
          eq(schema.integrationConnections.provider, NOTION_PROVIDER),
        ),
      );
    await db.insert(schema.auditLogs).values({
      userId: request.authUser!.id,
      action: 'integration.notion.disconnected',
      result: 'completed',
      metadata: {},
    });
    reply.code(204);
  });
}
