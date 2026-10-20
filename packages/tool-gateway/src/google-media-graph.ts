import type { GoogleAdsOAuthConfig } from './google-ads-oauth';
import { runGaqlPaged } from './google-ads-oauth';
import type { MetaCreative, MetaDailyInsight, MetaEntity, MetaLevel } from './meta-media-graph';

/**
 * google-media-graph.ts — leitura do Google Ads para o Media Command Center.
 *
 * Devolve os MESMOS formatos normalizados do Meta (entidade e insight diário),
 * então o sync, as tabelas, a tela e os alertas tratam as duas plataformas
 * com o mesmo código. Só GET/consulta (GAQL `search`); nada altera conta.
 *
 * Sem developer token: o Google aposentou a exigência (ver google-ads-oauth.ts).
 *
 * Diferenças reais de plataforma que a tela precisa respeitar, e que ficam
 * explícitas aqui em vez de escondidas:
 *  - "resultado" no Google é `conversions` (pode ser fracionário e depende da
 *    ação de conversão configurada), e não equivale a "lead" do Meta;
 *  - Search não tem alcance nem frequência: ficam nulos, nunca zero;
 *  - dinheiro vem em micros (1 unidade = 1.000.000).
 */

const micros = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v) / 1_000_000);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const idFromResource = (name: unknown): string | null => (typeof name === 'string' ? (name.split('/').pop() ?? null) : null);

type Row = Record<string, unknown>;
const at = (row: Row, ...path: string[]): unknown => path.reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Row)[k] : undefined), row);

/** ENABLED/PAUSED/REMOVED do Google viram o vocabulário que a tela já usa (ACTIVE/PAUSED/...). */
export function googleEffectiveStatus(status: unknown, approval?: unknown, primary?: unknown): string | null {
  const a = str(approval);
  if (a === 'DISAPPROVED') return 'DISAPPROVED';
  if (a === 'APPROVED_LIMITED' || a === 'AREA_OF_INTEREST_ONLY') return 'WITH_ISSUES';
  const p = str(primary);
  if (p === 'NOT_ELIGIBLE') return 'WITH_ISSUES';
  const s = str(status);
  if (s === 'ENABLED') return 'ACTIVE';
  if (s === 'PAUSED') return 'PAUSED';
  if (s === 'REMOVED') return 'DELETED';
  return s;
}

export interface GoogleCustomerDetails {
  customerId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  status: string | null;
}

export async function fetchGoogleCustomerDetails(config: GoogleAdsOAuthConfig, accessToken: string, customerId: string): Promise<GoogleCustomerDetails> {
  const rows = await runGaqlPaged(config, accessToken, customerId, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer');
  const c = (rows[0]?.customer ?? {}) as Row;
  const status = str(c.status);
  return {
    customerId,
    name: str(c.descriptiveName),
    currency: str(c.currencyCode),
    timezone: str(c.timeZone),
    // Mesmo vocabulário do Meta para o indicador de saúde: ENABLED = ACTIVE.
    status: status === 'ENABLED' ? 'ACTIVE' : status,
  };
}

export function normalizeGoogleCampaign(row: Row): MetaEntity {
  return {
    level: 'campaign',
    id: String(at(row, 'campaign', 'id')),
    parentId: null,
    name: str(at(row, 'campaign', 'name')) ?? String(at(row, 'campaign', 'id')),
    status: str(at(row, 'campaign', 'status')),
    effectiveStatus: googleEffectiveStatus(at(row, 'campaign', 'status'), undefined, at(row, 'campaign', 'primaryStatus')),
    objective: str(at(row, 'campaign', 'advertisingChannelType')),
    dailyBudget: micros(at(row, 'campaignBudget', 'amountMicros')),
    lifetimeBudget: null,
    creative: null,
  };
}

export function normalizeGoogleAdGroup(row: Row): MetaEntity {
  return {
    level: 'adset',
    id: String(at(row, 'adGroup', 'id')),
    parentId: idFromResource(at(row, 'adGroup', 'campaign')),
    name: str(at(row, 'adGroup', 'name')) ?? String(at(row, 'adGroup', 'id')),
    status: str(at(row, 'adGroup', 'status')),
    effectiveStatus: googleEffectiveStatus(at(row, 'adGroup', 'status')),
    objective: str(at(row, 'adGroup', 'type')),
    dailyBudget: null,
    lifetimeBudget: null,
    creative: null,
  };
}

function textAssets(v: unknown): string[] {
  return Array.isArray(v) ? v.map((a) => str((a as Row).text)).filter((t): t is string => t !== null) : [];
}

export function normalizeGoogleAd(row: Row): MetaEntity {
  const ad = (at(row, 'adGroupAd', 'ad') ?? {}) as Row;
  const rsa = (ad.responsiveSearchAd ?? {}) as Row;
  const headlines = textAssets(rsa.headlines);
  const descriptions = textAssets(rsa.descriptions);
  const finalUrls = Array.isArray(ad.finalUrls) ? (ad.finalUrls as unknown[]) : [];
  const creative: MetaCreative = {
    id: str(ad.id),
    // Anúncio de pesquisa não tem imagem: o "criativo" é o texto. Sem miniatura, a tela mostra o texto.
    title: headlines.slice(0, 3).join(' | ') || str(ad.name),
    body: descriptions.join(' ') || null,
    callToAction: null,
    linkUrl: str(finalUrls[0]),
    thumbnailUrl: null,
    imageUrl: null,
    videoId: null,
  };
  return {
    level: 'ad',
    id: String(ad.id),
    parentId: idFromResource(at(row, 'adGroupAd', 'adGroup')),
    name: str(ad.name) ?? headlines[0] ?? `Anúncio ${String(ad.id)}`,
    status: str(at(row, 'adGroupAd', 'status')),
    effectiveStatus: googleEffectiveStatus(at(row, 'adGroupAd', 'status'), at(row, 'adGroupAd', 'policySummary', 'approvalStatus')),
    objective: str(ad.type),
    dailyBudget: null,
    lifetimeBudget: null,
    creative,
  };
}

const ENTITY_QUERY: Record<MetaLevel, string> = {
  campaign: `SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.advertising_channel_type, campaign_budget.amount_micros
             FROM campaign WHERE campaign.status != 'REMOVED'`,
  adset: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.campaign
          FROM ad_group WHERE ad_group.status != 'REMOVED'`,
  ad: `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
              ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
              ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.ad_group
       FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`,
};

export async function fetchGoogleEntities(config: GoogleAdsOAuthConfig, accessToken: string, customerId: string, level: MetaLevel): Promise<MetaEntity[]> {
  const rows = await runGaqlPaged(config, accessToken, customerId, ENTITY_QUERY[level]);
  const norm = level === 'campaign' ? normalizeGoogleCampaign : level === 'adset' ? normalizeGoogleAdGroup : normalizeGoogleAd;
  return rows.map(norm);
}

const INSIGHT_QUERY: Record<MetaLevel, (r: { since: string; until: string }) => string> = {
  campaign: (r) => `SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
                    FROM campaign WHERE segments.date BETWEEN '${r.since}' AND '${r.until}'`,
  adset: (r) => `SELECT segments.date, ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
                 FROM ad_group WHERE segments.date BETWEEN '${r.since}' AND '${r.until}'`,
  ad: (r) => `SELECT segments.date, ad_group_ad.ad.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
              FROM ad_group_ad WHERE segments.date BETWEEN '${r.since}' AND '${r.until}'`,
};

export function normalizeGoogleInsight(level: MetaLevel, row: Row): MetaDailyInsight | null {
  const entityId = level === 'campaign' ? at(row, 'campaign', 'id') : level === 'adset' ? at(row, 'adGroup', 'id') : at(row, 'adGroupAd', 'ad', 'id');
  const day = str(at(row, 'segments', 'date'));
  if (entityId === undefined || entityId === null || !day) return null;
  const conversions = numOrNull(at(row, 'metrics', 'conversions'));
  return {
    level,
    entityId: String(entityId),
    day,
    spend: micros(at(row, 'metrics', 'costMicros')),
    impressions: numOrNull(at(row, 'metrics', 'impressions')),
    reach: null,
    clicks: numOrNull(at(row, 'metrics', 'clicks')),
    results: conversions,
    resultsKind: conversions === null ? null : 'google_conversions',
    conversionValue: numOrNull(at(row, 'metrics', 'conversionsValue')),
    frequency: null,
  };
}

export async function fetchGoogleDailyInsights(config: GoogleAdsOAuthConfig, accessToken: string, customerId: string, level: MetaLevel, range: { since: string; until: string }): Promise<MetaDailyInsight[]> {
  const rows = await runGaqlPaged(config, accessToken, customerId, INSIGHT_QUERY[level](range));
  return rows.map((r) => normalizeGoogleInsight(level, r)).filter((r): r is MetaDailyInsight => r !== null);
}
