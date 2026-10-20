import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { resolveCommunicationProvider } from './communication-provider-resolver';
import { deriveMetrics, pctChange, previousRange, resolvePeriod, type DateRange } from './media-metrics';
import { accountTotals, listLinkedAccounts, type LinkedMediaAccount } from './media-queries';
import { getMediaSettings } from './media-settings';
import { DEFAULT_TEMPLATES, formatMoney, renderTemplate, type TemplateValues } from './media-templates';

/**
 * media-alerts.ts — motor de alertas de Mídia.
 *
 * Duas propriedades que importam mais que qualquer regra individual:
 *  - IDEMPOTÊNCIA: o worker pode rodar a cada 15 min e ninguém recebe a mesma
 *    mensagem 96 vezes por dia. A chave de deduplicação é regra + janela de
 *    cooldown, e o índice único do banco é quem garante, não um "if" que duas
 *    execuções concorrentes poderiam furar.
 *  - ENVIO É OPT-IN EM TRÊS CAMADAS: o alerta é SEMPRE registrado (aparece na
 *    Central), mas a mensagem só sai se (1) a regra tem `sendEnabled`, (2) a
 *    configuração `whatsapp.sendEnabled` da organização/cliente está ligada e
 *    (3) há destino e o horário permite. Qualquer camada fechada = o evento
 *    fica `suppressed` com o motivo, e nada vai para cliente.
 */

export const ALERT_TYPES = ['low_balance', 'budget_limit', 'cpl_above', 'cpa_above', 'leads_drop', 'campaign_paused', 'campaign_rejected', 'sync_failed', 'account_inactive'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertFacts {
  account: Pick<LinkedMediaAccount, 'accountId' | 'name' | 'currency' | 'status' | 'balanceKind' | 'balanceAmount' | 'spendCap' | 'lastSyncError'>;
  amountSpent: number | null;
  window: { current: ReturnType<typeof deriveMetrics>; previous: ReturnType<typeof deriveMetrics>; resultKinds: string[] };
  /** Campanhas com gasto no período anterior e nenhum no atual, hoje pausadas. */
  stoppedCampaigns: string[];
  rejectedCampaigns: string[];
}

export interface AlertRuleLike {
  type: string;
  threshold: number | null;
}

export type Evaluation =
  | { fire: true; severity: 'info' | 'warning' | 'critical'; title: string; detail: Record<string, unknown> }
  | { fire: false; reason: string };

const brl = (v: number | null, c: string | null) => formatMoney(v, c) ?? 'indisponível';

/** Pura: decide se a regra dispara diante dos fatos. Sem banco, sem relógio. */
export function evaluateRule(rule: AlertRuleLike, f: AlertFacts): Evaluation {
  const t = rule.threshold;
  switch (rule.type as AlertType) {
    case 'low_balance': {
      if (f.account.balanceKind === 'UNAVAILABLE' || f.account.balanceAmount === null) return { fire: false, reason: 'saldo_indisponivel' };
      if (t === null) return { fire: false, reason: 'limite_nao_definido' };
      if (f.account.balanceAmount > t) return { fire: false, reason: 'acima_do_limite' };
      return {
        fire: true,
        severity: f.account.balanceAmount <= t / 2 ? 'critical' : 'warning',
        title: `${f.account.balanceKind === 'ACTUAL_BALANCE' ? 'Saldo' : 'Restante do limite de gastos (estimado)'} em ${brl(f.account.balanceAmount, f.account.currency)}`,
        detail: { balanceKind: f.account.balanceKind, balance: f.account.balanceAmount, threshold: t },
      };
    }
    case 'budget_limit': {
      if (f.account.spendCap === null || f.account.spendCap <= 0 || f.amountSpent === null) return { fire: false, reason: 'sem_limite_de_gastos' };
      if (t === null) return { fire: false, reason: 'limite_nao_definido' };
      const pct = (f.amountSpent / f.account.spendCap) * 100;
      if (pct < t) return { fire: false, reason: 'abaixo_do_limite' };
      return { fire: true, severity: pct >= 95 ? 'critical' : 'warning', title: `${pct.toFixed(0)}% do limite de gastos usado`, detail: { percent: Math.round(pct * 10) / 10, spendCap: f.account.spendCap, amountSpent: f.amountSpent, threshold: t } };
    }
    case 'cpl_above':
    case 'cpa_above': {
      const cost = f.window.current.costPerResult;
      if (t === null) return { fire: false, reason: 'limite_nao_definido' };
      if (cost === null) return { fire: false, reason: 'sem_resultados_no_periodo' };
      if (cost <= t) return { fire: false, reason: 'dentro_do_limite' };
      return { fire: true, severity: cost >= t * 1.5 ? 'critical' : 'warning', title: `Custo por resultado em ${brl(cost, f.account.currency)} (limite ${brl(t, f.account.currency)})`, detail: { costPerResult: cost, threshold: t, resultKinds: f.window.resultKinds } };
    }
    case 'leads_drop': {
      if (t === null) return { fire: false, reason: 'limite_nao_definido' };
      const change = pctChange(f.window.current.results, f.window.previous.results);
      if (change === null) return { fire: false, reason: 'sem_base_de_comparacao' };
      if (change > -t) return { fire: false, reason: 'queda_menor_que_o_limite' };
      return { fire: true, severity: change <= -50 ? 'critical' : 'warning', title: `Resultados caíram ${Math.abs(change).toFixed(0)}% vs período anterior`, detail: { change, current: f.window.current.results, previous: f.window.previous.results, threshold: t } };
    }
    case 'campaign_paused':
      if (f.stoppedCampaigns.length === 0) return { fire: false, reason: 'nenhuma_campanha_parou' };
      return { fire: true, severity: 'warning', title: `${f.stoppedCampaigns.length} campanha(s) que gastavam pararam`, detail: { campaigns: f.stoppedCampaigns.slice(0, 20) } };
    case 'campaign_rejected':
      if (f.rejectedCampaigns.length === 0) return { fire: false, reason: 'nenhuma_campanha_com_problema' };
      return { fire: true, severity: 'critical', title: `${f.rejectedCampaigns.length} campanha(s) reprovada(s) ou com problema`, detail: { campaigns: f.rejectedCampaigns.slice(0, 20) } };
    case 'sync_failed':
      if (!f.account.lastSyncError) return { fire: false, reason: 'sincronizacao_ok' };
      return { fire: true, severity: 'warning', title: 'Falha na sincronização da conta', detail: { error: f.account.lastSyncError } };
    case 'account_inactive':
      if (!f.account.status || f.account.status === 'ACTIVE') return { fire: false, reason: 'conta_ativa' };
      return { fire: true, severity: 'critical', title: `Conta com status ${f.account.status}`, detail: { status: f.account.status } };
    default:
      return { fire: false, reason: 'tipo_desconhecido' };
  }
}

/** Chave de idempotência: a mesma regra só pode gerar UM evento por janela de cooldown. */
export function dedupeKeyFor(ruleId: string, cooldownHours: number, now: Date): string {
  const bucket = Math.floor(now.getTime() / (Math.max(1, cooldownHours) * 3_600_000));
  return `${ruleId}:${bucket}`;
}

/** "HH:MM" de Brasília dentro de [start, end]? Janela que cruza a meia-noite também vale. */
export function withinSendWindow(window: { start: string; end: string } | null, now: Date, timeZone = 'America/Sao_Paulo'): boolean {
  if (!window) return true;
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return window.start <= window.end ? hhmm >= window.start && hhmm <= window.end : hhmm >= window.start || hhmm <= window.end;
}

// ── Execução ─────────────────────────────────────────────────────────────

async function gatherFacts(organizationId: string, account: LinkedMediaAccount, windowDays: number, now: Date): Promise<AlertFacts> {
  const base = resolvePeriod(windowDays <= 1 ? 'today' : windowDays <= 7 ? 'last_7d' : windowDays <= 14 ? 'last_14d' : 'last_30d', now);
  const range: DateRange = base;
  const prev = previousRange(range);
  const [cur, pre, spentRows, stopped, rejected] = await Promise.all([
    accountTotals(organizationId, account.accountId, range, 'campaign', account.provider),
    accountTotals(organizationId, account.accountId, prev, 'campaign', account.provider),
    db.select({ amountSpent: schema.mediaAdAccounts.amountSpent }).from(schema.mediaAdAccounts).where(and(eq(schema.mediaAdAccounts.organizationId, organizationId), eq(schema.mediaAdAccounts.provider, account.provider), eq(schema.mediaAdAccounts.externalId, account.accountId))),
    db.execute(sql`
      select e.name from media_entities e
      where e.organization_id = ${organizationId} and e.account_external_id = ${account.accountId} and e.level = 'campaign'
        and e.effective_status in ('PAUSED','CAMPAIGN_PAUSED')
        and exists (select 1 from media_insights_daily i where i.level = 'campaign' and i.entity_external_id = e.external_id and i.day >= ${prev.since} and i.day <= ${prev.until} and coalesce(i.spend,0) > 0)
        and not exists (select 1 from media_insights_daily i where i.level = 'campaign' and i.entity_external_id = e.external_id and i.day >= ${range.since} and i.day <= ${range.until} and coalesce(i.spend,0) > 0)`),
    db.execute(sql`select name from media_entities where organization_id = ${organizationId} and account_external_id = ${account.accountId} and level = 'campaign' and effective_status in ('DISAPPROVED','WITH_ISSUES')`),
  ]);
  const spent = spentRows[0]?.amountSpent;
  return {
    account,
    amountSpent: spent === null || spent === undefined ? null : Number(spent),
    window: { current: deriveMetrics(cur.totals), previous: deriveMetrics(pre.totals), resultKinds: cur.resultKinds },
    stoppedCampaigns: (stopped as unknown as Array<{ name: string }>).map((r) => r.name),
    rejectedCampaigns: (rejected as unknown as Array<{ name: string }>).map((r) => r.name),
  };
}

export type MessageSender = (input: { organizationId: string; destination: { kind: 'group' | 'contact'; externalId: string }; text: string; idempotencyKey: string }) => Promise<{ ok: true } | { ok: false; error: string }>;

/** Envio real pelo provider de WhatsApp da organização. Sem conector configurado, falha de forma explícita. */
export const defaultMessageSender: MessageSender = async ({ organizationId, destination, text, idempotencyKey }) => {
  try {
    const provider = await resolveCommunicationProvider(organizationId);
    if (!provider) return { ok: false, error: 'Esta organização não tem conector de WhatsApp configurado.' };
    await provider.sendMessage({ to: destination.externalId, text, idempotencyKey } as Parameters<typeof provider.sendMessage>[0]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export interface AlertRunSummary {
  rulesEvaluated: number;
  fired: number;
  deduped: number;
  skipped: Record<string, number>;
  delivery: Record<string, number>;
}

const TEMPLATE_FOR: Record<string, string> = { low_balance: 'low_balance', budget_limit: 'budget_limit', leads_drop: 'results_drop', cpl_above: 'results_drop', cpa_above: 'results_drop', campaign_paused: 'campaign_stopped' };

export async function runAlertEvaluation(options: { now?: Date; sender?: MessageSender; organizationId?: string } = {}): Promise<AlertRunSummary> {
  const now = options.now ?? new Date();
  const sender = options.sender ?? defaultMessageSender;
  const summary: AlertRunSummary = { rulesEvaluated: 0, fired: 0, deduped: 0, skipped: {}, delivery: {} };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

  const rules = await db
    .select()
    .from(schema.mediaAlertRules)
    .where(options.organizationId ? and(eq(schema.mediaAlertRules.enabled, true), eq(schema.mediaAlertRules.organizationId, options.organizationId)) : eq(schema.mediaAlertRules.enabled, true));

  for (const rule of rules) {
    summary.rulesEvaluated += 1;
    const accounts = await listLinkedAccounts({ organizationId: rule.organizationId, clientIds: [rule.clientId] }, { clientId: rule.clientId });
    const account = accounts.find((a) => a.accountId === rule.accountExternalId);
    if (!account) {
      bump(summary.skipped, 'conta_nao_vinculada');
      continue;
    }
    const facts = await gatherFacts(rule.organizationId, account, rule.windowDays, now);
    const result = evaluateRule({ type: rule.type, threshold: rule.threshold === null ? null : Number(rule.threshold) }, facts);
    await db.update(schema.mediaAlertRules).set({ lastEvaluatedAt: now }).where(eq(schema.mediaAlertRules.id, rule.id));
    if (!result.fire) {
      bump(summary.skipped, result.reason);
      continue;
    }

    // Idempotência: o índice único é quem decide. Dois workers ao mesmo tempo: um insere, o outro recebe 0 linhas.
    const [event] = await db
      .insert(schema.mediaAlertEvents)
      .values({
        organizationId: rule.organizationId,
        ruleId: rule.id,
        clientId: rule.clientId,
        dedupeKey: dedupeKeyFor(rule.id, rule.cooldownHours, now),
        severity: result.severity,
        title: result.title,
        detail: { ...result.detail, accountId: rule.accountExternalId, accountName: account.name },
        delivery: 'not_requested',
      })
      .onConflictDoNothing({ target: schema.mediaAlertEvents.dedupeKey })
      .returning({ id: schema.mediaAlertEvents.id });
    if (!event) {
      summary.deduped += 1;
      continue;
    }
    summary.fired += 1;
    await db.update(schema.mediaAlertRules).set({ lastFiredAt: now }).where(eq(schema.mediaAlertRules.id, rule.id));

    const settle = async (delivery: string, error?: string) => {
      bump(summary.delivery, delivery);
      await db.update(schema.mediaAlertEvents).set({ delivery, deliveryError: error ?? null }).where(eq(schema.mediaAlertEvents.id, event.id));
    };

    if (!rule.sendEnabled) {
      await settle('not_requested');
      continue;
    }
    const settings = await getMediaSettings(rule.organizationId, rule.clientId, `${rule.provider}:${rule.accountExternalId}`);
    if (!settings.values['whatsapp.sendEnabled']) { await settle('suppressed', 'envio desligado na configuração do workspace'); continue; }
    if (!rule.destination) { await settle('suppressed', 'regra sem destino'); continue; }
    if (!withinSendWindow(rule.sendWindow ?? settings.values['whatsapp.sendWindow'], now)) { await settle('suppressed', 'fora do horário permitido'); continue; }

    const [custom] = rule.templateId ? await db.select().from(schema.mediaMessageTemplates).where(eq(schema.mediaMessageTemplates.id, rule.templateId)) : [];
    const body = custom?.enabled ? custom.body : DEFAULT_TEMPLATES.find((t) => t.code === (TEMPLATE_FOR[rule.type] ?? 'executive_summary'))!.body;
    const [client] = await db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, rule.clientId));
    const values: TemplateValues = {
      cliente: client?.name ?? null,
      plataforma: account.provider === 'meta' ? 'Meta Ads' : 'Google Ads',
      conta: account.name,
      saldo: account.balanceAmount === null ? null : formatMoney(account.balanceAmount, account.currency),
      orcamento: formatMoney(account.spendCap, account.currency),
      investimento: formatMoney(facts.amountSpent ?? facts.window.current.spend, account.currency),
      cpl: formatMoney(facts.window.current.costPerResult, account.currency),
      leads: facts.window.current.results === null ? null : String(facts.window.current.results),
      periodo: `${windowLabel(rule.windowDays)}`,
      data: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(now),
    };
    const rendered = renderTemplate(body, values);
    if (!rendered.ok) { await settle('suppressed', `mensagem bloqueada: ${rendered.reason} (${rendered.variables.join(', ')})`); continue; }

    const sent = await sender({ organizationId: rule.organizationId, destination: rule.destination, text: rendered.text, idempotencyKey: `media-alert:${event.id}` });
    if (sent.ok) await settle('sent');
    else await settle('failed', sent.error);
  }
  return summary;
}

const windowLabel = (days: number) => (days <= 1 ? 'hoje' : `últimos ${days} dias`);
