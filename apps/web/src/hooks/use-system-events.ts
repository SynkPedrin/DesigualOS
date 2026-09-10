import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapSystemEvents, type SystemEventWire } from '@/lib/api/contracts';

/** Master-only no backend como /health/infrastructure: callers passam
 * `enabled: isMaster` em vez de deixar o 403 estourar na tela. */
export function useSystemEvents(enabled = true) {
  return useQuery({
    queryKey: ['health', 'events'],
    queryFn: async () => mapSystemEvents(await apiFetch<{ events: SystemEventWire[] }>('/health/events')),
    enabled,
    refetchInterval: 15_000,
  });
}
