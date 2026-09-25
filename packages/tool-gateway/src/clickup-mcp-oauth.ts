import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decryptToken } from './token-crypto.js';

/**
 * OAuth do ClickUp MCP (seção 12/13 da missão de release OpenAI + ClickUp
 * MCP) — DIFERENTE do OAuth pessoal do ClickUp em `clickup-oauth.ts` (que
 * autentica direto contra `api.clickup.com` com `client_id`/`client_secret`
 * fixos cadastrados no app ClickUp do Endrigo). Este aqui autentica contra
 * o SERVIDOR MCP oficial (`mcp.clickup.com`), que é um authorization server
 * próprio, separado da API REST do ClickUp.
 *
 * Metadata confirmada via `.well-known/oauth-authorization-server` em
 * 25/09/2026 (não documentação de terceiros — a resposta real do próprio
 * servidor):
 *
 *   authorization_endpoint: https://mcp.clickup.com/oauth/authorize
 *   token_endpoint:         https://mcp.clickup.com/oauth/token
 *   registration_endpoint:  https://mcp.clickup.com/oauth/register
 *   token_endpoint_auth_methods_supported: ["none"]   (cliente PÚBLICO, sem client_secret)
 *   code_challenge_methods_supported:      ["S256"]   (PKCE obrigatório)
 *   scopes_supported:       ["read","write"]
 *   grant_types_supported:  ["authorization_code"]
 *
 * "Cliente público" é o motivo pelo qual a missão instrui explicitamente
 * "não usar a API key do ClickUp como autenticação MCP" — não existe
 * client_secret aqui, e mesmo se existisse seria um mecanismo diferente do
 * da API REST.
 */

const MCP_AUTHORIZATION_SERVER = 'https://mcp.clickup.com';
const MCP_AUTHORIZE_ENDPOINT = `${MCP_AUTHORIZATION_SERVER}/oauth/authorize`;
const MCP_TOKEN_ENDPOINT = `${MCP_AUTHORIZATION_SERVER}/oauth/token`;
const MCP_REGISTER_ENDPOINT = `${MCP_AUTHORIZATION_SERVER}/oauth/register`;
export const CLICKUP_MCP_SERVER_URL = 'https://mcp.clickup.com/mcp';

const FETCH_TIMEOUT_MS = 20_000;

async function fetchMcp(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`ClickUp MCP authorization server não respondeu em ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
}

/** RFC 7636 (PKCE): verifier aleatório de 43-128 chars + challenge S256 derivado dele. */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString('base64url'); // 64 chars, dentro da faixa válida
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

const registrationResponseSchema = z.object({ client_id: z.string().min(1) });

/**
 * RFC 7591 (dynamic client registration): registra ESTE deployment como
 * cliente OAuth do servidor MCP, sob demanda. Cliente público
 * (`token_endpoint_auth_method: 'none'`) — nenhum secret volta nem é
 * necessário. Chamado uma vez por fluxo de autorização (o servidor MCP não
 * expõe um jeito documentado de listar/reusar registro anterior; registrar
 * de novo é barato e sem custo).
 */
export async function registerMcpClient(redirectUri: string): Promise<{ clientId: string }> {
  const response = await fetchMcp(MCP_REGISTER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_name: 'Desigual OS',
    }),
  });
  if (!response.ok) {
    throw new Error(`ClickUp MCP dynamic client registration falhou (${response.status}): ${await response.text()}`);
  }
  const parsed = registrationResponseSchema.parse(await response.json());
  return { clientId: parsed.client_id };
}

export interface McpAuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}

export function buildClickUpMcpAuthorizeUrl(params: McpAuthorizeParams): string {
  const url = new URL(MCP_AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', params.scope ?? 'read write');
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

export interface McpTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
}

/** Troca o code pelo access token — SEM client_secret (cliente público), com code_verifier no lugar. */
export async function exchangeClickUpMcpCode(params: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<McpTokenResult> {
  const response = await fetchMcp(MCP_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.codeVerifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`ClickUp MCP token exchange falhou (${response.status}): ${await response.text()}`);
  }
  const parsed = tokenResponseSchema.parse(await response.json());
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresInSeconds: parsed.expires_in ?? null,
  };
}

/** Provider distinto de `clickup` (API pessoal) — mesma tabela `integration_connections`, chave diferente. */
export const CLICKUP_MCP_PROVIDER = 'clickup_mcp';

/**
 * Fonte única do token MCP decifrado, consumida por `apps/api` (rotas de
 * OAuth) e `apps/worker` (bento-openai-core.ts, pra montar
 * `buildClickUpMcpTool` antes de uma chamada real). Antes desta função
 * existir, `apps/api/src/integrations/clickup-mcp-routes.ts` tinha uma
 * cópia local — apps não podem importar uns aos outros, só pacotes
 * compartilhados, então a lógica vive aqui agora.
 *
 * `null` significa "sem autorização ainda" — o chamador trata isso como
 * CLICKUP MCP AUTH REQUIRED, nunca como fallback silencioso pro gateway
 * legado (essa decisão é de quem chama, não deste helper).
 */
export async function getClickUpMcpAccessToken(userId: string): Promise<string | null> {
  const [connection] = await db
    .select()
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, CLICKUP_MCP_PROVIDER)));
  if (!connection || connection.status !== 'connected') return null;
  return decryptToken(connection.accessTokenEncrypted);
}
