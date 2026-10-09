import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { AgencyControlCenterWire } from '@/lib/api/contracts';

/** Mesmo refetch de usePanorama (60s) — painel de supervisão, não precisa de tempo real. */
export function useAgencyControlCenter() {
  return useQuery({
    queryKey: ['agency-control-center'],
    queryFn: () => apiFetch<AgencyControlCenterWire>('/agency-control-center'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
