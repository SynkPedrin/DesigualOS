import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { MemberCalendarAccountWire, MicrosoftCalendarIntegrationStatusWire, MicrosoftCalendarListEntryWire } from '@/lib/api/contracts';

/** Conexão Microsoft 365/Outlook Calendar POR COLABORADOR (07/10/2026) — mesmo desenho de useGoogleCalendarIntegration. */
export function useMicrosoftCalendarIntegration() {
  return useQuery({
    queryKey: ['integrations', 'microsoft-calendar'],
    queryFn: () => apiFetch<MicrosoftCalendarIntegrationStatusWire>('/integrations/microsoft-calendar/status'),
  });
}

export function useConnectMicrosoftCalendar() {
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>('/integrations/microsoft-calendar/authorize');
      window.location.href = authorize_url;
    },
  });
}

export function useMicrosoftCalendarList(enabled: boolean) {
  return useQuery({
    queryKey: ['integrations', 'microsoft-calendar', 'calendars'],
    queryFn: async () => {
      const wire = await apiFetch<{ calendars: MicrosoftCalendarListEntryWire[] }>('/integrations/microsoft-calendar/calendars');
      return wire.calendars;
    },
    enabled,
  });
}

export function useMicrosoftCalendarAccounts() {
  return useQuery({
    queryKey: ['calendar', 'microsoft', 'accounts'],
    queryFn: async () => {
      const wire = await apiFetch<{ accounts: MemberCalendarAccountWire[] }>('/calendar/microsoft/accounts');
      return wire.accounts;
    },
  });
}

export function useLinkMicrosoftCalendarAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (externalCalendarId: string) =>
      apiFetch<MemberCalendarAccountWire>('/calendar/microsoft/accounts', { method: 'POST', body: JSON.stringify({ external_calendar_id: externalCalendarId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export function useSyncMicrosoftCalendarAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => apiFetch<{ ok: boolean; events_upserted: number; events_cancelled: number }>(`/calendar/microsoft/accounts/${accountId}/sync`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}
