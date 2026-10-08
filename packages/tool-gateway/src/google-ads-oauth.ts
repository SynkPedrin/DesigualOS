import { z } from 'zod';

/**
 * google-ads-oauth.ts — OAuth do Google Ads (Part G do prompt de refinamento
 * "FINAL PRODUCT REFINEMENT", §43-45, 06/10/2026). Mesma separação do Meta
 * (meta-oauth.ts): isto só autentica "quem fala com o Google Ads"; qual
 * Customer ID pertence a qual cliente é decidido em clients/routes.ts.
 *
 * DEVELOPER TOKEN: ACABOU (sunset em 09/09/2026, confirmado na documentação
 * oficial em developers.google.com/google-ads/api/docs/api-policy/developer-token).
 *
 * Este arquivo dizia o contrário — que o Google Ads "exige um developer-token
 * aprovado em TODA chamada" e que sem ele "nenhuma leitura funciona". Era
 * verdade quando foi escrito e deixou de ser. A documentação atual diz, em
 * resumo: o header continua aceito mas é IGNORADO pelos servidores, o nível de
 * acesso passou a ser determinado pelo PROJETO DO GOOGLE CLOUD que gerou as
 * credenciais de OAuth, e o Google vai começar a REJEITAR o token numa versão
 * maior futura da API.
 *
 * Por isso aqui ele não é mais enviado. Mandar um header que hoje é ignorado e
 * amanhã é rejeitado só adianta uma quebra: o custo de parar de enviar é zero
 * agora, e o de continuar é uma falha numa data que ninguém escolhe.
 *
 * Consequência prática pra quem opera: o nível de acesso (contas de teste vs.
 * contas reais) deixou de se resolver no Google Ads API Center e passou a se
 * resolver no projeto do Google Cloud. Continua sendo configuração externa,
 * só mudou de lugar.
 *
 * Outra diferença: o access_token do Google expira em ~1h e não tem "sonda
 * barata" equivalente ao GET /me do Meta sem gastar uma chamada de verdade -
 * por isso resolveGoogleAdsAccess (google-ads-access.ts) SEMPRE renova via
 * refresh_token em vez de tentar reaproveitar um token em cache.
 */
const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? 'v19';
const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_OAUTH_AUTHORIZE_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const GOOGLE_ADS_FETCH_TIMEOUT_MS = 20_000;

async function fetchGoogle(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_ADS_FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Google Ads API não respondeu em ${GOOGLE_ADS_FETCH_TIMEOUT_MS / 1000}s (timeout de rede)`);
    }
    throw error;
  }
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text();
  throw new Error(`${context} (${response.status}): ${body}`);
}

export interface GoogleAdsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /**
   * OBSOLETO desde o sunset de 09/09/2026. Continua aceito no tipo pra que um
   * `.env` antigo com GOOGLE_ADS_DEVELOPER_TOKEN preenchido não quebre nada,
   * mas o valor não é lido nem enviado em lugar nenhum.
   */
  developerToken?: string | undefined;
  /** MCC da agência, quando as contas de cliente vivem sob um manager account. Opcional. */
  loginCustomerId?: string;
}

const SCOPES = ['https://www.googleapis.com/auth/adwords'] as const;

export function buildGoogleAdsAuthorizeUrl(config: GoogleAdsOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_BASE);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('response_type', 'code');
  // offline + consent: sem os dois juntos o Google só manda refresh_token na
  // PRIMEIRA autorização de cada conta Google - reconectar depois de revogar
  // (ou testar de novo em dev) volta sem refresh_token nenhum, em silêncio.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
});

export interface GoogleAdsTokens {
  accessToken: string;
  /** Presente só na primeira autorização (ver access_type=offline/prompt=consent acima). */
  refreshToken: string | null;
}

/** Passo 2: troca o `code` pelo par access_token (curto) + refresh_token (o que guardamos de verdade). */
export async function exchangeGoogleAdsCode(config: GoogleAdsOAuthConfig, code: string): Promise<GoogleAdsTokens> {
  const response = await fetchGoogle(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
  });
  await assertOk(response, 'Google OAuth token exchange failed');
  const parsed = tokenResponseSchema.parse(await response.json());
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token ?? null };
}

/**
 * Renova o access_token a partir do refresh_token guardado. Chamado em TODA
 * leitura (ver cabeçalho do arquivo: não existe sonda barata de validade
 * aqui) — falhar aqui com `invalid_grant` é o sinal de "a pessoa revogou o
 * acesso lá no Google", não um erro de rede transitório.
 */
export async function refreshGoogleAdsAccessToken(config: Pick<GoogleAdsOAuthConfig, 'clientId' | 'clientSecret'>, refreshToken: string): Promise<string> {
  const response = await fetchGoogle(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  await assertOk(response, 'Google OAuth token refresh failed');
  return tokenResponseSchema.parse(await response.json()).access_token;
}

function authHeaders(config: Pick<GoogleAdsOAuthConfig, 'loginCustomerId'>, accessToken: string): Record<string, string> {
  // Sem `developer-token`: ignorado pelos servidores desde 09/09/2026 e
  // marcado pra ser rejeitado numa versão maior futura. Ver o cabeçalho.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId.replace(/-/g, '');
  return headers;
}

const accessibleCustomersSchema = z.object({ resourceNames: z.array(z.string()).optional() });

/** IDs de customer que este token enxerga diretamente — só números (resourceNames vem como "customers/123..."). */
export async function listAccessibleCustomers(config: GoogleAdsOAuthConfig, accessToken: string): Promise<string[]> {
  const response = await fetchGoogle(`${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`, {
    headers: authHeaders(config, accessToken),
  });
  await assertOk(response, 'Google Ads accessible customers lookup failed');
  const parsed = accessibleCustomersSchema.parse(await response.json());
  return (parsed.resourceNames ?? []).map((name) => name.replace('customers/', ''));
}

const gaqlRowSchema = z.record(z.string(), z.unknown());
const gaqlResponseSchema = z.object({ results: z.array(gaqlRowSchema).optional() });

/** GAQL cru — toda leitura de dado (nome de conta, campanhas, métricas) passa por aqui. */
async function runGaqlQuery(config: GoogleAdsOAuthConfig, accessToken: string, customerId: string, query: string): Promise<Record<string, unknown>[]> {
  const response = await fetchGoogle(`${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: authHeaders(config, accessToken),
    body: JSON.stringify({ query }),
  });
  await assertOk(response, `Google Ads query failed for customer ${customerId}`);
  return gaqlResponseSchema.parse(await response.json()).results ?? [];
}

export interface GoogleAdsAccount {
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  status: string | null;
  /** Presente quando este customer é uma SUB-conta de um manager account (MCC) consultado. */
  managerCustomerId: string | null;
}

/**
 * Contas acessíveis, com nome e moeda já resolvidos — equivalente ao
 * getMetaAdAccounts. Sem `managerCustomerId`: usa listAccessibleCustomers
 * (contas diretas do token). Com `managerCustomerId`: lista as sub-contas
 * DAQUELE MCC via `customer_client` — é o que a tela usa depois que a pessoa
 * escolhe "sob qual MCC" procurar, pra não misturar hierarquias diferentes.
 */
export async function getGoogleAdsAccounts(config: GoogleAdsOAuthConfig, accessToken: string, managerCustomerId?: string): Promise<GoogleAdsAccount[]> {
  if (managerCustomerId) {
    const rows = await runGaqlQuery(
      config,
      accessToken,
      managerCustomerId,
      `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.status
       FROM customer_client
       WHERE customer_client.level <= 1 AND customer_client.manager = false`,
    );
    return rows.map((row) => {
      const client = row.customerClient as Record<string, unknown>;
      return {
        customerId: String(client.id),
        descriptiveName: (client.descriptiveName as string) ?? null,
        currencyCode: (client.currencyCode as string) ?? null,
        status: (client.status as string) ?? null,
        managerCustomerId,
      };
    });
  }

  const customerIds = await listAccessibleCustomers(config, accessToken);
  const accounts: GoogleAdsAccount[] = [];
  for (const customerId of customerIds) {
    try {
      const rows = await runGaqlQuery(config, accessToken, customerId, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status FROM customer LIMIT 1');
      const customer = rows[0]?.customer as Record<string, unknown> | undefined;
      accounts.push({
        customerId,
        descriptiveName: (customer?.descriptiveName as string) ?? null,
        currencyCode: (customer?.currencyCode as string) ?? null,
        status: (customer?.status as string) ?? null,
        managerCustomerId: null,
      });
    } catch {
      // Conta que o token lista mas não consegue detalhar (ex: manager sem acesso de leitura
      // a si mesmo em certas hierarquias) é pulada - uma conta problemática não derruba a lista inteira.
    }
  }
  return accounts;
}

export interface GoogleAdsAccountInsights {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  averageCpc: number | null;
  conversions: number | null;
  conversionsValue: number | null;
}

const microsToUnits = (value: unknown): number | null => (value == null ? null : Number(value) / 1_000_000);

/** Resumo agregado da conta inteira num período (§45: spend/clicks/impressions/conversions/CTR/CPC). */
/**
 * Janela de data pra Insights/Campaigns: um preset nomeado da GAQL
 * ('LAST_30_DAYS', 'THIS_MONTH'...) OU um range explícito — o Relatório PDF
 * (§46-51) precisa do range explícito pra buscar o PERÍODO ANTERIOR
 * equivalente, que nenhum preset nomeado expressa.
 */
export type GoogleAdsDateWindow = string | { since: string; until: string };

function gaqlDateClause(window: GoogleAdsDateWindow): string {
  return typeof window === 'string' ? `segments.date DURING ${window}` : `segments.date BETWEEN '${window.since}' AND '${window.until}'`;
}

export async function getGoogleAdsAccountInsights(config: GoogleAdsOAuthConfig, accessToken: string, customerId: string, dateRange: GoogleAdsDateWindow = 'LAST_30_DAYS'): Promise<GoogleAdsAccountInsights | null> {
  const rows = await runGaqlQuery(
    config,
    accessToken,
    customerId,
    `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value
     FROM customer
     WHERE ${gaqlDateClause(dateRange)}`,
  );
  const row = rows[0]?.metrics as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    spend: microsToUnits(row.costMicros),
    impressions: row.impressions != null ? Number(row.impressions) : null,
    clicks: row.clicks != null ? Number(row.clicks) : null,
    ctr: row.ctr != null ? Number(row.ctr) * 100 : null,
    averageCpc: microsToUnits(row.averageCpc),
    conversions: row.conversions != null ? Number(row.conversions) : null,
    conversionsValue: row.conversionsValue != null ? Number(row.conversionsValue) : null,
  };
}

export interface GoogleAdsCampaignSummary {
  id: string;
  name: string;
  status: string;
  spend: number | null;
  clicks: number | null;
  ctr: number | null;
}

/** Tabela de campanhas da conta (§45), já com custo do período (1 query, não N+1). */
export async function getGoogleAdsCampaigns(config: GoogleAdsOAuthConfig, accessToken: string, customerId: string, dateRange: GoogleAdsDateWindow = 'LAST_30_DAYS'): Promise<GoogleAdsCampaignSummary[]> {
  const rows = await runGaqlQuery(
    config,
    accessToken,
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.ctr
     FROM campaign
     WHERE ${gaqlDateClause(dateRange)}
     ORDER BY metrics.cost_micros DESC`,
  );
  return rows.map((row) => {
    const campaign = row.campaign as Record<string, unknown>;
    const metrics = row.metrics as Record<string, unknown>;
    return {
      id: String(campaign.id),
      name: String(campaign.name),
      status: String(campaign.status),
      spend: microsToUnits(metrics.costMicros),
      clicks: metrics.clicks != null ? Number(metrics.clicks) : null,
      ctr: metrics.ctr != null ? Number(metrics.ctr) * 100 : null,
    };
  });
}
