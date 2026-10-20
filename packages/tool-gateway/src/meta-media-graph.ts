/**
 * meta-media-graph.ts — leitura da Marketing API para o Media Command Center.
 *
 * Só GET. Nenhuma função daqui altera conta, campanha ou anúncio.
 *
 * Três cuidados que vieram de medir a API real (19/10/2026):
 *  - Insights devolve erro TRANSITÓRIO (code 2 / "Service temporarily
 *    unavailable") com frequência; sem retry com backoff o sync de uma conta
 *    inteira falhava por um soluço. `graphGetRetry` repete só o que é transitório.
 *  - O token de usuário do sistema NÃO enxerga `funding_source_details`
 *    (Permission Denied). Saldo pré-pago real, portanto, não está disponível;
 *    só limite de gastos (`spend_cap`) e total gasto (`amount_spent`).
 *  - Valores monetários do Meta vêm em UNIDADE MENOR da moeda (centavos).
 */

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const TIMEOUT_MS = 30_000;

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly transient: boolean,
    /** Limite de requisições do app/usuário/conta. Repetir em segundos só piora: a rodada deve PARAR e retomar mais tarde. */
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }
}

/** Códigos que a própria Meta documenta como "tente de novo": indisponibilidade e limite de taxa. */
const TRANSIENT_CODES = new Set([1, 2, 341]);
/** Limites de taxa (app, usuário, conta, Insights). Cooldown é de minutos, não de milissegundos. */
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80006, 80008, 80014]);

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface GraphOptions {
  retries?: number;
  sleep?: Sleep;
}

export async function graphGetRetry(url: URL, opts: GraphOptions = {}): Promise<Record<string, unknown>> {
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? realSleep;
  let lastError: MetaGraphError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number; is_transient?: boolean } };
      if (response.ok && !body.error) return body as Record<string, unknown>;
      const code = body.error?.code ?? null;
      if (code !== null && RATE_LIMIT_CODES.has(code)) {
        throw new MetaGraphError(`Meta Graph API (${response.status}/${code}): ${body.error?.message ?? 'limite de requisições'}`, response.status, code, false, true);
      }
      const transient = response.status >= 500 || (code !== null && TRANSIENT_CODES.has(code)) || body.error?.is_transient === true;
      // Nunca incluir a URL na mensagem: ela carrega o token.
      lastError = new MetaGraphError(`Meta Graph API (${response.status}${code ? `/${code}` : ''}): ${body.error?.message ?? 'erro sem mensagem'}`, response.status, code, transient);
      if (!transient) throw lastError;
    } catch (error) {
      if (error instanceof MetaGraphError) {
        if (!error.transient) throw error;
        lastError = error;
      } else {
        // timeout / rede: também vale repetir
        lastError = new MetaGraphError(`Meta Graph API sem resposta: ${error instanceof Error ? error.message : 'erro de rede'}`, 0, null, true);
      }
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastError ?? new MetaGraphError('Meta Graph API falhou', 0, null, true);
}

function buildUrl(path: string, params: Record<string, string>, token: string): URL {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  return url;
}

/**
 * Percorre as páginas com TAMANHO ADAPTATIVO. O Meta responde "Please reduce the
 * amount of data you're asking for" (code 1) ou estoura o tempo quando a página
 * é grande demais para o que foi pedido (anúncio com criativo expandido, conta
 * com dezenas de milhares de linhas diárias; medido em 20/10/2026). Repetir a
 * mesma chamada não adianta: a resposta é pedir MENOS. A página encolhe pela
 * metade, do mesmo cursor, até um mínimo; nenhuma linha é pulada nem repetida.
 */
export async function graphPaged(path: string, params: Record<string, string>, token: string, maxPages = 200, opts: GraphOptions = {}): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let limit = Number(params.limit ?? 100);
  let after: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = buildUrl(path, { ...params, limit: String(limit), ...(after ? { after } : {}) }, token);
    let body: Record<string, unknown>;
    try {
      body = await graphGetRetry(url, opts);
    } catch (error) {
      const tooBig = error instanceof MetaGraphError && (/reduce the amount of data/i.test(error.message) || error.code === 1 || (error.transient && error.status === 0));
      if (tooBig && limit > 10) {
        limit = Math.max(10, Math.floor(limit / 2));
        page -= 1; // mesma página, tamanho menor
        continue;
      }
      throw error;
    }
    rows.push(...((body.data as Array<Record<string, unknown>> | undefined) ?? []));
    const paging = body.paging as { next?: string; cursors?: { after?: string } } | undefined;
    after = paging?.next ? (paging.cursors?.after ?? null) : null;
    if (!after) break;
  }
  return rows;
}

// ── Conta ────────────────────────────────────────────────────────────────

export type BalanceKind = 'ACTUAL_BALANCE' | 'ESTIMATED_REMAINING' | 'UNAVAILABLE';

export interface MetaAccountDetails {
  id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  disableReason: number | null;
  businessId: string | null;
  balanceKind: BalanceKind;
  /** Moeda da conta, em unidade. Só preenchido quando balanceKind != UNAVAILABLE. */
  balanceAmount: number | null;
  spendCap: number | null;
  amountSpent: number | null;
}

/** Códigos de account_status da Marketing API. */
export const META_ACCOUNT_STATUS: Record<number, string> = {
  1: 'ACTIVE',
  2: 'DISABLED',
  3: 'UNSETTLED',
  7: 'PENDING_RISK_REVIEW',
  8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD',
  100: 'PENDING_CLOSURE',
  101: 'CLOSED',
  201: 'ANY_ACTIVE',
  202: 'ANY_CLOSED',
};

const minor = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : null;
};

/**
 * Saldo, com a honestidade que a API permite:
 *  - ACTUAL_BALANCE nunca sai daqui: exigiria `funding_source_details`, que o
 *    token não lê. O campo `balance` do Meta é o que a conta DEVE (pós-pago),
 *    não crédito disponível, e tratá-lo como saldo seria inventar dinheiro.
 *  - ESTIMATED_REMAINING = limite de gastos − total gasto, quando há limite.
 *    É "quanto falta para bater o limite", não saldo em conta.
 */
export function deriveBalance(spendCap: number | null, amountSpent: number | null): { kind: BalanceKind; amount: number | null } {
  if (spendCap !== null && spendCap > 0 && amountSpent !== null) {
    return { kind: 'ESTIMATED_REMAINING', amount: Math.max(0, Math.round((spendCap - amountSpent) * 100) / 100) };
  }
  return { kind: 'UNAVAILABLE', amount: null };
}

export function normalizeAccount(raw: Record<string, unknown>): MetaAccountDetails {
  const spendCap = minor(raw.spend_cap);
  const amountSpent = minor(raw.amount_spent);
  const { kind, amount } = deriveBalance(spendCap, amountSpent);
  const statusCode = typeof raw.account_status === 'number' ? raw.account_status : null;
  const business = raw.business as { id?: string } | undefined;
  return {
    id: String(raw.id),
    name: (raw.name as string | undefined) ?? null,
    currency: (raw.currency as string | undefined) ?? null,
    timezone: (raw.timezone_name as string | undefined) ?? null,
    status: statusCode === null ? null : (META_ACCOUNT_STATUS[statusCode] ?? `STATUS_${statusCode}`),
    disableReason: typeof raw.disable_reason === 'number' ? raw.disable_reason : null,
    businessId: business?.id ?? null,
    balanceKind: kind,
    balanceAmount: amount,
    spendCap,
    amountSpent,
  };
}

const ACCOUNT_FIELDS = 'id,name,currency,timezone_name,account_status,disable_reason,spend_cap,amount_spent,business{id,name}';

export async function fetchMetaAccountDetails(token: string, adAccountId: string, opts?: GraphOptions): Promise<MetaAccountDetails> {
  return normalizeAccount(await graphGetRetry(buildUrl(adAccountId, { fields: ACCOUNT_FIELDS }, token), opts));
}

/** Contas de uma BM (próprias + de clientes) já com moeda, fuso e limite. */
export async function fetchMetaBusinessAccountDetails(token: string, businessId: string, opts?: GraphOptions): Promise<MetaAccountDetails[]> {
  const porId = new Map<string, MetaAccountDetails>();
  for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
    const rows = await graphPaged(`${businessId}/${edge}`, { fields: ACCOUNT_FIELDS, limit: '100' }, token, 20, opts);
    for (const r of rows) {
      const d = normalizeAccount(r);
      porId.set(d.id, d);
    }
  }
  return [...porId.values()];
}

// ── Hierarquia ───────────────────────────────────────────────────────────

export type MetaLevel = 'campaign' | 'adset' | 'ad';

export interface MetaEntity {
  level: MetaLevel;
  id: string;
  parentId: string | null;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  creative: MetaCreative | null;
}

export interface MetaCreative {
  id: string | null;
  title: string | null;
  body: string | null;
  callToAction: string | null;
  linkUrl: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
}

const CREATIVE_FIELDS = 'creative{id,title,body,call_to_action_type,thumbnail_url,image_url,video_id,object_story_spec{link_data{link,call_to_action{value{link}}},video_data{call_to_action{value{link}}}}}';

const ENTITY_FIELDS: Record<MetaLevel, string> = {
  campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget',
  adset: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal',
  ad: `id,name,status,effective_status,adset_id,campaign_id,${CREATIVE_FIELDS}`,
};

const EDGE: Record<MetaLevel, string> = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' };

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function normalizeCreative(raw: unknown): MetaCreative | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const story = c.object_story_spec as { link_data?: { link?: string; call_to_action?: { value?: { link?: string } } }; video_data?: { call_to_action?: { value?: { link?: string } } } } | undefined;
  const linkUrl = str(story?.link_data?.link) ?? str(story?.link_data?.call_to_action?.value?.link) ?? str(story?.video_data?.call_to_action?.value?.link);
  return {
    id: str(c.id),
    title: str(c.title),
    body: str(c.body),
    callToAction: str(c.call_to_action_type),
    linkUrl,
    thumbnailUrl: str(c.thumbnail_url),
    imageUrl: str(c.image_url),
    videoId: str(c.video_id),
  };
}

export function normalizeEntity(level: MetaLevel, raw: Record<string, unknown>): MetaEntity {
  const parentId = level === 'adset' ? str(raw.campaign_id) : level === 'ad' ? str(raw.adset_id) : null;
  return {
    level,
    id: String(raw.id),
    parentId,
    name: str(raw.name) ?? String(raw.id),
    status: str(raw.status),
    effectiveStatus: str(raw.effective_status),
    objective: str(raw.objective) ?? str(raw.optimization_goal),
    dailyBudget: minor(raw.daily_budget),
    lifetimeBudget: minor(raw.lifetime_budget),
    creative: level === 'ad' ? normalizeCreative(raw.creative) : null,
  };
}

export async function fetchMetaEntities(token: string, adAccountId: string, level: MetaLevel, opts?: GraphOptions): Promise<MetaEntity[]> {
  // `ad` carrega criativo expandido: página menor para não estourar o limite de dados por chamada.
  const limit = level === 'ad' ? '25' : '100';
  const rows = await graphPaged(`${adAccountId}/${EDGE[level]}`, { fields: ENTITY_FIELDS[level], limit }, token, 100, opts);
  return rows.map((r) => normalizeEntity(level, r));
}

// ── Insights diários ─────────────────────────────────────────────────────

/**
 * Qual ação conta como "resultado". UMA por linha, escolhida por prioridade,
 * e o tipo escolhido é gravado junto (`resultsKind`): leads e conversas no
 * WhatsApp não se somam, e o Meta e o Google não atribuem da mesma forma.
 */
const RESULT_PRIORITY = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_complete_registration',
] as const;

export function pickResult(actions: unknown): { value: number | null; kind: string | null } {
  if (!Array.isArray(actions)) return { value: null, kind: null };
  const map = new Map<string, number>();
  for (const a of actions as Array<{ action_type?: string; value?: string }>) {
    if (a.action_type) map.set(a.action_type, Number(a.value) || 0);
  }
  for (const kind of RESULT_PRIORITY) {
    if (map.has(kind)) return { value: map.get(kind)!, kind };
  }
  return { value: null, kind: null };
}

export function pickConversionValue(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  const hit = (values as Array<{ action_type?: string; value?: string }>).find((a) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
  return hit ? Number(hit.value) || 0 : null;
}

export interface MetaDailyInsight {
  level: MetaLevel;
  entityId: string;
  day: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  results: number | null;
  resultsKind: string | null;
  conversionValue: number | null;
  frequency: number | null;
}

const ID_FIELD: Record<MetaLevel, string> = { campaign: 'campaign_id', adset: 'adset_id', ad: 'ad_id' };
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizeInsight(level: MetaLevel, raw: Record<string, unknown>): MetaDailyInsight | null {
  const entityId = str(raw[ID_FIELD[level]]);
  const day = str(raw.date_start);
  if (!entityId || !day) return null;
  const result = pickResult(raw.actions);
  return {
    level,
    entityId,
    day,
    spend: numOrNull(raw.spend),
    impressions: numOrNull(raw.impressions),
    reach: numOrNull(raw.reach),
    clicks: numOrNull(raw.clicks),
    results: result.value,
    resultsKind: result.kind,
    conversionValue: pickConversionValue(raw.action_values),
    frequency: numOrNull(raw.frequency),
  };
}

export async function fetchMetaDailyInsights(
  token: string,
  adAccountId: string,
  level: MetaLevel,
  range: { since: string; until: string },
  opts?: GraphOptions,
): Promise<MetaDailyInsight[]> {
  const rows = await graphPaged(
    `${adAccountId}/insights`,
    {
      level,
      time_increment: '1',
      time_range: JSON.stringify(range),
      fields: `${ID_FIELD[level]},spend,impressions,reach,clicks,actions,action_values,frequency`,
      limit: '500',
    },
    token,
    100,
    opts,
  );
  return rows.map((r) => normalizeInsight(level, r)).filter((r): r is MetaDailyInsight => r !== null);
}
