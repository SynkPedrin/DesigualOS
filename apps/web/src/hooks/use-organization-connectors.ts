import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { OrganizationConnectorWire, WhatsappHealthWire } from '@/lib/api/contracts';

/** Conectores da empresa (ClickUp/WhatsApp) — §Integrações, 07/10/2026. */
export function useOrganizationConnectors(organizationId: string | null) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'connectors'],
    queryFn: () => apiFetch<{ connectors: OrganizationConnectorWire[] }>(`/organizations/${organizationId}/connectors`),
    enabled: Boolean(organizationId),
  });
}

/** Estado de conexão do WhatsApp — funciona pra qualquer vendor já vinculado (ver GET .../whatsapp/health no backend). */
export function useWhatsappHealth(organizationId: string | null, options: { pollWhileConnecting?: boolean } = {}) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'connectors', 'whatsapp', 'health'],
    queryFn: () => apiFetch<WhatsappHealthWire>(`/organizations/${organizationId}/connectors/whatsapp/health`),
    enabled: Boolean(organizationId),
    refetchInterval: options.pollWhileConnecting ? 4000 : false,
  });
}

export function useSaveOrganizationConnector(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: string; credentials: Record<string, string> }) =>
      apiFetch<OrganizationConnectorWire>(`/organizations/${organizationId}/connectors/${input.provider}`, {
        method: 'PUT',
        body: JSON.stringify({ credentials: input.credentials }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'connectors'] });
    },
  });
}

export function useRemoveOrganizationConnector(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => apiFetch(`/organizations/${organizationId}/connectors/${provider}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'connectors'] });
    },
  });
}
