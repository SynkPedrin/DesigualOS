import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import type { ClientMetaAccountWire, ClientMetaCreativesWire, ClientMetaSummaryWire } from '@/lib/api/contracts';

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

/**
 * Os criativos deste cliente. `enabled` espelha o do summary: sem conta
 * vinculada não há o que perguntar, e disparar a consulta geraria um
 * "connected: false" inútil a cada visita.
 *
 * `staleTime` alto de propósito — criativo não troca de minuto em minuto, e
 * cada consulta é uma ida à Graph API com rate limit real.
 */
export function useClientMetaCreatives(clientId: string, hasAccount: boolean) {
  return useQuery({
    queryKey: ['clients', clientId, 'meta', 'creatives'],
    queryFn: () => apiFetch<ClientMetaCreativesWire>(`/clients/${clientId}/media/meta/creatives`),
    enabled: hasAccount,
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status === 403) && failureCount < 1,
  });
}
