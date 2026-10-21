import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type {
  HubCreative,
  HubCreativeFilters,
  MediaAccountSummary,
  MediaHub,
  MediaActionRequest,
  MediaReportSchedule,
  MediaAlertEvent,
  MediaAlertRule,
  MediaCreativeRow,
  MediaDestinationsResponse,
  MediaEntityRow,
  MediaLinkedAccount,
  MediaPeriod,
  MediaSettingsResponse,
  MediaTemplate,
  MediaUnlinkedAccount,
} from '@/lib/api/media';

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

export function useMediaAccounts(clientId: string | null) {
  return useQuery({
    queryKey: ['media', 'accounts', clientId],
    queryFn: () => apiFetch<{ linked: MediaLinkedAccount[]; unlinked: MediaUnlinkedAccount[] }>(`/media/accounts${qs({ client_id: clientId })}`),
    enabled: Boolean(clientId),
  });
}

export function useMediaSummary(accountId: string | null, period: MediaPeriod, compare: boolean) {
  return useQuery({
    queryKey: ['media', 'summary', accountId, period, compare],
    queryFn: () => apiFetch<MediaAccountSummary>(`/media/accounts/${encodeURIComponent(accountId!)}/summary${qs({ period, compare })}`),
    enabled: Boolean(accountId),
    placeholderData: keepPreviousData,
  });
}

export interface EntityParams {
  level: 'campaign' | 'adset' | 'ad';
  parentId?: string | null;
  search?: string;
  status?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}

export function useMediaEntities(accountId: string | null, period: MediaPeriod, p: EntityParams) {
  return useQuery({
    queryKey: ['media', 'entities', accountId, period, p],
    queryFn: () =>
      apiFetch<{ rows: MediaEntityRow[] }>(
        `/media/accounts/${encodeURIComponent(accountId!)}/entities${qs({ period, level: p.level, parent_id: p.parentId, search: p.search, status: p.status, sort: p.sort, dir: p.dir })}`,
      ),
    enabled: Boolean(accountId),
    placeholderData: keepPreviousData,
  });
}

export function useMediaCreatives(accountId: string | null, period: MediaPeriod, sort: string, dir: 'asc' | 'desc') {
  return useQuery({
    queryKey: ['media', 'creatives', accountId, period, sort, dir],
    queryFn: () => apiFetch<{ rows: MediaCreativeRow[] }>(`/media/accounts/${encodeURIComponent(accountId!)}/creatives${qs({ period, sort, dir, limit: 200 })}`),
    enabled: Boolean(accountId),
    placeholderData: keepPreviousData,
  });
}

export function useSyncMediaAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => apiFetch<unknown>(`/media/accounts/${encodeURIComponent(accountId)}/sync`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  });
}

export function useMediaSettings(clientId: string | null, accountId: string | null) {
  return useQuery({
    queryKey: ['media', 'settings', clientId, accountId],
    queryFn: () => apiFetch<MediaSettingsResponse>(`/media/settings${qs({ client_id: clientId, account_id: accountId })}`),
  });
}

export function useSetMediaSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { key: string; value?: unknown; clientId?: string | null; accountId?: string | null; reset?: boolean }) =>
      apiFetch<MediaSettingsResponse>('/media/settings', { method: 'PUT', body: JSON.stringify({ key: b.key, value: b.value, client_id: b.clientId ?? null, account_id: b.accountId ?? null, reset: b.reset ?? false }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'settings'] }),
  });
}

export function useMediaAlertRules(clientId: string | null) {
  return useQuery({
    queryKey: ['media', 'alert-rules', clientId],
    queryFn: () => apiFetch<{ rules: MediaAlertRule[]; types: string[] }>(`/media/alert-rules${qs({ client_id: clientId })}`),
  });
}

export function useSaveAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id?: string; body: Record<string, unknown> }) =>
      b.id
        ? apiFetch<MediaAlertRule>(`/media/alert-rules/${b.id}`, { method: 'PATCH', body: JSON.stringify(b.body) })
        : apiFetch<MediaAlertRule>('/media/alert-rules', { method: 'POST', body: JSON.stringify(b.body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'alert-rules'] }),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/media/alert-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'alert-rules'] }),
  });
}

export function useMediaAlerts(clientId: string | null) {
  return useQuery({
    queryKey: ['media', 'alerts', clientId],
    queryFn: () => apiFetch<{ alerts: MediaAlertEvent[] }>(`/media/alerts${qs({ client_id: clientId, limit: 100 })}`),
  });
}

export function useSetAlertStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id: string; status: 'open' | 'resolved' | 'ignored' }) => apiFetch<unknown>(`/media/alerts/${b.id}`, { method: 'PATCH', body: JSON.stringify({ status: b.status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'alerts'] }),
  });
}

export function useEvaluateAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ rulesEvaluated: number; fired: number; deduped: number; skipped: Record<string, number>; delivery: Record<string, number> }>('/media/alerts/evaluate', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', 'alerts'] });
      qc.invalidateQueries({ queryKey: ['media', 'alert-rules'] });
    },
  });
}

export function useMediaTemplates() {
  return useQuery({ queryKey: ['media', 'templates'], queryFn: () => apiFetch<{ templates: MediaTemplate[] }>('/media/templates') });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id?: string | null; code?: string | null; name: string; body: string; enabled?: boolean }) =>
      b.id
        ? apiFetch<unknown>(`/media/templates/${b.id}`, { method: 'PUT', body: JSON.stringify({ name: b.name, body: b.body, enabled: b.enabled }) })
        : apiFetch<unknown>('/media/templates', { method: 'POST', body: JSON.stringify({ code: b.code ?? null, name: b.name, body: b.body, enabled: b.enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/media/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'templates'] }),
  });
}

export function usePreviewTemplate() {
  return useMutation({ mutationFn: (body: string) => apiFetch<{ ok: boolean; text?: string; reason?: string; variables?: string[]; isSample?: boolean }>('/media/templates/preview', { method: 'POST', body: JSON.stringify({ body }) }) });
}

export function useMediaDestinations() {
  return useQuery({ queryKey: ['media', 'destinations'], queryFn: () => apiFetch<MediaDestinationsResponse>('/media/whatsapp/destinations') });
}

export function useMediaReportSchedules(clientId: string | null) {
  return useQuery({
    queryKey: ['media', 'report-schedules', clientId],
    queryFn: () => apiFetch<{ schedules: MediaReportSchedule[] }>(`/media/report-schedules${qs({ client_id: clientId })}`),
  });
}

export function useSaveReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id?: string; body: Record<string, unknown> }) =>
      b.id
        ? apiFetch<MediaReportSchedule>(`/media/report-schedules/${b.id}`, { method: 'PATCH', body: JSON.stringify(b.body) })
        : apiFetch<MediaReportSchedule>('/media/report-schedules', { method: 'POST', body: JSON.stringify(b.body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'report-schedules'] }),
  });
}

export function useDeleteReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/media/report-schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'report-schedules'] }),
  });
}

export function useMediaActions() {
  return useQuery({ queryKey: ['media', 'actions'], queryFn: () => apiFetch<{ executionEnabled: boolean; actions: MediaActionRequest[] }>('/media/actions') });
}

export function useDecideAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { id: string; decision: 'approve' | 'reject' }) =>
      apiFetch<{ status: string; reason?: string }>(`/media/actions/${b.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: b.decision, confirm: b.decision === 'approve' ? true : undefined }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', 'actions'] }),
  });
}

/** Associação MANUAL de uma conta sem cliente a um cliente (nunca por nome parecido). */
export function useLinkMediaAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { clientId: string; accountId: string }) => apiFetch<{ ok: boolean; client: string }>('/media/accounts/link', { method: 'POST', body: JSON.stringify({ client_id: b.clientId, account_id: b.accountId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

/** A carteira inteira: KPIs com tendência, atenção, insights e atividade (tela inicial de Mídias). */
export function useMediaHub(period: MediaPeriod, compare = true) {
  return useQuery({
    queryKey: ['media', 'hub', period, compare],
    queryFn: () => apiFetch<MediaHub>(`/media/hub${qs({ period, compare })}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Criativos de TODAS as contas vinculadas, com filtros no servidor e paginação. */
export function useHubCreatives(f: HubCreativeFilters) {
  return useQuery({
    queryKey: ['media', 'hub-creatives', f],
    queryFn: () =>
      apiFetch<{ total: number; rows: HubCreative[] }>(
        `/media/hub/creatives${qs({ period: f.period, provider: f.provider, account_id: f.accountId, q: f.q, status: f.status, objective: f.objective, with_spend: f.withSpend === false ? 'false' : undefined, sort: f.sort, limit: f.limit ?? 24, offset: f.offset })}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
