import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildClickUpMcpAuthorizeUrl,
  exchangeClickUpMcpCode,
  generatePkcePair,
  registerMcpClient,
} from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from '../auth/middleware';
import { decryptToken, encryptToken } from '../lib/token-crypto';

const logger = createLogger({ service: 'integrations-clickup-mcp' });
const STATE_TTL_MS = 10 * 60 * 1000;

/** Provider distinto de `clickup` (API pessoal) — mesma tabela, chave diferente (seção 13). */
export const CLICKUP_MCP_PROVIDER = 'clickup_mcp';

function stateSecret(): string {
  const secret = process.env.NODE_SECRET;
  if (!secret) throw new Error('NODE_SECRET not configured; cannot sign OAuth state');
  return secret;
}

/**
 * Diferente do OAuth pessoal (`integrations/routes.ts`): aqui o `state`
 * carrega TAMBÉM o `code_verifier` PKCE e o `client_id` da tool
 * registration dinâmica, porque não há client_secret nem sessão de servidor
 * persistente entre o passo 1 (authorize) e o passo 2 (callback) — o
 * servidor MCP não guarda isso por nós. HMAC-assinado, mesma defesa contra
 * forjar state de outro usuário.
 */
function buildMcpOAuthState(payload: { userId: string; codeVerifier: string; clientId: string }): string {
  const raw = JSON.stringify({ ...payload, exp: Date.now() + STATE_TTL_MS });
  const encoded = Buffer.from(raw).toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function parseMcpOAuthState(state: string): { userId: string; codeVerifier: string; clientId: string } | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;
  const expected = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      userId?: string;
      codeVerifier?: string;
      clientId?: string;
      exp?: number;
    };
    if (!parsed.userId || !parsed.codeVerifier || !parsed.clientId || !parsed.exp || parsed.exp < Date.now()) return null;
    return { userId: parsed.userId, codeVerifier: parsed.codeVerifier, clientId: parsed.clientId };
  } catch {
    return null;
  }
}

function frontendUrl(path: string): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}`;
}

function mcpRedirectUri(): string {
  const base = (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  return `${base}/integrations/clickup-mcp/callback`;
}

/**
 * Rotas do OAuth do ClickUp MCP (seção 13). CLICKUP MCP AUTH REQUIRED: até
 * um humano (Pedro ou outro colaborador autenticado) abrir
 * `GET /integrations/clickup-mcp/authorize` no navegador e autorizar no
 * ClickUp, nenhuma chamada MCP real funciona — isto é esperado e correto
 * (seção 37: "não inventar workarounds").
 */
export async function registerClickUpMcpOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/clickup-mcp/authorize', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const redirectUri = mcpRedirectUri();
      const { clientId } = await registerMcpClient(redirectUri);
      const { codeVerifier, codeChallenge } = generatePkcePair();
      const state = buildMcpOAuthState({ userId: request.authUser!.id, codeVerifier, clientId });
      const authorizeUrl = buildClickUpMcpAuthorizeUrl({ clientId, redirectUri, state, codeChallenge });
      return { authorize_url: authorizeUrl };
    } catch (error) {
      logger.error({ error }, 'Falha ao registrar client dinâmico do ClickUp MCP');
      reply.code(502);
      return { error: 'Não foi possível iniciar o OAuth do ClickUp MCP (registration_endpoint indisponível)' };
    }
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/integrations/clickup-mcp/callback', async (request, reply) => {
    const { code, state } = request.query;
    if (!code || !state) return reply.redirect(frontendUrl('/settings?clickup_mcp=erro_parametros'));

    const parsed = parseMcpOAuthState(state);
    if (!parsed) {
      logger.warn('Callback do ClickUp MCP com state inválido ou expirado');
      return reply.redirect(frontendUrl('/settings?clickup_mcp=erro_state'));
    }

    try {
      const token = await exchangeClickUpMcpCode({
        clientId: parsed.clientId,
        redirectUri: mcpRedirectUri(),
        code,
        codeVerifier: parsed.codeVerifier,
      });

      await db
        .insert(schema.integrationConnections)
        .values({
          userId: parsed.userId,
          provider: CLICKUP_MCP_PROVIDER,
          accessTokenEncrypted: encryptToken(token.accessToken),
          status: 'connected',
        })
        .onConflictDoUpdate({
          target: [schema.integrationConnections.userId, schema.integrationConnections.provider],
          set: { accessTokenEncrypted: encryptToken(token.accessToken), status: 'connected', updatedAt: new Date() },
        });

      await db.insert(schema.auditLogs).values({
        userId: parsed.userId,
        action: 'integration.clickup_mcp.connected',
        result: 'completed',
        metadata: {},
      });

      logger.info({ userId: parsed.userId }, 'ClickUp MCP conectado');
      return reply.redirect(frontendUrl('/settings?clickup_mcp=conectado'));
    } catch (error) {
      logger.error({ error }, 'Falha ao concluir OAuth do ClickUp MCP');
      return reply.redirect(frontendUrl('/settings?clickup_mcp=erro_troca'));
    }
  });
}

/**
 * Token decifrado da conexão MCP deste usuário, ou `null` se ainda não
 * autorizou (o call site trata `null` como "CLICKUP MCP AUTH REQUIRED",
 * nunca como fallback silencioso pro gateway legado — a decisão de fallback
 * é da camada de política, não deste helper).
 */
export async function getClickUpMcpAccessToken(userId: string): Promise<string | null> {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, CLICKUP_MCP_PROVIDER)));
  if (!connection || connection.status !== 'connected') return null;
  return decryptToken(connection.accessTokenEncrypted);
}
