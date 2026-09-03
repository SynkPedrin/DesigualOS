import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ClickUpIntegrationStatusWire, ClickUpSyncResultWire } from '@/lib/api/contracts';

export function useClickUpIntegration() {
  return useQuery({
    queryKey: ['integrations', 'clickup'],
    queryFn: () => apiFetch<ClickUpIntegrationStatusWire>('/integrations/clickup/status'),
  });
}

/**
 * Pede a URL de autorização ao backend e manda o browser pra lá. O frontend
 * nunca monta essa URL sozinho: o client_id (e o redirect_uri registrado no
 * app do ClickUp) ficam do lado do servidor, junto com o secret.
 */
export function useConnectClickUp() {
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>('/integrations/clickup/authorize');
      window.location.href = authorize_url;
    },
  });
}

export function useDisconnectClickUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ connected: boolean }>('/integrations/clickup', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'clickup'] }),
  });
}

/** Importa os Spaces do ClickUp como clientes (ClickUp segue sendo a fonte de verdade). */
export function useSyncClickUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<ClickUpSyncResultWire>('/integrations/clickup/sync', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'clickup'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}
