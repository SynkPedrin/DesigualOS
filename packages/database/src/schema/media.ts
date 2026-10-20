import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './_shared';
import { organizations } from './organizations';
import { clients } from './clients';
import { users } from './identity';
import { integrationConnections } from './integrations';

/**
 * Media Command Center — dados persistidos do módulo Mídia.
 *
 * REGRA DE ARQUITETURA: o VÍNCULO cliente↔conta continua em
 * `client_meta_accounts` / `client_google_ads_accounts`. Estas tabelas NÃO
 * duplicam o vínculo; guardam o que a tela e os agentes precisam sem chamar o
 * Meta/Google a cada renderização: o catálogo de contas descobertas, a
 * hierarquia de campanhas, as métricas por dia, as configurações, os alertas.
 *
 * Tudo carrega `organization_id` (isolamento de tenant) e é aditivo: nenhuma
 * tabela existente foi alterada.
 */

/** Catálogo de contas descobertas pela conexão. Conta sem vínculo aparece aqui como "não vinculada". */
export const mediaAdAccounts = pgTable(
  'media_ad_accounts',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** 'meta' | 'google_ads'. Texto aberto, como `integration_connections.provider`. */
    provider: text('provider').notNull(),
    /** Meta: "act_123". Google: customer id sem hífen. */
    externalId: text('external_id').notNull(),
    name: text('name'),
    currency: text('currency'),
    timezone: text('timezone'),
    /** Status bruto da plataforma (Meta account_status). Interpretação fica na aplicação. */
    status: text('status'),
    businessId: text('business_id'),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
    /** 'ACTUAL_BALANCE' | 'ESTIMATED_REMAINING' | 'UNAVAILABLE' — nunca estimativa vestida de saldo real. */
    balanceKind: text('balance_kind').notNull().default('UNAVAILABLE'),
    balanceAmount: numeric('balance_amount', { precision: 14, scale: 2 }),
    spendCap: numeric('spend_cap', { precision: 14, scale: 2 }),
    amountSpent: numeric('amount_spent', { precision: 14, scale: 2 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    ...timestampColumns,
  },
  (t) => ({
    providerExternalUnique: unique('media_ad_accounts_org_provider_external_unique').on(t.organizationId, t.provider, t.externalId),
    orgIdx: index('media_ad_accounts_org_idx').on(t.organizationId),
  }),
);

/** Hierarquia de entidades: campanha → conjunto/grupo → anúncio. `parent_external_id` aponta o nível acima. */
export const mediaEntities = pgTable(
  'media_entities',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accountExternalId: text('account_external_id').notNull(),
    /** 'campaign' | 'adset' | 'ad' */
    level: text('level').notNull(),
    externalId: text('external_id').notNull(),
    parentExternalId: text('parent_external_id'),
    name: text('name').notNull(),
    status: text('status'),
    effectiveStatus: text('effective_status'),
    objective: text('objective'),
    /** Valores monetários na moeda da conta, em unidade (não centavos). */
    dailyBudget: numeric('daily_budget', { precision: 14, scale: 2 }),
    lifetimeBudget: numeric('lifetime_budget', { precision: 14, scale: 2 }),
    /** Só para level='ad': título, texto, CTA, link, thumbnail, imagem. Mídia privada não é copiada. */
    creative: jsonb('creative').$type<Record<string, unknown>>(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestampColumns,
  },
  (t) => ({
    entityUnique: unique('media_entities_provider_level_external_unique').on(t.provider, t.level, t.externalId),
    accountIdx: index('media_entities_account_idx').on(t.organizationId, t.provider, t.accountExternalId, t.level),
  }),
);

/** Métricas por dia e por entidade. A tela lê daqui; a plataforma só é chamada pelo job de sync. */
export const mediaInsightsDaily = pgTable(
  'media_insights_daily',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accountExternalId: text('account_external_id').notNull(),
    level: text('level').notNull(),
    entityExternalId: text('entity_external_id').notNull(),
    day: date('day').notNull(),
    spend: numeric('spend', { precision: 14, scale: 2 }),
    impressions: integer('impressions'),
    reach: integer('reach'),
    clicks: integer('clicks'),
    /** Leads/mensagens/conversões como a plataforma reporta. `results_kind` diz o que são. */
    results: numeric('results', { precision: 14, scale: 2 }),
    resultsKind: text('results_kind'),
    conversionValue: numeric('conversion_value', { precision: 14, scale: 2 }),
    frequency: numeric('frequency', { precision: 10, scale: 4 }),
    currency: text('currency'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dayUnique: unique('media_insights_daily_entity_day_unique').on(t.provider, t.level, t.entityExternalId, t.day),
    accountDayIdx: index('media_insights_daily_account_day_idx').on(t.organizationId, t.provider, t.accountExternalId, t.level, t.day),
  }),
);

/** Histórico de sincronização: uma linha por execução e conta. */
export const mediaSyncRuns = pgTable(
  'media_sync_runs',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accountExternalId: text('account_external_id'),
    /** 'accounts' | 'entities' | 'insights' */
    kind: text('kind').notNull(),
    /** 'running' | 'ok' | 'error' */
    status: text('status').notNull(),
    rowsWritten: integer('rows_written').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    orgStartedIdx: index('media_sync_runs_org_started_idx').on(t.organizationId, t.startedAt),
  }),
);

/**
 * SINGLE SOURCE OF TRUTH das configurações de Mídia. Mídia (telas), Alicia/
 * agentes, motor de alertas, relatórios e WhatsApp leem DAQUI.
 *
 * Precedência (mais específico vence): conta > cliente(workspace) > organização.
 * `client_id` e `account_key` nulos = escopo mais amplo. O resolvedor mora em
 * packages/tool-gateway/src/media-settings.ts.
 */
export const mediaSettings = pgTable(
  'media_settings',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    /** "provider:externalId". Null = vale para o cliente/organização inteiros. */
    accountKey: text('account_key'),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    // NULLS NOT DISTINCT: sem isso duas linhas "organização inteira" da mesma chave conviveriam.
    scopeUnique: unique('media_settings_scope_key_unique').on(t.organizationId, t.clientId, t.accountKey, t.key).nullsNotDistinct(),
  }),
);

export const mediaAlertRules = pgTable(
  'media_alert_rules',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accountExternalId: text('account_external_id').notNull(),
    /** low_balance | budget_limit | cpl_above | cpa_above | leads_drop | campaign_paused | campaign_rejected | sync_failed | token_invalid */
    type: text('type').notNull(),
    threshold: numeric('threshold', { precision: 14, scale: 4 }),
    windowDays: integer('window_days').notNull().default(1),
    cooldownHours: integer('cooldown_hours').notNull().default(24),
    /** Destino WhatsApp: { kind:'group'|'contact', externalId, label }. Null = só aparece na Central, nada é enviado. */
    destination: jsonb('destination').$type<{ kind: 'group' | 'contact'; externalId: string; label: string } | null>(),
    templateId: uuid('template_id'),
    /** Janela permitida de envio, hora local de São Paulo: { start:'08:00', end:'20:00' }. */
    sendWindow: jsonb('send_window').$type<{ start: string; end: string } | null>(),
    /** Envio real exige ligar isto de propósito. Padrão: alerta é registrado, mensagem NÃO sai. */
    sendEnabled: boolean('send_enabled').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    orgIdx: index('media_alert_rules_org_idx').on(t.organizationId, t.enabled),
    clientIdx: index('media_alert_rules_client_idx').on(t.clientId),
  }),
);

export const mediaAlertEvents = pgTable(
  'media_alert_events',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id').notNull().references(() => mediaAlertRules.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    /** Idempotência: regra + janela de cooldown. Reexecutar o worker não duplica. */
    dedupeKey: text('dedupe_key').notNull(),
    /** 'open' | 'resolved' | 'ignored' */
    status: text('status').notNull().default('open'),
    severity: text('severity').notNull().default('warning'),
    title: text('title').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    /** 'not_requested' | 'suppressed' | 'queued' | 'sent' | 'failed' */
    delivery: text('delivery').notNull().default('not_requested'),
    deliveryError: text('delivery_error'),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    dedupeUnique: unique('media_alert_events_dedupe_unique').on(t.dedupeKey),
    orgFiredIdx: index('media_alert_events_org_fired_idx').on(t.organizationId, t.firedAt),
  }),
);

export const mediaMessageTemplates = pgTable(
  'media_message_templates',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Chave estável do padrão (low_balance, weekly_report...) ou null em template livre. */
    code: text('code'),
    name: text('name').notNull(),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    orgIdx: index('media_message_templates_org_idx').on(t.organizationId),
  }),
);

export const mediaReportSchedules = pgTable(
  'media_report_schedules',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    /** 'daily' | 'weekly' | 'biweekly' | 'monthly' */
    frequency: text('frequency').notNull(),
    /** 0-6 (domingo=0) para weekly/biweekly; 1-28 para monthly. */
    dayOfWeek: integer('day_of_week'),
    dayOfMonth: integer('day_of_month'),
    hour: integer('hour').notNull().default(9),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    channels: jsonb('channels').$type<string[]>().notNull().default(['meta']),
    periodDays: integer('period_days').notNull().default(7),
    destination: jsonb('destination').$type<{ kind: 'group' | 'contact'; externalId: string; label: string } | null>(),
    templateId: uuid('template_id'),
    sendEnabled: boolean('send_enabled').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /** Chave do último período gerado (ex.: "2026-W43"): impede gerar duas vezes o mesmo período. */
    lastPeriodKey: text('last_period_key'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestampColumns,
  },
  (t) => ({
    orgIdx: index('media_report_schedules_org_idx').on(t.organizationId, t.enabled),
  }),
);

/** Auditoria específica de Mídia (mudança de configuração, ação supervisionada). Complementa `audit_logs`. */
export const mediaActionRequests = pgTable(
  'media_action_requests',
  {
    ...idColumn,
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    accountExternalId: text('account_external_id').notNull(),
    /** 'pause_campaign' | 'resume_campaign' | 'set_budget' */
    action: text('action').notNull(),
    targetExternalId: text('target_external_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    stateBefore: jsonb('state_before').$type<Record<string, unknown>>(),
    stateAfter: jsonb('state_after').$type<Record<string, unknown>>(),
    /** 'pending' | 'approved' | 'rejected' | 'executed' | 'blocked' | 'failed' */
    status: text('status').notNull().default('pending'),
    blockedReason: text('blocked_reason'),
    requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    /** Quem pediu pode ser um agente; quem aprova é sempre uma pessoa. */
    requestedVia: text('requested_via').notNull().default('web'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (t) => ({
    orgIdx: index('media_action_requests_org_idx').on(t.organizationId, t.status),
  }),
);
