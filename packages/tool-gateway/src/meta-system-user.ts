import { z } from 'zod';
import { getMetaAdAccounts } from './meta-oauth';

/**
 * meta-system-user.ts — conexão CENTRAL da agência com o Meta, server-to-server.
 *
 * A Business Manager da Desigual tem um Usuário do Sistema com token próprio.
 * Esse token não passa por login nem por redirect: não existe "URL bloqueada"
 * porque não existe tela de autorização. Quem precisa de OAuth é o colaborador
 * que quer conectar o PRÓPRIO Facebook; a agência lendo a PRÓPRIA BM não.
 *
 * O token vive só em variável de ambiente do servidor (META_SYSTEM_USER_TOKEN)
 * e, cifrado, na linha de `integration_connections`. Nada disso sai em
 * resposta de API: o status devolve metadados (escopos, expiração, contagens).
 *
 * Só LEITURA: os escopos exigidos são ads_read e business_management. Nenhuma
 * função daqui cria, pausa ou altera campanha.
 */

export const META_SYSTEM_PROVIDER = 'meta_system';
export const META_REQUIRED_SCOPES = ['ads_read', 'business_management'] as const;

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const TIMEOUT_MS = 20_000;

export interface MetaSystemUserConfig {
  token: string;
  businessId: string;
  appId: string | null;
  appSecret: string | null;
}

/** null quando falta token ou BM — "não configurado" é estado normal, não erro. */
export function getMetaSystemUserConfig(env: NodeJS.ProcessEnv = process.env): MetaSystemUserConfig | null {
  const token = env.META_SYSTEM_USER_TOKEN?.trim();
  const businessId = env.META_BUSINESS_ID?.trim();
  if (!token || !businessId) return null;
  return {
    token,
    businessId,
    appId: env.META_APP_ID?.trim() || null,
    appSecret: env.META_APP_SECRET?.trim() || null,
  };
}

/** Quais variáveis faltam, nomeadas — o card mostra isso em vez de "erro de configuração". */
export function missingMetaSystemUserVars(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['META_SYSTEM_USER_TOKEN', 'META_BUSINESS_ID'].filter((nome) => !env[nome]?.trim());
}

async function graphGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  if (!response.ok) {
    // Nunca ecoar a URL: ela carrega o token.
    throw new Error(`Meta Graph API (${response.status}): ${body.error?.message ?? 'erro sem mensagem'}`);
  }
  return body;
}

const debugTokenSchema = z.object({
  data: z.object({
    is_valid: z.boolean(),
    type: z.string().optional(),
    app_id: z.string().optional(),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
    scopes: z.array(z.string()).optional(),
    error: z.object({ message: z.string() }).optional(),
  }),
});

export interface MetaTokenInspection {
  valid: boolean;
  /** SYSTEM_USER / USER / PAGE. */
  type: string | null;
  scopes: string[];
  missingScopes: string[];
  /** null = token que não expira (o normal de usuário do sistema). */
  expiresAt: string | null;
  appId: string | null;
  /** Texto do Meta quando inválido. */
  reason: string | null;
}

/**
 * Valida o token e lê as permissões via /debug_token, que é a fonte que o
 * Meta oferece para isso. O token do app (`appId|appSecret`) é quem inspeciona;
 * sem app configurado cai em /me/permissions, que lista o que o token tem.
 */
export async function inspectMetaToken(config: MetaSystemUserConfig): Promise<MetaTokenInspection> {
  let valid = false;
  let type: string | null = null;
  let scopes: string[] = [];
  let expiresAt: string | null = null;
  let appId: string | null = null;
  let reason: string | null = null;

  if (config.appId && config.appSecret) {
    const raw = await graphGet('debug_token', {
      input_token: config.token,
      access_token: `${config.appId}|${config.appSecret}`,
    });
    const { data } = debugTokenSchema.parse(raw);
    valid = data.is_valid;
    type = data.type ?? null;
    scopes = data.scopes ?? [];
    appId = data.app_id ?? null;
    expiresAt = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null;
    reason = data.error?.message ?? null;
  } else {
    const raw = (await graphGet('me/permissions', { access_token: config.token })) as {
      data?: Array<{ permission: string; status: string }>;
    };
    valid = true;
    scopes = (raw.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
  }

  const missingScopes = META_REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  return { valid, type, scopes, missingScopes, expiresAt, appId, reason };
}

/** Nome da BM — confirma que o token enxerga a BM configurada, não outra qualquer. */
export async function getMetaBusinessName(token: string, businessId: string): Promise<string> {
  const raw = (await graphGet(businessId, { fields: 'id,name', access_token: token })) as { name?: string };
  return raw.name ?? businessId;
}

export interface MetaCentralContaCount {
  total: number;
  owned: number;
  client: number;
}

/** owned_ad_accounts + client_ad_accounts da BM, deduplicadas — o que "todas as contas autorizadas" significa. */
export async function countMetaBusinessAccounts(token: string, businessId: string): Promise<MetaCentralContaCount> {
  const contas = await getMetaAdAccounts(token, businessId);
  return { total: contas.length, owned: contas.filter((c) => c.businessId === businessId).length, client: contas.filter((c) => c.businessId !== businessId).length };
}

// ── Conjuntos de anúncios ─────────────────────────────────────────────────
// Campanhas, anúncios e insights já têm leitor em meta-oauth.ts; o nível de
// conjunto era o buraco entre campanha e anúncio.

const adSetsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      campaign_id: z.string().nullish(),
      daily_budget: z.string().nullish(),
      optimization_goal: z.string().nullish(),
      insights: z
        .object({
          data: z.array(
            z.object({ spend: z.string().nullish(), impressions: z.string().nullish(), clicks: z.string().nullish(), ctr: z.string().nullish() }),
          ),
        })
        .optional(),
    }),
  ),
});

export interface MetaAdSetSummary {
  id: string;
  name: string;
  status: string;
  campaignId: string | null;
  /** Em centavos da moeda da conta, como o Meta devolve. */
  dailyBudget: number | null;
  optimizationGoal: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
}

const num = (v: string | null | undefined): number | null => (v == null ? null : Number(v));

export async function getMetaAdSets(
  token: string,
  adAccountId: string,
  window: string | { since: string; until: string } = 'last_30d',
  limite = 100,
): Promise<MetaAdSetSummary[]> {
  const modificador = typeof window === 'string' ? `date_preset(${window})` : `time_range(${JSON.stringify(window)})`;
  const raw = await graphGet(`${adAccountId}/adsets`, {
    fields: `id,name,status,campaign_id,daily_budget,optimization_goal,insights.${modificador}{spend,impressions,clicks,ctr}`,
    limit: String(limite),
    access_token: token,
  });
  return adSetsSchema.parse(raw).data.map((s) => {
    const i = s.insights?.data[0];
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      campaignId: s.campaign_id ?? null,
      dailyBudget: num(s.daily_budget),
      optimizationGoal: s.optimization_goal ?? null,
      spend: num(i?.spend),
      impressions: num(i?.impressions),
      clicks: num(i?.clicks),
      ctr: num(i?.ctr),
    };
  });
}
