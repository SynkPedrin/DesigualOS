import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { resolveMetaSystemAccess, type MetaAccess } from './meta-access-resolver';
import {
  MetaGraphError,
  fetchMetaBusinessAccountDetails,
  fetchMetaDailyInsights,
  fetchMetaEntities,
  type MetaAccountDetails,
  type MetaLevel,
} from './meta-media-graph';

/**
 * media-sync.ts — persiste, no banco, o que a tela e os agentes leem.
 *
 * A tela de Mídia NÃO chama o Meta a cada renderização: lê estas tabelas, e
 * este job é quem fala com a plataforma. Ganhos: dashboard rápido, histórico,
 * comparação de períodos, e uma conta com problema não derruba as outras
 * (cada conta é sincronizada isolada e a falha vira linha em media_sync_runs).
 *
 * Só leitura da Marketing API. Nada aqui altera campanha ou anúncio.
 */

const LEVELS: MetaLevel[] = ['campaign', 'adset', 'ad'];
const CHUNK = 400;
const BACKFILL_DAYS = 90;
const INCREMENTAL_DAYS = 7;
/** Pausa entre contas: a Marketing API limita por app/conta; rajada de 19 contas já provocou erro transitório. */
const GAP_BETWEEN_ACCOUNTS_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WINDOW_DAYS = 14;

/** Divide os últimos `days` dias em janelas de até 14, da mais antiga para a mais nova. */
export function splitRange(days: number, today = new Date()): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  for (let end = 0; end < days; end += WINDOW_DAYS) {
    const start = Math.min(end + WINDOW_DAYS - 1, days - 1);
    out.unshift({ since: isoDay(new Date(today.getTime() - start * 86_400_000)), until: isoDay(new Date(today.getTime() - end * 86_400_000)) });
  }
  return out;
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Qual organização é "a agência". MEDIA_ORGANIZATION_ID manda; sem ele, a que
 * mais tem clientes. Decisão explícita e documentada, nunca a "primeira da
 * tabela": com três organizações, a primeira seria sorte.
 */
export async function resolveAgencyOrganizationId(): Promise<string | null> {
  const fromEnv = process.env.MEDIA_ORGANIZATION_ID?.trim();
  if (fromEnv) return fromEnv;
  const rows = await db.execute(
    sql`select organization_id from clients where organization_id is not null group by 1 order by count(*) desc limit 1`,
  );
  return (rows as unknown as Array<{ organization_id: string }>)[0]?.organization_id ?? null;
}

async function recordRun(
  organizationId: string,
  kind: 'accounts' | 'entities' | 'insights',
  accountExternalId: string | null,
  fn: () => Promise<number>,
): Promise<{ ok: boolean; rows: number; error?: string; rateLimited?: boolean }> {
  const [run] = await db
    .insert(schema.mediaSyncRuns)
    .values({ organizationId, provider: 'meta', accountExternalId, kind, status: 'running' })
    .returning({ id: schema.mediaSyncRuns.id });
  try {
    const rows = await fn();
    await db.update(schema.mediaSyncRuns).set({ status: 'ok', rowsWritten: rows, finishedAt: new Date() }).where(eq(schema.mediaSyncRuns.id, run!.id));
    return { ok: true, rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(schema.mediaSyncRuns).set({ status: 'error', errorMessage: message.slice(0, 500), finishedAt: new Date() }).where(eq(schema.mediaSyncRuns.id, run!.id));
    return { ok: false, rows: 0, error: message, rateLimited: error instanceof MetaGraphError && error.rateLimited };
  }
}

// ── Contas ───────────────────────────────────────────────────────────────

export async function upsertMetaAccounts(organizationId: string, connectionId: string, accounts: MetaAccountDetails[]): Promise<number> {
  for (const part of chunks(accounts)) {
    await db
      .insert(schema.mediaAdAccounts)
      .values(
        part.map((a) => ({
          organizationId,
          provider: 'meta',
          externalId: a.id,
          name: a.name,
          currency: a.currency,
          timezone: a.timezone,
          status: a.status,
          businessId: a.businessId,
          connectionId,
          balanceKind: a.balanceKind,
          balanceAmount: num(a.balanceAmount),
          spendCap: num(a.spendCap),
          amountSpent: num(a.amountSpent),
          lastSyncedAt: new Date(),
          lastSyncError: null,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.mediaAdAccounts.organizationId, schema.mediaAdAccounts.provider, schema.mediaAdAccounts.externalId],
        set: {
          name: sql`excluded.name`,
          currency: sql`excluded.currency`,
          timezone: sql`excluded.timezone`,
          status: sql`excluded.status`,
          businessId: sql`excluded.business_id`,
          connectionId: sql`excluded.connection_id`,
          balanceKind: sql`excluded.balance_kind`,
          balanceAmount: sql`excluded.balance_amount`,
          spendCap: sql`excluded.spend_cap`,
          amountSpent: sql`excluded.amount_spent`,
          lastSyncedAt: sql`excluded.last_synced_at`,
          lastSyncError: sql`null`,
          updatedAt: new Date(),
        },
      });
  }
  return accounts.length;
}

// ── Entidades e insights de UMA conta ────────────────────────────────────

export async function syncMetaAccountEntities(organizationId: string, token: string, accountId: string): Promise<number> {
  let written = 0;
  for (const level of LEVELS) {
    const entities = await fetchMetaEntities(token, accountId, level);
    for (const part of chunks(entities)) {
      await db
        .insert(schema.mediaEntities)
        .values(
          part.map((e) => ({
            organizationId,
            provider: 'meta',
            accountExternalId: accountId,
            level: e.level,
            externalId: e.id,
            parentExternalId: e.parentId,
            name: e.name,
            status: e.status,
            effectiveStatus: e.effectiveStatus,
            objective: e.objective,
            dailyBudget: num(e.dailyBudget),
            lifetimeBudget: num(e.lifetimeBudget),
            creative: e.creative ? { ...e.creative } : null,
            lastSeenAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [schema.mediaEntities.provider, schema.mediaEntities.level, schema.mediaEntities.externalId],
          set: {
            accountExternalId: sql`excluded.account_external_id`,
            parentExternalId: sql`excluded.parent_external_id`,
            name: sql`excluded.name`,
            status: sql`excluded.status`,
            effectiveStatus: sql`excluded.effective_status`,
            objective: sql`excluded.objective`,
            dailyBudget: sql`excluded.daily_budget`,
            lifetimeBudget: sql`excluded.lifetime_budget`,
            creative: sql`excluded.creative`,
            lastSeenAt: sql`excluded.last_seen_at`,
            updatedAt: new Date(),
          },
        });
      written += part.length;
    }
  }
  return written;
}

export async function syncMetaAccountInsights(
  organizationId: string,
  token: string,
  accountId: string,
  currency: string | null,
  days: number,
): Promise<number> {
  let written = 0;
  for (const level of LEVELS) {
    // Janelas curtas: uma conta grande com 90 dias no nível de anúncio faz o
    // Meta responder "Service temporarily unavailable" (medido em 20/10/2026),
    // e repetir a mesma chamada gigante não resolve. Pedaços pequenos passam.
    const rows: Awaited<ReturnType<typeof fetchMetaDailyInsights>> = [];
    // Em sequência, não em paralelo: a rajada é justamente o que o Meta recusa.
    for (const range of splitRange(days)) {
      rows.push(...(await fetchMetaDailyInsights(token, accountId, level, range)));
      await sleep(150);
    }
    for (const part of chunks(rows)) {
      await db
        .insert(schema.mediaInsightsDaily)
        .values(
          part.map((r) => ({
            organizationId,
            provider: 'meta',
            accountExternalId: accountId,
            level: r.level,
            entityExternalId: r.entityId,
            day: r.day,
            spend: num(r.spend),
            impressions: r.impressions === null ? null : Math.round(r.impressions),
            reach: r.reach === null ? null : Math.round(r.reach),
            clicks: r.clicks === null ? null : Math.round(r.clicks),
            results: num(r.results),
            resultsKind: r.resultsKind,
            conversionValue: num(r.conversionValue),
            frequency: num(r.frequency),
            currency,
            syncedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [schema.mediaInsightsDaily.provider, schema.mediaInsightsDaily.level, schema.mediaInsightsDaily.entityExternalId, schema.mediaInsightsDaily.day],
          set: {
            spend: sql`excluded.spend`,
            impressions: sql`excluded.impressions`,
            reach: sql`excluded.reach`,
            clicks: sql`excluded.clicks`,
            results: sql`excluded.results`,
            resultsKind: sql`excluded.results_kind`,
            conversionValue: sql`excluded.conversion_value`,
            frequency: sql`excluded.frequency`,
            currency: sql`excluded.currency`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
      written += part.length;
    }
  }
  return written;
}

// ── Orquestração ─────────────────────────────────────────────────────────

export interface MediaSyncReport {
  organizationId: string;
  accounts: number;
  accountsSynced: number;
  accountsFailed: Array<{ accountId: string; error: string }>;
  /** O Meta pediu para esperar: a rodada parou e as contas restantes ficam para a próxima. */
  rateLimited?: boolean;
  accountsDeferred?: number;
  rows: { entities: number; insights: number };
}

/** Contas com vínculo a cliente. Só elas gastam chamadas pesadas (entidades + insights). */
async function linkedMetaAccountIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ accountId: schema.clientMetaAccounts.accountId })
    .from(schema.clientMetaAccounts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.clientMetaAccounts.clientId))
    .where(eq(schema.clients.organizationId, organizationId));
  return rows.map((r) => r.accountId);
}

export interface MediaSyncOptions {
  /** Restringe a uma conta (botão "Sincronizar" de uma conta). */
  onlyAccountId?: string;
  /** Força janela longa (primeira carga). Sem isto: backfill se a conta nunca teve insights, senão incremental. */
  backfill?: boolean;
  access?: MetaAccess | null;
}

export async function syncMediaForCentralConnection(options: MediaSyncOptions = {}): Promise<MediaSyncReport | { status: 'not_connected' }> {
  const access = options.access ?? (await resolveMetaSystemAccess());
  if (!access || access.kind !== 'system' || !access.businessId) return { status: 'not_connected' };
  const organizationId = await resolveAgencyOrganizationId();
  if (!organizationId) return { status: 'not_connected' };

  const report: MediaSyncReport = { organizationId, accounts: 0, accountsSynced: 0, accountsFailed: [], rows: { entities: 0, insights: 0 } };

  let details: MetaAccountDetails[] = [];
  const discovery = await recordRun(organizationId, 'accounts', null, async () => {
    details = await fetchMetaBusinessAccountDetails(access.token, access.businessId!);
    return upsertMetaAccounts(organizationId, access.connectionId, details);
  });
  if (!discovery.ok) throw new Error(discovery.error);
  report.accounts = details.length;

  const linked = new Set(await linkedMetaAccountIds(organizationId));
  const targets = details.filter((d) => linked.has(d.id) && (!options.onlyAccountId || d.id === options.onlyAccountId));

  // Contas que ainda não têm nenhuma métrica vão primeiro: carga inicial antes de manutenção.
  const have = new Set((await db.selectDistinct({ id: schema.mediaInsightsDaily.accountExternalId }).from(schema.mediaInsightsDaily).where(eq(schema.mediaInsightsDaily.organizationId, organizationId))).map((r) => r.id));
  targets.sort((a, b) => Number(have.has(a.id)) - Number(have.has(b.id)));

  for (let i = 0; i < targets.length; i += 1) {
    const account = targets[i]!;
    const counted = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.mediaInsightsDaily)
      .where(and(eq(schema.mediaInsightsDaily.provider, 'meta'), eq(schema.mediaInsightsDaily.accountExternalId, account.id)));
    const days = options.backfill || (counted[0]?.n ?? 0) === 0 ? BACKFILL_DAYS : INCREMENTAL_DAYS;

    const entities = await recordRun(organizationId, 'entities', account.id, () => syncMetaAccountEntities(organizationId, access.token, account.id));
    const insights = await recordRun(organizationId, 'insights', account.id, () =>
      syncMetaAccountInsights(organizationId, access.token, account.id, account.currency, days),
    );
    report.rows.entities += entities.rows;
    report.rows.insights += insights.rows;

    const accountWhere = and(
      eq(schema.mediaAdAccounts.organizationId, organizationId),
      eq(schema.mediaAdAccounts.provider, 'meta'),
      eq(schema.mediaAdAccounts.externalId, account.id),
    );
    if (entities.ok && insights.ok) {
      report.accountsSynced += 1;
      await db.update(schema.mediaAdAccounts).set({ lastSyncedAt: new Date(), lastSyncError: null }).where(accountWhere);
    } else {
      const error = entities.error ?? insights.error ?? 'falha desconhecida';
      report.accountsFailed.push({ accountId: account.id, error });
      await db.update(schema.mediaAdAccounts).set({ lastSyncError: error.slice(0, 500) }).where(accountWhere);
    }
    if (entities.rateLimited || insights.rateLimited) {
      report.rateLimited = true;
      report.accountsDeferred = targets.length - i - 1;
      break;
    }
    await sleep(GAP_BETWEEN_ACCOUNTS_MS);
  }
  return report;
}
