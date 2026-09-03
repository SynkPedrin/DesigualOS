import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapCostsByAgent,
  mapCostsByClient,
  mapCostsByUser,
  mapCostsOverview,
  type CostByAgentWire,
  type CostByClientWire,
  type CostByUserWire,
  type CostRange,
  type CostsOverviewWire,
} from '@/lib/api/contracts';

/** `costs:read` is master-only on the backend (confirmed 2026-09-01): colaborador gets 403.
 * Callers should pass `enabled: isMaster` from useIsMaster() rather than let the request fire
 * and surface an error. */
export function useCostsOverview(range: CostRange, enabled = true) {
  return useQuery({
    queryKey: ['costs', 'overview', range],
    queryFn: async () =>
      mapCostsOverview(await apiFetch<CostsOverviewWire>(`/costs/overview?range=${range}`)),
    enabled,
  });
}

export function useCostsByAgent(range: CostRange, enabled = true) {
  return useQuery({
    queryKey: ['costs', 'by-agent', range],
    queryFn: async () =>
      mapCostsByAgent(await apiFetch<{ by_agent: CostByAgentWire[] }>(`/costs/by-agent?range=${range}`)),
    enabled,
  });
}

export function useCostsByClient(range: CostRange, enabled = true) {
  return useQuery({
    queryKey: ['costs', 'by-client', range],
    queryFn: async () =>
      mapCostsByClient(await apiFetch<{ by_client: CostByClientWire[] }>(`/costs/by-client?range=${range}`)),
    enabled,
  });
}

export function useCostsByUser(range: CostRange, enabled = true) {
  return useQuery({
    queryKey: ['costs', 'by-user', range],
    queryFn: async () =>
      mapCostsByUser(await apiFetch<{ by_user: CostByUserWire[] }>(`/costs/by-user?range=${range}`)),
    enabled,
  });
}
