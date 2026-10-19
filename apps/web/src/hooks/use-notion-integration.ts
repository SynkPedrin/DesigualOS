import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { NotionIntegrationStatusWire } from '@/lib/api/contracts';

/**
 * Mesmo desenho do ClickUp (use-clickup-integration.ts), de propósito: o
 * frontend NUNCA monta a URL de autorização sozinho. O client_id e o
 * redirect_uri registrado no app do Notion vivem no servidor, junto com o
 * secret — se o front montasse a URL, o redirect_uri viraria uma string
 * duplicada em dois lugares, e a primeira vez que alguém mudasse um deles a
 * conexão quebraria sem explicação.
 */
export function useNotionIntegration() {
  return useQuery({
    queryKey: ['integrations', 'notion'],
    queryFn: () => apiFetch<NotionIntegrationStatusWire>('/integrations/notion/status'),
  });
}

export function useConnectNotion() {
  return useMutation({
    mutationFn: async () => {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>('/integrations/notion/authorize');
      window.location.href = authorize_url;
    },
  });
}

export function useDisconnectNotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/integrations/notion', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'notion'] }),
  });
}
