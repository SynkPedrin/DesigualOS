import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { MetaAdAccountWire, MetaBusinessWire, MetaIntegrationStatusWire } from '@/lib/api/contracts';

/** Conexão Meta POR COLABORADOR — mesmo desenho do useClickUpIntegration. */
export function useMetaIntegration() {
  return useQuery({
    queryKey: ['integrations', 'meta'],
    queryFn: () => apiFetch<MetaIntegrationStatusWire>('/integrations/meta/status'),
  });
}

/** Pede a URL de autorização ao backend e manda o browser pro Facebook — o client_id/secret nunca saem do servidor. */
export function useConnectMeta() {
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>('/integrations/meta/authorize');
      window.location.href = authorize_url;
    },
  });
}

export function useDisconnectMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ connected: boolean }>('/integrations/meta', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'meta'] }),
  });
}

/** Business Managers que a conexão Meta deste colaborador enxerga — passo 1 do seletor em Cliente → Mídia. */
export function useMetaBusinesses(enabled: boolean) {
  return useQuery({
    queryKey: ['integrations', 'meta', 'businesses'],
    queryFn: () => apiFetch<{ businesses: MetaBusinessWire[] }>('/integrations/meta/businesses'),
    enabled,
  });
}

/** Ad Accounts de uma BM (ou de todas, sem businessId) — passo 2 do seletor. */
export function useMetaAdAccounts(businessId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['integrations', 'meta', 'ad-accounts', businessId],
    queryFn: () => {
      const search = businessId ? `?business_id=${encodeURIComponent(businessId)}` : '';
      return apiFetch<{ ad_accounts: MetaAdAccountWire[] }>(`/integrations/meta/ad-accounts${search}`);
    },
    enabled,
  });
}
