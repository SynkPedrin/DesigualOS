import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapClientMemory, type ClientMemoryWire } from '@/lib/api/contracts';

/** GET /clients/:id/memory — dossiê consolidado (histórico, ClickUp, entregas),
 * mostrado na tela de Projeto do chat como "Memória" do cliente vinculado. */
export function useClientMemory(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'memory'],
    queryFn: async () => mapClientMemory(await apiFetch<ClientMemoryWire>(`/clients/${clientId}/memory`)),
    enabled: Boolean(clientId),
    staleTime: 60_000,
  });
}
