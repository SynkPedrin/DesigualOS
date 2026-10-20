/** Formas das respostas de /media/*. camelCase vem direto de packages/tool-gateway/src/media-queries.ts. */

export type MediaPeriod = 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month';

export const MEDIA_PERIODS: Array<{ value: MediaPeriod; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês anterior' },
];

export interface DateRange {
  since: string;
  until: string;
}

export interface MediaLinkedAccount {
  clientId: string;
  clientName: string;
  provider: 'meta';
  accountId: string;
  label: string | null;
  isPrimary: boolean;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  balanceKind: 'ACTUAL_BALANCE' | 'ESTIMATED_REMAINING' | 'UNAVAILABLE' | string;
  balanceAmount: number | null;
  spendCap: number | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface MediaUnlinkedAccount {
  accountId: string;
  name: string | null;
  currency: string | null;
  status: string | null;
  businessId: string | null;
}

export interface Derived {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  results: number | null;
  conversionValue: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  costPerResult: number | null;
  roas: number | null;
}

export interface DailyPoint {
  day: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  results: number | null;
  costPerResult: number | null;
}

export interface MediaAccountSummary {
  accountId: string;
  currency: string | null;
  range: DateRange;
  previousRange: DateRange | null;
  current: Derived;
  previous: Derived | null;
  changes: Record<string, number | null> | null;
  resultKinds: string[];
  daily: DailyPoint[];
  campaigns: { total: number; active: number; paused: number; withIssues: number };
  lastSyncedAt: string | null;
  partialToday: boolean;
}

export interface MediaEntityRow extends Derived {
  id: string;
  level: 'campaign' | 'adset' | 'ad';
  parentId: string | null;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  updatedAt: string;
}

export interface MediaCreativeRow extends MediaEntityRow {
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

export interface MediaSettingsResponse {
  values: Record<string, unknown>;
  source: Record<string, 'default' | 'organization' | 'client' | 'account'>;
  keys: string[];
}

export interface MediaDestination {
  kind: 'group' | 'contact';
  externalId: string;
  label: string;
}

export interface MediaAlertRule {
  id: string;
  clientId: string;
  accountExternalId: string;
  type: string;
  threshold: string | null;
  windowDays: number;
  cooldownHours: number;
  destination: MediaDestination | null;
  templateId: string | null;
  sendWindow: { start: string; end: string } | null;
  sendEnabled: boolean;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  lastFiredAt: string | null;
}

export interface MediaAlertEvent {
  id: string;
  ruleId: string;
  clientId: string;
  clientName: string;
  status: 'open' | 'resolved' | 'ignored';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: Record<string, unknown>;
  delivery: 'not_requested' | 'suppressed' | 'queued' | 'sent' | 'failed';
  deliveryError: string | null;
  firedAt: string;
}

export interface MediaTemplate {
  id: string | null;
  code: string | null;
  name: string;
  body: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface MediaDestinationsResponse {
  sessions: Array<{ id: string; name: string; status: string }>;
  groups: Array<MediaDestination & { sessionId: string }>;
  contacts: Array<MediaDestination & { phone: string | null }>;
  sendConfigured: boolean;
}

export const ALERT_TYPE_LABEL: Record<string, string> = {
  low_balance: 'Saldo baixo',
  budget_limit: 'Limite de gastos próximo',
  cpl_above: 'CPL acima do limite',
  cpa_above: 'CPA acima do limite',
  leads_drop: 'Queda de resultados',
  campaign_paused: 'Campanha parou de gastar',
  campaign_rejected: 'Campanha reprovada',
  sync_failed: 'Falha de sincronização',
  account_inactive: 'Conta inativa',
};

export const ALERT_TYPE_UNIT: Record<string, string | null> = {
  low_balance: 'R$ (limite de saldo)',
  budget_limit: '% do limite de gastos',
  cpl_above: 'R$ por resultado',
  cpa_above: 'R$ por resultado',
  leads_drop: '% de queda',
  campaign_paused: null,
  campaign_rejected: null,
  sync_failed: null,
  account_inactive: null,
};

export interface MediaReportSchedule {
  id: string;
  clientId: string;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  timezone: string;
  channels: string[];
  periodDays: number;
  destination: MediaDestination | null;
  sendEnabled: boolean;
  enabled: boolean;
  lastRunAt: string | null;
}

export interface MediaActionRequest {
  id: string;
  clientName: string;
  accountExternalId: string;
  action: 'pause_campaign' | 'resume_campaign' | 'set_budget';
  targetExternalId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'blocked' | 'failed';
  blockedReason: string | null;
  requestedVia: string;
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  createdAt: string;
}
