import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { deriveMetrics, pctChange, previousRange, type DateRange, type DerivedMetrics, type RawTotals } from './media-metrics';
import { enumerateDays, getAgencyOverview, listUnlinkedAccounts, type MediaScope } from './media-queries';

/**
 * media-hub.ts — a tela inicial de Mídias: criativos de TODAS as contas, números da carteira com
 * tendência, o que pede atenção, insights e atividade.
 *
 * Regras que não se negociam aqui:
 *  - Tudo sai das tabelas sincronizadas e é recortado pela EMPRESA (e pelos clientes liberados).
 *  - Moedas nunca se misturam: os KPIs somam UMA moeda (a pedida, BRL por padrão) e o resultado
 *    diz quais outras existem. Somar real com dólar é inventar um número.
 *  - Insight é regra determinística sobre o dado, com o número que a sustenta. Nada de "IA" que
 *    escreve o que não mediu: quando não há base para a comparação, o insight simplesmente não sai.
 */

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const sums = () => sql`sum(i.spend) as spend, sum(i.impressions) as impressions, sum(i.reach) as reach, sum(i.clicks) as clicks, sum(i.results) as results, sum(i.conversion_value) as conversion_value`;
const totalsFrom = (r: Record<string, unknown>): RawTotals => ({ spend: n(r.spend), impressions: n(r.impressions), reach: n(r.reach), clicks: n(r.clicks), results: n(r.results), conversionValue: n(r.conversion_value) });

/** Contas vinculadas a clientes DA EMPRESA (e dos clientes liberados). Uma linha por conta. */
function linkedAccountsCte(scope: MediaScope) {
  const clientFilter = scope.clientIds ? sql`and c.id in (${sql.join(scope.clientIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  return sql`
    la as (
      select distinct on (provider, account_id) provider, account_id, client_id, client_name from (
        select 'meta'::text as provider, m.account_id as account_id, c.id as client_id, c.name as client_name, m.is_primary as p
          from client_meta_accounts m join clients c on c.id = m.client_id
          where c.organization_id = ${scope.organizationId} and c.deleted_at is null ${clientFilter}
        union all
        select 'google_ads'::text, g.customer_id, c.id, c.name, g.is_primary
          from client_google_ads_accounts g join clients c on c.id = g.client_id
          where c.organization_id = ${scope.organizationId} and c.deleted_at is null ${clientFilter}
      ) u order by provider, account_id, p desc
    )`;
}

// ── Criativos de todas as contas ─────────────────────────────────────────

export type CreativeSort = 'spend' | 'results' | 'ctr' | 'costPerResult' | 'active';

export interface HubCreativeQuery {
  range: DateRange;
  provider?: 'meta' | 'google_ads';
  accountId?: string;
  clientId?: string;
  search?: string;
  /** effective_status normalizado: ACTIVE | PAUSED | DISAPPROVED | WITH_ISSUES */
  status?: string;
  objective?: string;
  /** Só anúncios que investiram no período (a galeria abre assim: 4.000 pausados antigos não são "criativos no ar"). */
  withSpend?: boolean;
  sort?: CreativeSort;
  limit?: number;
  offset?: number;
}

export interface HubCreative extends DerivedMetrics {
  id: string;
  provider: 'meta' | 'google_ads';
  accountId: string;
  accountName: string | null;
  currency: string | null;
  clientId: string;
  clientName: string;
  name: string;
  status: string | null;
  campaignName: string | null;
  adsetName: string | null;
  objective: string | null;
  creative: { title: string | null; body: string | null; callToAction: string | null; linkUrl: string | null; thumbnailUrl: string | null; imageUrl: string | null; videoId: string | null } | null;
  lastDay: string | null;
  spark: number[];
}

/** Função, não constante: `sql` na carga do módulo quebra quem simula o drizzle-orm nos testes (já aconteceu 2x). */
const orderBy = (sort: CreativeSort) => ({
  spend: sql`m.spend desc nulls last, e.name`,
  results: sql`m.results desc nulls last, m.spend desc nulls last`,
  ctr: sql`(case when coalesce(m.impressions,0) >= 500 then m.clicks::float / nullif(m.impressions,0) end) desc nulls last`,
  costPerResult: sql`(case when coalesce(m.results,0) > 0 then m.spend / m.results end) asc nulls last`,
  active: sql`m.last_day desc nulls last, m.spend desc nulls last`,
})[sort];

export async function listAllCreatives(scope: MediaScope, q: HubCreativeQuery): Promise<{ total: number; rows: HubCreative[] }> {
  if (scope.clientIds && scope.clientIds.length === 0) return { total: 0, rows: [] };
  const org = scope.organizationId;
  const filters = [sql`e.organization_id = ${org}`, sql`e.level = 'ad'`];
  if (q.provider) filters.push(sql`e.provider = ${q.provider}`);
  if (q.accountId) filters.push(sql`e.account_external_id = ${q.accountId}`);
  if (q.clientId) filters.push(sql`la.client_id = ${q.clientId}::uuid`);
  if (q.search) filters.push(sql`(e.name ilike ${`%${q.search.replace(/[%_]/g, '')}%`} or camp.name ilike ${`%${q.search.replace(/[%_]/g, '')}%`} or la.client_name ilike ${`%${q.search.replace(/[%_]/g, '')}%`})`);
  if (q.status) filters.push(sql`coalesce(e.effective_status, e.status) = ${q.status}`);
  if (q.objective) filters.push(sql`camp.objective = ${q.objective}`);
  if (q.withSpend) filters.push(sql`m.spend > 0`);
  const limit = Math.min(Math.max(q.limit ?? 24, 1), 100);
  const offset = Math.max(q.offset ?? 0, 0);

  const rows = (await db.execute(sql`
    with ${linkedAccountsCte(scope)},
    m as (
      select i.provider, i.entity_external_id, ${sums()}, max(i.day)::text as last_day,
        array_agg(coalesce(i.spend,0) order by i.day) as spark_vals, array_agg(i.day::text order by i.day) as spark_days
      from media_insights_daily i
      where i.organization_id = ${org} and i.level = 'ad' and i.day >= ${q.range.since} and i.day <= ${q.range.until}
      group by i.provider, i.entity_external_id
    )
    select e.external_id as id, e.provider, e.account_external_id as account_id, la.client_id, la.client_name,
      a.name as account_name, a.currency, e.name, coalesce(e.effective_status, e.status) as status, e.creative,
      adset.name as adset_name, camp.name as campaign_name, camp.objective,
      m.spend, m.impressions, m.reach, m.clicks, m.results, m.conversion_value, m.last_day, m.spark_vals, m.spark_days,
      count(*) over() as total
    from media_entities e
    join la on la.provider = e.provider and la.account_id = e.account_external_id
    left join media_ad_accounts a on a.organization_id = ${org} and a.provider = e.provider and a.external_id = e.account_external_id
    left join media_entities adset on adset.provider = e.provider and adset.level = 'adset' and adset.external_id = e.parent_external_id
    left join media_entities camp on camp.provider = e.provider and camp.level = 'campaign' and camp.external_id = adset.parent_external_id
    left join m on m.provider = e.provider and m.entity_external_id = e.external_id
    where ${sql.join(filters, sql` and `)}
    order by ${orderBy(q.sort ?? 'spend')}
    limit ${limit} offset ${offset}`)) as unknown as Array<Record<string, unknown>>;

  const days = enumerateDays(q.range);
  return {
    total: rows.length ? Number(rows[0]!.total) : 0,
    rows: rows.map((r) => {
      const byDay = new Map<string, number>();
      const vals = (r.spark_vals as Array<string | number> | null) ?? [];
      const ds = (r.spark_days as string[] | null) ?? [];
      ds.forEach((d, i) => byDay.set(d, Number(vals[i] ?? 0)));
      return {
        id: String(r.id),
        provider: r.provider as 'meta' | 'google_ads',
        accountId: String(r.account_id),
        accountName: (r.account_name as string | null) ?? null,
        currency: (r.currency as string | null) ?? null,
        clientId: String(r.client_id),
        clientName: String(r.client_name),
        name: String(r.name),
        status: (r.status as string | null) ?? null,
        campaignName: (r.campaign_name as string | null) ?? null,
        adsetName: (r.adset_name as string | null) ?? null,
        objective: (r.objective as string | null) ?? null,
        creative: (r.creative as HubCreative['creative']) ?? null,
        lastDay: (r.last_day as string | null) ?? null,
        spark: days.map((d) => byDay.get(d) ?? 0),
        ...deriveMetrics(totalsFrom(r)),
      };
    }),
  };
}

// ── Painel da carteira ───────────────────────────────────────────────────

export interface HubKpis {
  currency: string;
  /** Outras moedas presentes na carteira, que NÃO entram nos números abaixo. */
  otherCurrencies: string[];
  current: DerivedMetrics;
  previous: DerivedMetrics | null;
  changes: Record<string, number | null> | null;
  daily: Array<{ day: string; spend: number | null; impressions: number | null; clicks: number | null; results: number | null; ctr: number | null; costPerResult: number | null }>;
}

export interface HubFacets {
  providers: Array<{ provider: 'meta' | 'google_ads'; accounts: number; ads: number }>;
  accounts: Array<{ provider: 'meta' | 'google_ads'; accountId: string; name: string | null; clientName: string; ads: number }>;
  objectives: Array<{ objective: string; ads: number }>;
  statuses: Array<{ status: string; ads: number }>;
  unlinkedAccounts: number;
}

async function kpis(scope: MediaScope, range: DateRange, currency: string, compare: boolean): Promise<HubKpis> {
  const org = scope.organizationId;
  const run = async (r: DateRange, byDay: boolean) =>
    (await db.execute(sql`
      with ${linkedAccountsCte(scope)}
      select ${byDay ? sql`i.day::text as day,` : sql``} ${sums()}
      from media_insights_daily i
      join la on la.provider = i.provider and la.account_id = i.account_external_id
      join media_ad_accounts a on a.organization_id = ${org} and a.provider = i.provider and a.external_id = i.account_external_id
      where i.organization_id = ${org} and i.level = 'campaign' and a.currency = ${currency}
        and i.day >= ${r.since} and i.day <= ${r.until}
      ${byDay ? sql`group by i.day order by i.day` : sql``}`)) as unknown as Array<Record<string, unknown>>;

  const prevR = previousRange(range);
  const [cur, daily, prev, currencies] = await Promise.all([
    run(range, false),
    run(range, true),
    compare ? run(prevR, false) : Promise.resolve(null),
    db.execute(sql`
      with ${linkedAccountsCte(scope)}
      select distinct a.currency from media_ad_accounts a join la on la.provider = a.provider and la.account_id = a.external_id
      where a.organization_id = ${org} and a.currency is not null`),
  ]);
  const current = deriveMetrics(totalsFrom(cur[0] ?? {}));
  const previous = prev ? deriveMetrics(totalsFrom(prev[0] ?? {})) : null;
  const changes = previous
    ? Object.fromEntries((['spend', 'impressions', 'clicks', 'ctr', 'results', 'costPerResult'] as const).map((k) => [k, pctChange(current[k], previous[k])]))
    : null;
  const byDay = new Map(daily.map((d) => [String(d.day), deriveMetrics(totalsFrom(d))]));
  return {
    currency,
    otherCurrencies: (currencies as unknown as Array<{ currency: string }>).map((c) => c.currency).filter((c) => c !== currency),
    current,
    previous,
    changes,
    daily: enumerateDays(range).map((day) => {
      const m = byDay.get(day);
      return { day, spend: m?.spend ?? null, impressions: m?.impressions ?? null, clicks: m?.clicks ?? null, results: m?.results ?? null, ctr: m?.ctr ?? null, costPerResult: m?.costPerResult ?? null };
    }),
  };
}

async function facets(scope: MediaScope): Promise<HubFacets> {
  const org = scope.organizationId;
  const rows = (await db.execute(sql`
    with ${linkedAccountsCte(scope)}
    select e.provider, e.account_external_id as account_id, a.name as account_name, la.client_name,
      camp.objective, coalesce(e.effective_status, e.status) as status
    from media_entities e
    join la on la.provider = e.provider and la.account_id = e.account_external_id
    left join media_ad_accounts a on a.organization_id = ${org} and a.provider = e.provider and a.external_id = e.account_external_id
    left join media_entities adset on adset.provider = e.provider and adset.level = 'adset' and adset.external_id = e.parent_external_id
    left join media_entities camp on camp.provider = e.provider and camp.level = 'campaign' and camp.external_id = adset.parent_external_id
    where e.organization_id = ${org} and e.level = 'ad'`)) as unknown as Array<Record<string, string | null>>;
  const prov = new Map<string, { accounts: Set<string>; ads: number }>();
  const accs = new Map<string, HubFacets['accounts'][number]>();
  const objs = new Map<string, number>();
  const sts = new Map<string, number>();
  for (const r of rows) {
    const p = prov.get(r.provider!) ?? { accounts: new Set<string>(), ads: 0 };
    p.accounts.add(r.account_id!);
    p.ads += 1;
    prov.set(r.provider!, p);
    const k = `${r.provider}:${r.account_id}`;
    const a = accs.get(k) ?? { provider: r.provider as 'meta' | 'google_ads', accountId: r.account_id!, name: r.account_name ?? null, clientName: r.client_name!, ads: 0 };
    a.ads += 1;
    accs.set(k, a);
    if (r.objective) objs.set(r.objective, (objs.get(r.objective) ?? 0) + 1);
    if (r.status) sts.set(r.status, (sts.get(r.status) ?? 0) + 1);
  }
  return {
    providers: [...prov.entries()].map(([provider, v]) => ({ provider: provider as 'meta' | 'google_ads', accounts: v.accounts.size, ads: v.ads })),
    accounts: [...accs.values()].sort((a, b) => b.ads - a.ads),
    objectives: [...objs.entries()].map(([objective, ads]) => ({ objective, ads })).sort((a, b) => b.ads - a.ads),
    statuses: [...sts.entries()].map(([status, ads]) => ({ status, ads })).sort((a, b) => b.ads - a.ads),
    unlinkedAccounts: (await listUnlinkedAccounts(org)).length,
  };
}

// ── Atenção, insights, atividade ─────────────────────────────────────────

export interface HubAttention {
  id: string;
  tone: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  clientId?: string;
}

export interface HubInsight {
  id: string;
  tone: 'good' | 'warn' | 'info';
  title: string;
  detail: string;
}

export interface HubActivity {
  id: string;
  at: string;
  who: string | null;
  action: string;
  detail: string | null;
  clientName: string | null;
}

/** Pura: transforma os números do período em insights, sempre com a base que os sustenta. */
export function buildInsights(input: {
  kpis: Pick<HubKpis, 'current' | 'previous' | 'changes' | 'currency'>;
  ads: Array<{ name: string; impressions: number | null; clicks: number | null; results: number | null; spend: number | null; costPerResult: number | null }>;
  capUsage: Array<{ accountName: string; percent: number }>;
}): HubInsight[] {
  const out: HubInsight[] = [];
  const { kpis: k, ads } = input;
  const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: k.currency }).format(v);

  // CTR acima da média, só entre anúncios com amostra mínima (menos de 1.000 impressões é ruído).
  const sampled = ads.filter((a) => (a.impressions ?? 0) >= 1000 && a.clicks !== null);
  const impr = sampled.reduce((s, a) => s + (a.impressions ?? 0), 0);
  const clk = sampled.reduce((s, a) => s + (a.clicks ?? 0), 0);
  if (sampled.length >= 4 && impr > 0) {
    const avg = (clk / impr) * 100;
    const better = sampled.filter((a) => ((a.clicks ?? 0) / (a.impressions as number)) * 100 >= avg * 1.25);
    if (better.length > 0) out.push({ id: 'ctr-acima', tone: 'good', title: `${better.length} criativo${better.length > 1 ? 's' : ''} com CTR bem acima da média`, detail: `Média de ${avg.toFixed(2)}% entre ${sampled.length} anúncios com 1.000+ impressões. Bom momento para repetir o formato.` });
  }

  const ch = k.changes?.costPerResult;
  if (ch !== null && ch !== undefined && k.current.costPerResult !== null && k.previous?.costPerResult != null) {
    const down = ch < 0;
    out.push({ id: 'cpr', tone: down ? 'good' : Math.abs(ch) >= 15 ? 'warn' : 'info', title: `Custo por resultado ${down ? 'caiu' : 'subiu'} ${Math.abs(ch).toFixed(1).replace('.', ',')}%`, detail: `${money(k.previous.costPerResult)} → ${money(k.current.costPerResult)} em relação ao período anterior.` });
  }

  const sp = k.changes?.spend;
  if (sp !== null && sp !== undefined && Math.abs(sp) >= 25 && k.previous?.spend != null) {
    out.push({ id: 'invest', tone: 'info', title: `Investimento ${sp > 0 ? 'subiu' : 'caiu'} ${Math.abs(sp).toFixed(1).replace('.', ',')}%`, detail: `${money(k.previous.spend)} → ${money(k.current.spend ?? 0)} contra o período anterior.` });
  }

  const best = ads.filter((a) => a.costPerResult !== null && (a.spend ?? 0) > 0 && (a.results ?? 0) >= 2).sort((a, b) => (a.costPerResult as number) - (b.costPerResult as number))[0];
  if (best) out.push({ id: 'melhor', tone: 'good', title: 'Criativo mais eficiente do período', detail: `“${best.name}”: ${money(best.costPerResult as number)} por resultado, com ${best.results} resultados.` });

  for (const c of input.capUsage.filter((x) => x.percent >= 80).slice(0, 2)) {
    out.push({ id: `limite-${c.accountName}`, tone: 'warn', title: `${c.accountName} usou ${Math.round(c.percent)}% do limite de gastos`, detail: 'O Meta para de veicular quando o limite de gastos da conta é atingido.' });
  }
  return out;
}

const ACTION_LABEL: Record<string, string> = {
  'media.account.linked': 'vinculou uma conta de anúncio',
  'media.account.unlinked': 'desvinculou uma conta de anúncio',
  'media.account.synced': 'sincronizou uma conta',
  'media.alert_rule.created': 'criou uma regra de alerta',
  'media.alert_rule.updated': 'alterou uma regra de alerta',
  'media.alert_rule.deleted': 'removeu uma regra de alerta',
  'media.alert.status_changed': 'atualizou um alerta',
  'media.setting.changed': 'alterou uma configuração de mídia',
  'media.template.created': 'criou uma mensagem',
  'media.template.updated': 'editou uma mensagem',
  'media.report_schedule.created': 'agendou um relatório',
  'media.action.requested': 'pediu uma ação em campanha',
  'integration.meta.central_connected': 'conectou a Business Manager da agência',
  'integration.meta.sync': 'importou as contas do Meta',
  'client.report_requested': 'pediu um relatório',
};

async function activity(scope: MediaScope): Promise<HubActivity[]> {
  const org = scope.organizationId;
  const rows = (await db.execute(sql`
    select l.id::text as id, l.timestamp as at, u.name as who, l.action, c.name as client_name, l.metadata
    from audit_logs l
    left join users u on u.id = l.user_id
    left join clients c on c.id = l.client_id
    where (l.action like 'media.%' or l.action in ('integration.meta.central_connected','integration.meta.sync','client.report_requested'))
      and (c.organization_id = ${org} or l.metadata->>'organizationId' = ${org})
    order by l.timestamp desc limit 12`)) as unknown as Array<Record<string, unknown>>;
  const alerts = (await db.execute(sql`
    select e.id::text as id, e.fired_at as at, e.title, c.name as client_name
    from media_alert_events e join clients c on c.id = e.client_id
    where e.organization_id = ${org} order by e.fired_at desc limit 6`)) as unknown as Array<Record<string, unknown>>;
  const items: HubActivity[] = [
    ...rows.map((r) => ({ id: String(r.id), at: new Date(r.at as string | Date).toISOString(), who: (r.who as string | null) ?? null, action: ACTION_LABEL[String(r.action)] ?? String(r.action), detail: ((r.metadata as Record<string, unknown> | null)?.accountName as string | undefined) ?? null, clientName: (r.client_name as string | null) ?? null })),
    ...alerts.map((r) => ({ id: `a${String(r.id)}`, at: new Date(r.at as string | Date).toISOString(), who: null, action: 'alerta disparado', detail: String(r.title), clientName: (r.client_name as string | null) ?? null })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
}

export interface Hub {
  range: DateRange;
  previousRange: DateRange | null;
  kpis: HubKpis;
  facets: HubFacets;
  attention: HubAttention[];
  insights: HubInsight[];
  activity: HubActivity[];
  lastSyncedAt: string | null;
}

export async function getHub(scope: MediaScope, range: DateRange, opts: { compare?: boolean; currency?: string } = {}): Promise<Hub> {
  const compare = opts.compare ?? true;
  const currency = opts.currency ?? 'BRL';
  const [k, f, overview, openAlerts, act, adsForInsights, cap, sync] = await Promise.all([
    kpis(scope, range, currency, compare),
    facets(scope),
    getAgencyOverview(scope, range),
    db
      .select({ id: schema.mediaAlertEvents.id, severity: schema.mediaAlertEvents.severity, title: schema.mediaAlertEvents.title, clientId: schema.mediaAlertEvents.clientId, clientName: schema.clients.name })
      .from(schema.mediaAlertEvents)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.mediaAlertEvents.clientId))
      .where(and(eq(schema.mediaAlertEvents.organizationId, scope.organizationId), eq(schema.mediaAlertEvents.status, 'open')))
      .orderBy(desc(schema.mediaAlertEvents.firedAt))
      .limit(6),
    activity(scope),
    listAllCreatives(scope, { range, sort: 'spend', limit: 100 }),
    db.execute(sql`
      with ${linkedAccountsCte(scope)}
      select a.name, a.spend_cap, a.amount_spent from media_ad_accounts a join la on la.provider = a.provider and la.account_id = a.external_id
      where a.organization_id = ${scope.organizationId} and a.spend_cap is not null and a.spend_cap > 0 and a.amount_spent is not null`),
    db.execute(sql`select max(last_synced_at) as t from media_ad_accounts where organization_id = ${scope.organizationId}`),
  ]);

  const attention: HubAttention[] = [];
  const labels: Record<string, string> = { falha_de_sincronizacao: 'falha na última sincronização', queda_de_resultados: 'queda de resultados (30% ou mais) contra o período anterior' };
  for (const a of overview.accounts) {
    for (const flag of a.needsAttention) {
      const detail = flag.startsWith('conta_') ? `conta com status ${flag.slice(6).toUpperCase()}` : (labels[flag] ?? flag);
      attention.push({ id: `${a.accountId}-${flag}`, tone: flag === 'falha_de_sincronizacao' || flag.startsWith('conta_') ? 'critical' : 'warning', title: `${a.clientName} (${a.provider === 'meta' ? 'Meta Ads' : 'Google Ads'})`, detail: a.lastSyncError && flag === 'falha_de_sincronizacao' ? a.lastSyncError.slice(0, 140) : detail, clientId: a.clientId });
    }
  }
  for (const al of openAlerts) attention.push({ id: `al-${al.id}`, tone: al.severity === 'critical' ? 'critical' : 'warning', title: al.clientName, detail: al.title, clientId: al.clientId });
  if (f.unlinkedAccounts > 0) attention.push({ id: 'sem-cliente', tone: 'info', title: `${f.unlinkedAccounts} conta(s) da agência sem cliente`, detail: 'Associe cada uma ao cliente certo; o sistema não vincula por nome parecido.' });
  const order = { critical: 0, warning: 1, info: 2 } as const;
  attention.sort((a, b) => order[a.tone] - order[b.tone]);

  const capUsage = (cap as unknown as Array<{ name: string | null; spend_cap: string; amount_spent: string }>).map((c) => ({ accountName: c.name ?? 'Conta', percent: (Number(c.amount_spent) / Number(c.spend_cap)) * 100 }));
  const insights = buildInsights({ kpis: k, ads: adsForInsights.rows, capUsage });

  const syncedAt = (sync as unknown as Array<{ t: Date | string | null }>)[0]?.t ?? null;
  return {
    range,
    previousRange: compare ? previousRange(range) : null,
    kpis: k,
    facets: f,
    attention: attention.slice(0, 8),
    insights,
    activity: act,
    lastSyncedAt: syncedAt ? new Date(syncedAt).toISOString() : null,
  };
}

