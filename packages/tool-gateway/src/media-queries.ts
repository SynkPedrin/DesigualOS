import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { deriveMetrics, includesToday, pctChange, previousRange, type DateRange, type DerivedMetrics, type RawTotals } from './media-metrics';

/**
 * media-queries.ts — leitura do Media Command Center a partir do banco.
 *
 * É a ÚNICA camada de leitura de mídia: as rotas da API e as ferramentas dos
 * agentes chamam estas funções, nunca montam SQL por conta própria. Por isso
 * recebem `clientIds` (os clientes que a pessoa pode ver) e filtram por ele
 * ANTES de devolver qualquer coisa: um agente respondendo em nome de alguém
 * enxerga exatamente o que essa pessoa enxergaria na tela.
 */

export interface MediaScope {
  organizationId: string;
  /** null = todos os clientes da organização (papel administrativo). Lista vazia = nenhum. */
  clientIds: string[] | null;
}

export type MediaProviderName = 'meta' | 'google_ads';

/** Meta usa `act_123`; Google usa só dígitos do Customer ID. O prefixo basta para saber de quem é a conta. */
export const providerOfAccount = (accountId: string): MediaProviderName => (accountId.startsWith('act_') ? 'meta' : 'google_ads');

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ── Contas ───────────────────────────────────────────────────────────────

export interface LinkedMediaAccount {
  clientId: string;
  clientName: string;
  provider: MediaProviderName;
  accountId: string;
  label: string | null;
  isPrimary: boolean;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  balanceKind: string;
  balanceAmount: number | null;
  spendCap: number | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export async function listLinkedAccounts(scope: MediaScope, filter: { clientId?: string } = {}): Promise<LinkedMediaAccount[]> {
  if (scope.clientIds && scope.clientIds.length === 0) return [];
  const conditions = [eq(schema.clients.organizationId, scope.organizationId)];
  if (scope.clientIds) conditions.push(inArray(schema.clients.id, scope.clientIds));
  if (filter.clientId) conditions.push(eq(schema.clients.id, filter.clientId));

  const catalog = (provider: MediaProviderName, externalId: typeof schema.clientMetaAccounts.accountId | typeof schema.clientGoogleAdsAccounts.customerId) =>
    and(eq(schema.mediaAdAccounts.organizationId, scope.organizationId), eq(schema.mediaAdAccounts.provider, provider), eq(schema.mediaAdAccounts.externalId, externalId));

  const [meta, google] = await Promise.all([
    db
      .select({
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        accountId: schema.clientMetaAccounts.accountId,
        label: schema.clientMetaAccounts.label,
        isPrimary: schema.clientMetaAccounts.isPrimary,
        createdAt: schema.clientMetaAccounts.createdAt,
        name: schema.mediaAdAccounts.name,
        currency: schema.mediaAdAccounts.currency,
        timezone: schema.mediaAdAccounts.timezone,
        status: schema.mediaAdAccounts.status,
        balanceKind: schema.mediaAdAccounts.balanceKind,
        balanceAmount: schema.mediaAdAccounts.balanceAmount,
        spendCap: schema.mediaAdAccounts.spendCap,
        lastSyncedAt: schema.mediaAdAccounts.lastSyncedAt,
        lastSyncError: schema.mediaAdAccounts.lastSyncError,
      })
      .from(schema.clientMetaAccounts)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.clientMetaAccounts.clientId))
      .leftJoin(schema.mediaAdAccounts, catalog('meta', schema.clientMetaAccounts.accountId))
      .where(and(...conditions)),
    db
      .select({
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        accountId: schema.clientGoogleAdsAccounts.customerId,
        label: schema.clientGoogleAdsAccounts.label,
        isPrimary: schema.clientGoogleAdsAccounts.isPrimary,
        createdAt: schema.clientGoogleAdsAccounts.createdAt,
        name: schema.mediaAdAccounts.name,
        currency: schema.mediaAdAccounts.currency,
        timezone: schema.mediaAdAccounts.timezone,
        status: schema.mediaAdAccounts.status,
        balanceKind: schema.mediaAdAccounts.balanceKind,
        balanceAmount: schema.mediaAdAccounts.balanceAmount,
        spendCap: schema.mediaAdAccounts.spendCap,
        lastSyncedAt: schema.mediaAdAccounts.lastSyncedAt,
        lastSyncError: schema.mediaAdAccounts.lastSyncError,
      })
      .from(schema.clientGoogleAdsAccounts)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.clientGoogleAdsAccounts.clientId))
      .leftJoin(schema.mediaAdAccounts, catalog('google_ads', schema.clientGoogleAdsAccounts.customerId))
      .where(and(...conditions)),
  ]);

  const toRow = (provider: MediaProviderName) => (r: (typeof meta)[number]): LinkedMediaAccount & { createdAt: Date } => ({
    clientId: r.clientId,
    clientName: r.clientName,
    provider,
    accountId: r.accountId,
    label: r.label,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt,
    name: r.name,
    currency: r.currency,
    timezone: r.timezone,
    status: r.status,
    balanceKind: r.balanceKind ?? 'UNAVAILABLE',
    balanceAmount: n(r.balanceAmount),
    spendCap: n(r.spendCap),
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: r.lastSyncError,
  });
  return [...meta.map(toRow('meta')), ...google.map(toRow('google_ads'))]
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR') || Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ createdAt: _createdAt, ...row }) => row);
}

export interface UnlinkedMediaAccount {
  provider: MediaProviderName;
  accountId: string;
  name: string | null;
  currency: string | null;
  status: string | null;
  businessId: string | null;
}

/** Contas descobertas que nenhum cliente reivindicou. A associação é manual: nome parecido não é prova. */
export async function listUnlinkedAccounts(organizationId: string): Promise<UnlinkedMediaAccount[]> {
  const rows = await db
    .select({ provider: schema.mediaAdAccounts.provider, accountId: schema.mediaAdAccounts.externalId, name: schema.mediaAdAccounts.name, currency: schema.mediaAdAccounts.currency, status: schema.mediaAdAccounts.status, businessId: schema.mediaAdAccounts.businessId })
    .from(schema.mediaAdAccounts)
    .where(
      and(
        eq(schema.mediaAdAccounts.organizationId, organizationId),
        sql`(
          (${schema.mediaAdAccounts.provider} = 'meta' and not exists (select 1 from client_meta_accounts cma where cma.account_id = ${schema.mediaAdAccounts.externalId}))
          or
          (${schema.mediaAdAccounts.provider} = 'google_ads' and not exists (select 1 from client_google_ads_accounts cga where cga.customer_id = ${schema.mediaAdAccounts.externalId}))
        )`,
      ),
    )
    .orderBy(asc(schema.mediaAdAccounts.provider), asc(schema.mediaAdAccounts.name));
  return rows.map((r) => ({ ...r, provider: r.provider as MediaProviderName }));
}

/** Garante que a conta pertence a um cliente que esta pessoa pode ver. Base de toda leitura por conta. */
export async function assertAccountInScope(scope: MediaScope, accountId: string): Promise<LinkedMediaAccount | null> {
  const all = await listLinkedAccounts(scope);
  return all.find((a) => a.accountId === accountId) ?? null;
}

// ── Agregação ────────────────────────────────────────────────────────────

type Level = 'campaign' | 'adset' | 'ad';

/** Função, não constante: avaliar `sql` na carga do módulo quebra quem simula o drizzle-orm nos testes. */
const sums = () => sql`
  sum(spend) as spend, sum(impressions) as impressions, sum(reach) as reach, sum(clicks) as clicks,
  sum(results) as results, sum(conversion_value) as conversion_value`;

function totalsFrom(r: Record<string, unknown>): RawTotals {
  return { spend: n(r.spend), impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks), results: n(r.results), conversionValue: n(r.conversion_value) };
}

/** Soma de um nível inteiro da conta no período. "Conta" = soma das campanhas: elas cobrem todo o gasto. */
export async function accountTotals(organizationId: string, accountId: string, range: DateRange, level: Level = 'campaign', provider: MediaProviderName = providerOfAccount(accountId)) {
  const rows = (await db.execute(sql`
    select ${sums()}, max(synced_at) as synced_at, array_agg(distinct results_kind) filter (where results_kind is not null) as kinds
    from media_insights_daily
    where organization_id = ${organizationId} and provider = ${provider} and account_external_id = ${accountId}
      and level = ${level} and day >= ${range.since} and day <= ${range.until}`)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0] ?? {};
  return { totals: totalsFrom(r), syncedAt: (r.synced_at as Date | null) ?? null, resultKinds: ((r.kinds as string[] | null) ?? []) };
}

export interface DailyPoint {
  day: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  results: number | null;
  costPerResult: number | null;
}

export async function accountDaily(organizationId: string, accountId: string, range: DateRange, provider: MediaProviderName = providerOfAccount(accountId)): Promise<DailyPoint[]> {
  const rows = (await db.execute(sql`
    select day::text as day, ${sums()}
    from media_insights_daily
    where organization_id = ${organizationId} and provider = ${provider} and account_external_id = ${accountId}
      and level = 'campaign' and day >= ${range.since} and day <= ${range.until}
    group by day order by day`)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const t = totalsFrom(r);
    return { day: String(r.day), spend: t.spend, impressions: t.impressions, clicks: t.clicks, results: t.results, costPerResult: deriveMetrics(t).costPerResult };
  });
}

export interface AccountSummary {
  accountId: string;
  currency: string | null;
  range: DateRange;
  previousRange: DateRange | null;
  current: DerivedMetrics;
  previous: DerivedMetrics | null;
  /** Variação % de cada métrica numérica vs o período anterior; null onde não há base. */
  changes: Record<string, number | null> | null;
  /** O que "resultado" significa nesta conta/período (lead, conversa no WhatsApp, compra...). Vazio = sem resultados rastreados. */
  resultKinds: string[];
  daily: DailyPoint[];
  campaigns: { total: number; active: number; paused: number; withIssues: number };
  lastSyncedAt: string | null;
  /** O período inclui hoje: o último dia está incompleto. */
  partialToday: boolean;
}

export async function getAccountSummary(scope: MediaScope, accountId: string, range: DateRange, compare = true): Promise<AccountSummary | null> {
  const account = await assertAccountInScope(scope, accountId);
  if (!account) return null;
  const org = scope.organizationId;
  const prevRange = compare ? previousRange(range) : null;

  const [cur, prev, daily, statusRows] = await Promise.all([
    accountTotals(org, accountId, range, 'campaign', account.provider),
    prevRange ? accountTotals(org, accountId, prevRange, 'campaign', account.provider) : Promise.resolve(null),
    accountDaily(org, accountId, range, account.provider),
    db.execute(sql`
      select coalesce(effective_status, status, 'UNKNOWN') as st, count(*)::int as c
      from media_entities
      where organization_id = ${org} and provider = ${account.provider} and account_external_id = ${accountId} and level = 'campaign'
      group by 1`),
  ]);

  const current = deriveMetrics(cur.totals);
  const previous = prev ? deriveMetrics(prev.totals) : null;
  const changes = previous
    ? Object.fromEntries((['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'results', 'costPerResult', 'roas'] as const).map((k) => [k, pctChange(current[k], previous[k])]))
    : null;

  const counts = { total: 0, active: 0, paused: 0, withIssues: 0 };
  for (const r of statusRows as unknown as Array<{ st: string; c: number }>) {
    counts.total += r.c;
    if (r.st === 'ACTIVE') counts.active += r.c;
    else if (r.st === 'PAUSED' || r.st === 'CAMPAIGN_PAUSED' || r.st === 'ADSET_PAUSED') counts.paused += r.c;
    else if (r.st === 'WITH_ISSUES' || r.st === 'DISAPPROVED' || r.st === 'PENDING_REVIEW') counts.withIssues += r.c;
  }

  return {
    accountId,
    currency: account.currency,
    range,
    previousRange: prevRange,
    current,
    previous,
    changes,
    resultKinds: cur.resultKinds,
    daily,
    campaigns: counts,
    lastSyncedAt: account.lastSyncedAt,
    partialToday: includesToday(range),
  };
}

/** Todos os dias do intervalo, inclusive os sem dado (YYYY-MM-DD). Limite de 400 por segurança. */
export function enumerateDays(range: DateRange): string[] {
  const out: string[] = [];
  const end = new Date(`${range.until}T00:00:00Z`).getTime();
  for (let t = new Date(`${range.since}T00:00:00Z`).getTime(); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ── Tabela hierárquica ───────────────────────────────────────────────────

export interface EntityRow extends DerivedMetrics {
  id: string;
  level: Level;
  parentId: string | null;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  updatedAt: string;
  /** Gasto por dia no período (um valor por dia, zero onde não houve veiculação), para o minigráfico de tendência. */
  spark: number[];
}

export interface EntityQuery {
  level: Level;
  range: DateRange;
  parentId?: string;
  search?: string;
  status?: string;
  sortBy?: 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'results' | 'costPerResult' | 'name';
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export async function listEntities(scope: MediaScope, accountId: string, q: EntityQuery): Promise<EntityRow[] | null> {
  const account = await assertAccountInScope(scope, accountId);
  if (!account) return null;
  return listEntitiesInScope(scope.organizationId, accountId, q, account.provider);
}

/** Miolo sem checagem de escopo: só chamar depois de `assertAccountInScope`. */
async function listEntitiesInScope(org: string, accountId: string, q: EntityQuery, provider: MediaProviderName): Promise<EntityRow[]> {
  const conds = [
    eq(schema.mediaEntities.organizationId, org),
    eq(schema.mediaEntities.provider, provider),
    eq(schema.mediaEntities.accountExternalId, accountId),
    eq(schema.mediaEntities.level, q.level),
  ];
  if (q.parentId) conds.push(eq(schema.mediaEntities.parentExternalId, q.parentId));
  if (q.search) conds.push(ilike(schema.mediaEntities.name, `%${q.search.replace(/[%_]/g, '')}%`));
  if (q.status) conds.push(eq(schema.mediaEntities.effectiveStatus, q.status));

  const entities = await db.select().from(schema.mediaEntities).where(and(...conds));
  if (entities.length === 0) return [];

  const metricRows = (await db.execute(sql`
    select entity_external_id as id, ${sums()}
    from media_insights_daily
    where organization_id = ${org} and provider = ${provider} and account_external_id = ${accountId}
      and level = ${q.level} and day >= ${q.range.since} and day <= ${q.range.until}
    group by entity_external_id`)) as unknown as Array<Record<string, unknown>>;
  const byId = new Map(metricRows.map((r) => [String(r.id), totalsFrom(r)]));

  // Série diária de gasto por entidade (uma consulta só), alinhada aos dias do período.
  const sparkRows = (await db.execute(sql`
    select entity_external_id as id, day::text as day, coalesce(spend, 0) as spend
    from media_insights_daily
    where organization_id = ${org} and provider = ${provider} and account_external_id = ${accountId}
      and level = ${q.level} and day >= ${q.range.since} and day <= ${q.range.until}`)) as unknown as Array<{ id: string; day: string; spend: string | number }>;
  const days = enumerateDays(q.range);
  const sparkById = new Map<string, Map<string, number>>();
  for (const r of sparkRows) {
    const m = sparkById.get(String(r.id)) ?? new Map<string, number>();
    m.set(String(r.day), Number(r.spend));
    sparkById.set(String(r.id), m);
  }
  const empty: RawTotals = { spend: null, impressions: null, reach: null, clicks: null, results: null, conversionValue: null };

  const rows: EntityRow[] = entities.map((e) => ({
    id: e.externalId,
    level: q.level,
    parentId: e.parentExternalId,
    name: e.name,
    status: e.status,
    effectiveStatus: e.effectiveStatus,
    objective: e.objective,
    dailyBudget: n(e.dailyBudget),
    lifetimeBudget: n(e.lifetimeBudget),
    updatedAt: e.updatedAt.toISOString(),
    spark: days.map((d) => sparkById.get(e.externalId)?.get(d) ?? 0),
    ...deriveMetrics(byId.get(e.externalId) ?? empty),
  }));

  const key = q.sortBy ?? 'spend';
  const dir = q.sortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name, 'pt-BR');
    const av = a[key];
    const bv = b[key];
    // Sem dado vai sempre para o fim, qualquer que seja a direção.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return dir * (av - bv);
  });
  return rows.slice(0, q.limit ?? 500);
}

// ── Criativos ────────────────────────────────────────────────────────────

export interface CreativeRow extends EntityRow {
  campaignId: string | null;
  adsetName: string | null;
  campaignName: string | null;
  creative: {
    title: string | null;
    body: string | null;
    callToAction: string | null;
    linkUrl: string | null;
    thumbnailUrl: string | null;
    imageUrl: string | null;
    videoId: string | null;
  } | null;
}

export async function listCreatives(scope: MediaScope, accountId: string, q: Omit<EntityQuery, 'level'>): Promise<CreativeRow[] | null> {
  const account = await assertAccountInScope(scope, accountId);
  if (!account) return null;
  const org = scope.organizationId;
  const [ads, parents, creativeRows] = await Promise.all([
    listEntitiesInScope(org, accountId, { ...q, level: 'ad' }, account.provider),
    db
      .select({ level: schema.mediaEntities.level, id: schema.mediaEntities.externalId, name: schema.mediaEntities.name, parent: schema.mediaEntities.parentExternalId })
      .from(schema.mediaEntities)
      .where(and(eq(schema.mediaEntities.organizationId, org), eq(schema.mediaEntities.accountExternalId, accountId), inArray(schema.mediaEntities.level, ['adset', 'campaign']))),
    db
      .select({ id: schema.mediaEntities.externalId, creative: schema.mediaEntities.creative })
      .from(schema.mediaEntities)
      .where(and(eq(schema.mediaEntities.organizationId, org), eq(schema.mediaEntities.accountExternalId, accountId), eq(schema.mediaEntities.level, 'ad'))),
  ]);
  const adsets = new Map(parents.filter((p) => p.level === 'adset').map((p) => [p.id, p]));
  const campaigns = new Map(parents.filter((p) => p.level === 'campaign').map((p) => [p.id, p]));
  const creativeById = new Map(creativeRows.map((c) => [c.id, c.creative as CreativeRow['creative']]));

  return ads.map((ad) => {
    const adset = ad.parentId ? adsets.get(ad.parentId) : undefined;
    const campaign = adset?.parent ? campaigns.get(adset.parent) : undefined;
    return { ...ad, adsetName: adset?.name ?? null, campaignId: adset?.parent ?? null, campaignName: campaign?.name ?? null, creative: creativeById.get(ad.id) ?? null };
  });
}

// ── Visão consolidada da agência ─────────────────────────────────────────

export interface AgencyAccountRow {
  provider: MediaProviderName;
  clientId: string;
  clientName: string;
  accountId: string;
  accountName: string | null;
  currency: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  spend: number | null;
  previousSpend: number | null;
  spendChange: number | null;
  results: number | null;
  previousResults: number | null;
  resultsChange: number | null;
  costPerResult: number | null;
  activeCampaigns: number;
  needsAttention: string[];
}

export async function getAgencyOverview(scope: MediaScope, range: DateRange): Promise<{ range: DateRange; accounts: AgencyAccountRow[]; totalsByCurrency: Record<string, { spend: number; results: number | null }> }> {
  const linked = await listLinkedAccounts(scope);
  const prev = previousRange(range);
  const accounts: AgencyAccountRow[] = await Promise.all(
    linked.map(async (acc): Promise<AgencyAccountRow> => {
      const [cur, pre, active] = await Promise.all([
        accountTotals(scope.organizationId, acc.accountId, range, 'campaign', acc.provider),
        accountTotals(scope.organizationId, acc.accountId, prev, 'campaign', acc.provider),
        db.execute(sql`select count(*)::int as c from media_entities where organization_id = ${scope.organizationId} and provider = ${acc.provider} and account_external_id = ${acc.accountId} and level = 'campaign' and effective_status = 'ACTIVE'`),
      ]);
      const d = deriveMetrics(cur.totals);
      const attention: string[] = [];
      if (acc.lastSyncError) attention.push('falha_de_sincronizacao');
      if (acc.status && acc.status !== 'ACTIVE') attention.push(`conta_${acc.status.toLowerCase()}`);
      const rc = pctChange(cur.totals.results, pre.totals.results);
      if (rc !== null && rc <= -30) attention.push('queda_de_resultados');
      return {
        provider: acc.provider,
        clientId: acc.clientId,
        clientName: acc.clientName,
        accountId: acc.accountId,
        accountName: acc.name,
        currency: acc.currency,
        status: acc.status,
        lastSyncedAt: acc.lastSyncedAt,
        lastSyncError: acc.lastSyncError,
        spend: cur.totals.spend,
        previousSpend: pre.totals.spend,
        spendChange: pctChange(cur.totals.spend, pre.totals.spend),
        results: cur.totals.results,
        previousResults: pre.totals.results,
        resultsChange: rc,
        costPerResult: d.costPerResult,
        activeCampaigns: (active as unknown as Array<{ c: number }>)[0]?.c ?? 0,
        needsAttention: attention,
      };
    }),
  );
  // Moedas nunca se somam entre si: um total por moeda.
  const totalsByCurrency: Record<string, { spend: number; results: number | null }> = {};
  for (const a of accounts) {
    const cur = a.currency ?? '??';
    const t = (totalsByCurrency[cur] ??= { spend: 0, results: null });
    t.spend += a.spend ?? 0;
    if (a.results !== null) t.results = (t.results ?? 0) + a.results;
  }
  return { range, accounts, totalsByCurrency };
}
