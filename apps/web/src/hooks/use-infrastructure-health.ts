import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapInfrastructureHealth, type InfrastructureHealthWire } from '@/lib/api/contracts';

/** `nodes:read` is master-only on the backend (confirmed by the backend team): colaborador
 * gets 403. Callers should pass `enabled: isMaster` from useIsMaster() rather than let the
 * request fire and surface an error, same pattern as useCostsOverview. */
export function useInfrastructureHealth(enabled = true) {
  return useQuery({
    queryKey: ['health', 'infrastructure'],
    queryFn: async () => {
      const wire = await apiFetch<InfrastructureHealthWire>('/health/infrastructure');
      return mapInfrastructureHealth(wire);
    },
    enabled,
    refetchInterval: 15_000,
  });
}
