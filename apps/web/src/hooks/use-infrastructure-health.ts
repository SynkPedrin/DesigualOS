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
    // staleTime > 0 porque sidebar + agent-spotlight montam a mesma query em
    // sequência: sem isto, cada mount refetchava (medido: 2x GET
    // /health/infrastructure por carga de página). O poll de 15s segue
    // garantindo frescor.
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
