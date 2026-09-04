import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import type { ClientOverviewWire } from '@/lib/api/contracts';

/**
 * Resumo do cliente (aba Visão Geral do workspace). staleTime baixo e
 * refetch moderado: a tela reflete atualizações feitas no ClickUp sem
 * precisar de webhook nem reload manual.
 */
export function useClientOverview(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'overview'],
    queryFn: () => apiFetch<ClientOverviewWire>(`/clients/${clientId}/overview`),
    enabled: Boolean(clientId),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && [403, 409].includes(error.status)) && failureCount < 1,
  });
}
