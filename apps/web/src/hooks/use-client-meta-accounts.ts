import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ClientMetaAccountWire, ClientMetaSummaryWire } from '@/lib/api/contracts';

/** Contas Meta vinculadas a ESTE cliente — nunca a de outro (ver apps/api/src/clients/routes.ts). */
export function useClientMetaAccounts(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'meta-accounts'],
    queryFn: async () => {
      const wire = await apiFetch<{ accounts: ClientMetaAccountWire[] }>(`/clients/${clientId}/meta-accounts`);
      return wire.accounts;
    },
    enabled: Boolean(clientId),
  });
}

export function useLinkClientMetaAccount(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { account_id: string; business_id?: string | undefined; label?: string | undefined; is_primary?: boolean | undefined }) =>
      apiFetch<ClientMetaAccountWire>(`/clients/${clientId}/meta-accounts`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'meta-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'meta-summary'] });
    },
  });
}

export function useUnlinkClientMetaAccount(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => apiFetch(`/clients/${clientId}/meta-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'meta-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'meta-summary'] });
    },
  });
}

/** `connected: false` é estado normal (cliente sem mídia ainda) — a tela nunca trata isso como erro. */
export function useClientMetaSummary(clientId: string | null, hasAccount: boolean) {
  return useQuery({
    queryKey: ['clients', clientId, 'meta-summary'],
    queryFn: () => apiFetch<ClientMetaSummaryWire>(`/clients/${clientId}/media/meta/summary`),
    enabled: Boolean(clientId) && hasAccount,
  });
}
