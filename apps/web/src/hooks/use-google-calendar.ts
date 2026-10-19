import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { GoogleCalendarIntegrationStatusWire, GoogleCalendarListEntryWire, MemberCalendarAccountWire } from '@/lib/api/contracts';

/** Conexão Google Calendar POR COLABORADOR — mesmo desenho de useMetaIntegration/useGoogleAdsIntegration. */
export function useGoogleCalendarIntegration() {
  return useQuery({
    queryKey: ['integrations', 'google-calendar'],
    queryFn: () => apiFetch<GoogleCalendarIntegrationStatusWire>('/integrations/google-calendar/status'),
  });
}

export function useConnectGoogleCalendar() {
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>('/integrations/google-calendar/authorize');
      window.location.href = authorize_url;
    },
  });
}

export function useGoogleCalendarList(enabled: boolean) {
  return useQuery({
    queryKey: ['integrations', 'google-calendar', 'calendars'],
    queryFn: async () => {
      const wire = await apiFetch<{ calendars: GoogleCalendarListEntryWire[] }>('/integrations/google-calendar/calendars');
      return wire.calendars;
    },
    enabled,
  });
}

export function useMemberCalendarAccounts() {
  return useQuery({
    queryKey: ['calendar', 'google', 'accounts'],
    queryFn: async () => {
      const wire = await apiFetch<{ accounts: MemberCalendarAccountWire[] }>('/calendar/google/accounts');
      return wire.accounts;
    },
  });
}

export function useLinkMemberCalendarAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (externalCalendarId: string) => apiFetch<MemberCalendarAccountWire>('/calendar/google/accounts', { method: 'POST', body: JSON.stringify({ external_calendar_id: externalCalendarId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export function useSyncMemberCalendarAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => apiFetch<{ ok: boolean; events_upserted: number }>(`/calendar/google/accounts/${accountId}/sync`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
}
