import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapToolCall, type ApproveToolCallResponseWire, type ToolCallWire } from '@/lib/api/contracts';

/** `tool_calls:read` is master-only (same shape as `nodes:read`/`costs:read`): pass
 * `enabled: isMaster` from useIsMaster() so colaboradores hitting /approvals directly
 * don't fire a request that just 403s, same pattern as useInfrastructureHealth. */
export function useToolCalls(enabled = true) {
  return useQuery({
    queryKey: ['tool-calls'],
    queryFn: async () => {
      const wire = await apiFetch<{ tool_calls: ToolCallWire[] }>('/tool-calls');
      return wire.tool_calls.map(mapToolCall);
    },
    enabled,
  });
}

export function useApproveToolCall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch<ApproveToolCallResponseWire>(`/tool-calls/${id}/approve`, { method: 'POST' }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-calls'] });
    },
  });
}
