import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getMediaSettings } from './media-settings';
import {
  providerOfAccount,
  getAccountSummary,
  getAgencyOverview,
  listCreatives,
  listEntities,
  listLinkedAccounts,
  type MediaScope,
} from './media-queries';
import { resolvePeriod, type DateRange, type MediaPeriod } from './media-metrics';
import { DEFAULT_TEMPLATES, formatMoney, renderTemplate, type TemplateValues } from './media-templates';

/**
 * media-agent-tools.ts — as ferramentas de mídia que os agentes de IA usam.
 *
 * NÃO é um segundo sistema: cada ferramenta é uma chamada às MESMAS funções
 * que a tela de Mídia usa (media-queries.ts / media-settings.ts). O agente
 * enxerga exatamente o que a pessoa que perguntou enxergaria, porque o
 * `scope` (empresa + clientes liberados) é o dela. As permissões do agente
 * vêm da configuração `agent.permissions`, a mesma que a tela edita.
 *
 * Nenhuma ferramenta aqui escreve na plataforma de anúncios. A única escrita
 * é `requestCampaignAction`, que registra um PEDIDO pendente: executar exige
 * aprovação de uma pessoa, em outra rota.
 */

export type AgentPermission = 'analyze' | 'generateReports' | 'prepareMessages' | 'proposeActions';

export class AgentDeniedError extends Error {
  constructor(readonly permission: AgentPermission, message: string) {
    super(message);
    this.name = 'AgentDeniedError';
  }
}

async function ensureAllowed(scope: MediaScope, clientId: string | null, accountId: string | null, permission: AgentPermission): Promise<void> {
  const settings = await getMediaSettings(scope.organizationId, clientId, accountId ? `${providerOfAccount(accountId)}:${accountId}` : null);
  if (!settings.values['agent.permissions'][permission]) {
    throw new AgentDeniedError(permission, `Esta ação está desligada para agentes nas configurações de Mídia (escopo: ${settings.source['agent.permissions']}).`);
  }
}

const range = (period: MediaPeriod | DateRange): DateRange => (typeof period === 'string' ? resolvePeriod(period) : period);

export const mediaTools = {
  /** list_media_clients */
  async listMediaClients(scope: MediaScope) {
    const accounts = await listLinkedAccounts(scope);
    const byClient = new Map<string, { clientId: string; clientName: string; accounts: number }>();
    for (const a of accounts) {
      const c = byClient.get(a.clientId) ?? { clientId: a.clientId, clientName: a.clientName, accounts: 0 };
      c.accounts += 1;
      byClient.set(a.clientId, c);
    }
    return [...byClient.values()];
  },

  /** list_media_accounts / get_media_account */
  async listMediaAccounts(scope: MediaScope, clientId?: string) {
    return listLinkedAccounts(scope, clientId ? { clientId } : {});
  },

  /** get_media_overview (conta) */
  async getMediaOverview(scope: MediaScope, accountId: string, period: MediaPeriod | DateRange = 'last_7d') {
    const account = (await listLinkedAccounts(scope)).find((a) => a.accountId === accountId);
    if (!account) return null;
    await ensureAllowed(scope, account.clientId, accountId, 'analyze');
    return getAccountSummary(scope, accountId, range(period), true);
  },

  /** visão consolidada: "quais clientes tiveram queda?" */
  async getAgencyOverview(scope: MediaScope, period: MediaPeriod = 'last_7d') {
    await ensureAllowed(scope, null, null, 'analyze');
    return getAgencyOverview(scope, range(period));
  },

  /** list_campaigns / list_ad_groups / list_ads */
  async listEntities(scope: MediaScope, accountId: string, level: 'campaign' | 'adset' | 'ad', period: MediaPeriod | DateRange = 'last_7d', sortBy: 'spend' | 'costPerResult' | 'ctr' | 'results' = 'spend', limit = 20) {
    const account = (await listLinkedAccounts(scope)).find((a) => a.accountId === accountId);
    if (!account) return null;
    await ensureAllowed(scope, account.clientId, accountId, 'analyze');
    return listEntities(scope, accountId, { level, range: range(period), sortBy, sortDir: sortBy === 'costPerResult' ? 'asc' : 'desc', limit });
  },

  /** get_ad_creatives: melhores e piores por custo por resultado, só entre anúncios com gasto e resultado medidos. */
  async getAdCreatives(scope: MediaScope, accountId: string, period: MediaPeriod | DateRange = 'last_30d') {
    const account = (await listLinkedAccounts(scope)).find((a) => a.accountId === accountId);
    if (!account) return null;
    await ensureAllowed(scope, account.clientId, accountId, 'analyze');
    const rows = (await listCreatives(scope, accountId, { range: range(period), sortBy: 'spend', limit: 500 })) ?? [];
    const ranked = rows.filter((r) => r.costPerResult !== null && (r.spend ?? 0) > 0);
    return {
      best: [...ranked].sort((a, b) => (a.costPerResult as number) - (b.costPerResult as number)).slice(0, 5),
      worst: [...ranked].sort((a, b) => (b.costPerResult as number) - (a.costPerResult as number)).slice(0, 5),
      measured: ranked.length,
      total: rows.length,
    };
  },

  /** compare_performance_periods */
  async comparePeriods(scope: MediaScope, accountId: string, period: MediaPeriod | DateRange) {
    return this.getMediaOverview(scope, accountId, period);
  },

  /** get_budget_status: diz de que TIPO é o número (real, estimado ou indisponível). */
  async getBudgetStatus(scope: MediaScope, accountId: string) {
    const account = (await listLinkedAccounts(scope)).find((a) => a.accountId === accountId);
    if (!account) return null;
    return { accountId, currency: account.currency, kind: account.balanceKind, amount: account.balanceAmount, spendCap: account.spendCap, syncedAt: account.lastSyncedAt };
  },

  /** list_media_alerts */
  async listAlerts(scope: MediaScope, status: 'open' | 'resolved' | 'ignored' = 'open') {
    const rows = await db
      .select({ event: schema.mediaAlertEvents, clientName: schema.clients.name })
      .from(schema.mediaAlertEvents)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.mediaAlertEvents.clientId))
      .where(and(eq(schema.mediaAlertEvents.organizationId, scope.organizationId), eq(schema.mediaAlertEvents.status, status)))
      .orderBy(desc(schema.mediaAlertEvents.firedAt))
      .limit(50);
    const allowed = scope.clientIds ? new Set(scope.clientIds) : null;
    return rows.filter((r) => !allowed || allowed.has(r.event.clientId)).map((r) => ({ clientName: r.clientName, severity: r.event.severity, title: r.event.title, firedAt: r.event.firedAt.toISOString(), delivery: r.event.delivery }));
  },

  /** get_media_settings: a MESMA resolução que a tela mostra. */
  async getSettings(scope: MediaScope, clientId: string | null, accountId: string | null) {
    return getMediaSettings(scope.organizationId, clientId, accountId ? `${providerOfAccount(accountId)}:${accountId}` : null);
  },

  /** list_whatsapp_destinations: só o que a sessão conectada realmente tem. */
  async listWhatsappDestinations(scope: MediaScope) {
    const sessions = await db.select({ id: schema.whatsappSessions.id, status: schema.whatsappSessions.status }).from(schema.whatsappSessions).where(eq(schema.whatsappSessions.organizationId, scope.organizationId));
    return { connected: sessions.some((s) => s.status === 'ready'), sessions: sessions.map((s) => s.status) };
  },

  /** prepare_whatsapp_message: monta e valida o texto. NUNCA envia. */
  async prepareWhatsappMessage(scope: MediaScope, accountId: string, templateCode: string, period: MediaPeriod = 'last_7d') {
    const account = (await listLinkedAccounts(scope)).find((a) => a.accountId === accountId);
    if (!account) return null;
    await ensureAllowed(scope, account.clientId, accountId, 'prepareMessages');
    const summary = await getAccountSummary(scope, accountId, resolvePeriod(period), false);
    const template = DEFAULT_TEMPLATES.find((t) => t.code === templateCode);
    if (!template || !summary) return { ok: false as const, reason: 'template_ou_dados_indisponiveis' };
    const values: TemplateValues = {
      cliente: account.clientName,
      plataforma: account.provider === 'meta' ? 'Meta Ads' : 'Google Ads',
      conta: account.name,
      saldo: account.balanceKind === 'UNAVAILABLE' ? null : formatMoney(account.balanceAmount, account.currency),
      orcamento: formatMoney(account.spendCap, account.currency),
      investimento: formatMoney(summary.current.spend, account.currency),
      cpl: formatMoney(summary.current.costPerResult, account.currency),
      leads: summary.current.results === null ? null : String(summary.current.results),
      periodo: `${summary.range.since} a ${summary.range.until}`,
      data: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    };
    const rendered = renderTemplate(template.body, values);
    return rendered.ok ? { ok: true as const, text: rendered.text, sent: false as const } : { ok: false as const, reason: rendered.reason, variables: rendered.variables };
  },

  /**
   * request_campaign_action: registra um PEDIDO. Não executa nada. Executar é
   * uma decisão humana, na rota de aprovação (apps/api/src/media/routes.ts).
   */
  async requestCampaignAction(
    scope: MediaScope,
    userId: string,
    input: { accountId: string; action: 'pause_campaign' | 'resume_campaign' | 'set_budget'; campaignId: string; dailyBudget?: number },
  ) {
    const account = (await listLinkedAccounts(scope)).find((a) => a.accountId === input.accountId);
    if (!account) return null;
    await ensureAllowed(scope, account.clientId, input.accountId, 'proposeActions');
    if (account.provider !== 'meta') throw new Error('Ações em campanha só estão disponíveis para o Meta Ads por enquanto.');
    const [row] = await db
      .insert(schema.mediaActionRequests)
      .values({
        organizationId: scope.organizationId,
        clientId: account.clientId,
        provider: account.provider,
        accountExternalId: input.accountId,
        action: input.action,
        targetExternalId: input.campaignId,
        payload: input.dailyBudget !== undefined ? { dailyBudget: input.dailyBudget } : {},
        status: 'pending',
        requestedBy: userId,
        requestedVia: 'agent',
      })
      .returning({ id: schema.mediaActionRequests.id, status: schema.mediaActionRequests.status });
    return row;
  },
};

// ── Texto para o agente de tráfego (Jarbas) ──────────────────────────────

/**
 * Bloco de DADOS que o Jarbas recebe além da leitura ao vivo: contexto do
 * Command Center. Cada afirmação traz de onde veio (banco sincronizado, data
 * da sincronização) e o que não se sabe é dito como "indisponível".
 */
export async function mediaContextForAgent(scope: MediaScope, clientId: string): Promise<{ allowed: boolean; text: string }> {
  const settings = await getMediaSettings(scope.organizationId, clientId, null);
  if (!settings.values['agent.permissions'].analyze) {
    return { allowed: false, text: 'ANÁLISE POR AGENTE DESLIGADA nas configurações de Mídia deste cliente. Diga isso e oriente a ligar em Mídia → Configurações → Agentes de IA.' };
  }
  const accounts = await listLinkedAccounts(scope, { clientId });
  if (accounts.length === 0) return { allowed: true, text: '' };

  const lines: string[] = ['CONTEXTO DO MEDIA COMMAND CENTER (banco sincronizado; confira a data de sincronização de cada conta):'];
  const period = settings.values['dashboard.defaultPeriod'];
  for (const acc of accounts) {
    const sum = await getAccountSummary(scope, acc.accountId, resolvePeriod(period), true);
    lines.push(`- Conta ${acc.name ?? acc.accountId} (${acc.accountId}) · ${acc.currency ?? '?'} · sincronizada em ${acc.lastSyncedAt ?? 'nunca'}${acc.lastSyncError ? ` · ÚLTIMA SINCRONIZAÇÃO FALHOU: ${acc.lastSyncError}` : ''}`);
    if (sum) {
      lines.push(`  Período ${sum.range.since} a ${sum.range.until}: investimento ${sum.current.spend ?? 'indisponível'}, resultados ${sum.current.results ?? 'indisponível'} (${sum.resultKinds.join(', ') || 'tipo não rastreado'}), custo por resultado ${sum.current.costPerResult ?? 'indisponível'}.`);
      lines.push(`  Campanhas: ${sum.campaigns.active} ativas, ${sum.campaigns.paused} pausadas, ${sum.campaigns.withIssues} com problema.`);
    }
    lines.push(`  Saldo: ${acc.balanceKind === 'UNAVAILABLE' ? 'indisponível (a conexão não lê saldo desta conta)' : `${acc.balanceKind === 'ESTIMATED_REMAINING' ? 'ESTIMATIVA do que falta para o limite de gastos' : 'saldo real'}: ${acc.balanceAmount}`}.`);
  }
  const alerts = await mediaTools.listAlerts(scope, 'open');
  const mine = alerts.filter((a) => accounts.some((acc) => acc.clientName === a.clientName));
  lines.push(mine.length ? `Alertas abertos: ${mine.map((a) => `${a.title} (${a.severity})`).join('; ')}.` : 'Alertas abertos: nenhum.');
  lines.push('Você NÃO altera campanhas. Se sugerir uma ação, deixe claro que é uma recomendação a ser aprovada por uma pessoa.');
  return { allowed: true, text: lines.join('\n') };
}
