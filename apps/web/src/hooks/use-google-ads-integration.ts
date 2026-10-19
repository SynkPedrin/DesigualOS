import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { GoogleAdsAccountWire, GoogleAdsIntegrationStatusWire } from '@/lib/api/contracts';

/** Conexão Google Ads POR COLABORADOR — mesmo desenho do useMetaIntegration. */
export function useGoogleAdsIntegration() {
  return useQuery({
    queryKey: ['integrations', 'google-ads'],
    queryFn: () => apiFetch<GoogleAdsIntegrationStatusWire>('/integrations/google-ads/status'),
  });
}

export function useConnectGoogleAds() {
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>('/integrations/google-ads/authorize');
      window.location.href = authorize_url;
    },
  });
}

export function useDisconnectGoogleAds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ connected: boolean }>('/integrations/google-ads', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'google-ads'] }),
  });
}

/** Contas acessíveis pela conexão — sem loginCustomerId: contas diretas; com: sub-contas daquele MCC. */
export function useGoogleAdsAccounts(loginCustomerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['integrations', 'google-ads', 'accounts', loginCustomerId],
    queryFn: () => {
      const search = loginCustomerId ? `?login_customer_id=${encodeURIComponent(loginCustomerId)}` : '';
      return apiFetch<{ accounts: GoogleAdsAccountWire[] }>(`/integrations/google-ads/accounts${search}`);
    },
    enabled,
  });
}
