import { z } from 'zod';

/**
 * meta-oauth.ts — OAuth do Meta for Business (App ID + Secret da BM) pra
 * conectar Business Manager / Ad Account a um cliente (Part F do prompt de
 * refinamento "DESIGUAL OS — FINAL PRODUCT REFINEMENT", 06/10/2026).
 *
 * Mesma separação que o prompt pede (§38): esta conexão é só "quem está
 * autorizado a falar com o Meta" (o login/App do colaborador que conectou).
 * QUAL conta pertence a QUAL cliente é responsabilidade de outra tabela
 * (client_meta_accounts) e de outra camada (apps/api/src/clients/routes.ts)
 * — nunca desta.
 *
 * Versão da Graph API fixa por env (GRAPH_API_VERSION) com default numa
 * versão estável; trocar não deveria exigir redeploy de código.
 */
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const FACEBOOK_DIALOG_BASE = 'https://www.facebook.com/v21.0/dialog/oauth';

// Timeout de rede — mesmo raciocínio do clickup-oauth.ts: sem signal, uma
// instabilidade do Graph API pendura a rota inteira que chamou isto.
const META_FETCH_TIMEOUT_MS = 20_000;

async function fetchMeta(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Meta Graph API não respondeu em ${META_FETCH_TIMEOUT_MS / 1000}s (timeout de rede)`);
    }
    throw error;
  }
}

const graphErrorSchema = z.object({ error: z.object({ message: z.string() }) });

async function assertOk(response: Response, context: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text();
  const parsed = graphErrorSchema.safeParse(JSON.parse(body || '{}'));
  const message = parsed.success ? parsed.data.error.message : body;
  throw new Error(`${context} (${response.status}): ${message}`);
}

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/**
 * Escopos mínimos pra ler Business Manager, Ad Accounts e Insights — nada de
 * `ads_management` (não escrevemos campanha nenhuma, só lemos pra decisão).
 * Um app de Business normalmente precisa de App Review pra `ads_read` em
 * contas fora das do próprio desenvolvedor; isso é responsabilidade de quem
 * administra o App no developers.facebook.com, não deste código.
 */
const SCOPES = ['ads_read', 'business_management', 'read_insights'] as const;

export function buildMetaAuthorizeUrl(config: MetaOAuthConfig, state: string): string {
  const url = new URL(FACEBOOK_DIALOG_BASE);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

/** Passo 2: troca o `code` por um token de usuário de curta duração (~1-2h). */
export async function exchangeMetaCode(config: MetaOAuthConfig, code: string): Promise<string> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('client_secret', config.appSecret);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('code', code);

  const response = await fetchMeta(url);
  await assertOk(response, 'Meta token exchange failed');
  return tokenResponseSchema.parse(await response.json()).access_token;
}

/**
 * Passo 3 (obrigatório pra não pedir login de novo em 1-2h): troca o token
 * curto por um de longa duração (~60 dias). Sem refresh token — quando
 * expirar, a pessoa reconecta em Integrações, igual ao ClickUp.
 */
export async function exchangeForLongLivedToken(config: MetaOAuthConfig, shortLivedToken: string): Promise<string> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('client_secret', config.appSecret);
  url.searchParams.set('fb_exchange_token', shortLivedToken);

  const response = await fetchMeta(url);
  await assertOk(response, 'Meta long-lived token exchange failed');
  return tokenResponseSchema.parse(await response.json()).access_token;
}

/** GET /me — mais barato pra confirmar que o token ainda é aceito. */
export async function isMetaTokenValid(token: string): Promise<boolean> {
  try {
    const response = await fetchMeta(`${GRAPH_BASE}/me?access_token=${encodeURIComponent(token)}`);
    return response.ok;
  } catch {
    return false;
  }
}

const businessesSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
});

export interface MetaBusiness {
  id: string;
  name: string;
}

/** Business Managers que este usuário administra ou é parceiro. */
export async function getMetaBusinesses(token: string): Promise<MetaBusiness[]> {
  const url = new URL(`${GRAPH_BASE}/me/businesses`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', token);

  const response = await fetchMeta(url);
  await assertOk(response, 'Meta businesses lookup failed');
  return businessesSchema.parse(await response.json()).data;
}

const adAccountsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullish(),
      account_id: z.string(),
      account_status: z.number().nullish(),
      currency: z.string().nullish(),
      business: z.object({ id: z.string(), name: z.string() }).nullish(),
    }),
  ),
});

export interface MetaAdAccount {
  /** Vem com o prefixo "act_" — formato que o resto da Graph API (insights, campaigns) exige. */
  id: string;
  accountId: string;
  name: string | null;
  status: number | null;
  currency: string | null;
  businessId: string | null;
  businessName: string | null;
}

function toAdAccount(raw: z.infer<typeof adAccountsSchema>['data'][number]): MetaAdAccount {
  return {
    id: raw.id,
    accountId: raw.account_id,
    name: raw.name ?? null,
    status: raw.account_status ?? null,
    currency: raw.currency ?? null,
    businessId: raw.business?.id ?? null,
    businessName: raw.business?.name ?? null,
  };
}

/**
 * Ad Accounts visíveis a este token. Sem `businessId`: todas (via /me/adaccounts,
 * o que o usuário vê no Ads Manager dele). Com `businessId`: só as donas
 * daquele Business Manager — é o que a tela de "conectar cliente" usa depois
 * que a pessoa escolhe a BM, pra não misturar ad accounts de BMs diferentes
 * na hora de vincular ao cliente.
 */
export async function getMetaAdAccounts(token: string, businessId?: string): Promise<MetaAdAccount[]> {
  const path = businessId ? `${businessId}/owned_ad_accounts` : 'me/adaccounts';
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('fields', 'id,name,account_id,account_status,currency,business{id,name}');
  url.searchParams.set('access_token', token);

  const response = await fetchMeta(url);
  await assertOk(response, 'Meta ad accounts lookup failed');
  return adAccountsSchema.parse(await response.json()).data.map(toAdAccount);
}

const insightsSchema = z.object({
  data: z.array(
    z.object({
      spend: z.string().nullish(),
      impressions: z.string().nullish(),
      clicks: z.string().nullish(),
      ctr: z.string().nullish(),
      cpc: z.string().nullish(),
      cpm: z.string().nullish(),
      frequency: z.string().nullish(),
      date_start: z.string().nullish(),
      date_stop: z.string().nullish(),
      actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
    }),
  ),
});

export interface MetaAccountInsights {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  results: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

const toNumber = (value: string | null | undefined): number | null => (value == null ? null : Number(value));

/**
 * Janela de data pra Insights/Campaigns: um preset da própria Graph API
 * ('last_30d', 'this_month'...) OU um range explícito — o Relatório PDF
 * (§46-51) precisa do range explícito pra buscar o PERÍODO ANTERIOR
 * equivalente, que nenhum preset nomeado expressa ("os 30 dias antes dos
 * últimos 30 dias" não é `date_preset` nenhum).
 */
export type MetaDateWindow = string | { since: string; until: string };

function applyDateWindow(url: URL, window: MetaDateWindow): void {
  if (typeof window === 'string') {
    url.searchParams.set('date_preset', window);
  } else {
    url.searchParams.set('time_range', JSON.stringify(window));
  }
}

/**
 * Resumo de performance da conta inteira num período (§39 do prompt:
 * investimento/resultados/CTR/CPC/CPM/frequência). `datePreset` segue o
 * vocabulário da própria Graph API ('last_7d', 'last_30d', 'this_month'...)
 * pra não reinventar cálculo de janela de data que o Meta já resolve.
 */
export async function getMetaAccountInsights(token: string, adAccountId: string, datePreset: MetaDateWindow = 'last_30d'): Promise<MetaAccountInsights | null> {
  const url = new URL(`${GRAPH_BASE}/${adAccountId}/insights`);
  url.searchParams.set('fields', 'spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,date_start,date_stop');
  applyDateWindow(url, datePreset);
  url.searchParams.set('access_token', token);

  const response = await fetchMeta(url);
  await assertOk(response, 'Meta insights lookup failed');
  const [row] = insightsSchema.parse(await response.json()).data;
  if (!row) return null;

  const results = row.actions?.reduce((sum, action) => sum + (Number(action.value) || 0), 0) ?? null;

  return {
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    ctr: toNumber(row.ctr),
    cpc: toNumber(row.cpc),
    cpm: toNumber(row.cpm),
    frequency: toNumber(row.frequency),
    results,
    periodStart: row.date_start ?? null,
    periodEnd: row.date_stop ?? null,
  };
}

const campaignsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      insights: z
        .object({
          data: z.array(z.object({ spend: z.string().nullish(), clicks: z.string().nullish(), ctr: z.string().nullish() })),
        })
        .optional(),
    }),
  ),
});

export interface MetaCampaignSummary {
  id: string;
  name: string;
  status: string;
  spend: number | null;
  clicks: number | null;
  ctr: number | null;
}

/** Tabela de campanhas da conta (§40), cada uma já com o spend do período junto (1 chamada, não N+1). */
export async function getMetaCampaigns(token: string, adAccountId: string, datePreset: MetaDateWindow = 'last_30d'): Promise<MetaCampaignSummary[]> {
  const url = new URL(`${GRAPH_BASE}/${adAccountId}/campaigns`);
  const modificadorDeData =
    typeof datePreset === 'string' ? `date_preset(${datePreset})` : `time_range(${JSON.stringify(datePreset)})`;
  url.searchParams.set('fields', `id,name,status,insights.${modificadorDeData}{spend,clicks,ctr}`);
  url.searchParams.set('access_token', token);

  const response = await fetchMeta(url);
  await assertOk(response, 'Meta campaigns lookup failed');
  return campaignsSchema.parse(await response.json()).data.map((campaign) => {
    const insight = campaign.insights?.data[0];
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      spend: toNumber(insight?.spend),
      clicks: toNumber(insight?.clicks),
      ctr: toNumber(insight?.ctr),
    };
  });
}
