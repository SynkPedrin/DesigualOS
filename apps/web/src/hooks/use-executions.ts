import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapExecutionDetail,
  mapExecutionList,
  type ExecutionDetailWire,
  type ExecutionListItemWire,
} from '@/lib/api/contracts';

export function useExecutions(clientId?: string | null) {
  return useQuery({
    queryKey: ['executions', { clientId: clientId ?? null }],
    queryFn: async () => {
      const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
      return mapExecutionList(await apiFetch<{ executions: ExecutionListItemWire[] }>(`/executions${query}`));
    },
    refetchInterval: 10_000,
  });
}

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'running']);

export function useExecution(executionId: string | null) {
  return useQuery({
    queryKey: ['executions', executionId],
    queryFn: async () =>
      mapExecutionDetail(await apiFetch<ExecutionDetailWire>(`/executions/${executionId}`)),
    enabled: Boolean(executionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_STATUSES.has(status) ? 700 : false;
    },
  });
}
