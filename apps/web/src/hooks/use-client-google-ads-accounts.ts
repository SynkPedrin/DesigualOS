import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ClientGoogleAdsAccountWire, ClientGoogleAdsSummaryWire } from '@/lib/api/contracts';

/** Customer IDs vinculados a ESTE cliente — nunca o de outro (ver apps/api/src/clients/routes.ts). */
export function useClientGoogleAdsAccounts(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'google-ads-accounts'],
    queryFn: async () => {
      const wire = await apiFetch<{ accounts: ClientGoogleAdsAccountWire[] }>(`/clients/${clientId}/google-ads-accounts`);
      return wire.accounts;
    },
    enabled: Boolean(clientId),
  });
}

export function useLinkClientGoogleAdsAccount(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { customer_id: string; login_customer_id?: string | undefined; label?: string | undefined; is_primary?: boolean | undefined }) =>
      apiFetch<ClientGoogleAdsAccountWire>(`/clients/${clientId}/google-ads-accounts`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'google-ads-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'google-ads-summary'] });
    },
  });
}

export function useUnlinkClientGoogleAdsAccount(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) => apiFetch(`/clients/${clientId}/google-ads-accounts/${encodeURIComponent(customerId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'google-ads-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'google-ads-summary'] });
    },
  });
}

/** `connected: false` é estado normal (cliente sem Google Ads ainda) — a tela nunca trata isso como erro. */
export function useClientGoogleAdsSummary(clientId: string | null, hasAccount: boolean) {
  return useQuery({
    queryKey: ['clients', clientId, 'google-ads-summary'],
    queryFn: () => apiFetch<ClientGoogleAdsSummaryWire>(`/clients/${clientId}/media/google-ads/summary`),
    enabled: Boolean(clientId) && hasAccount,
  });
}
