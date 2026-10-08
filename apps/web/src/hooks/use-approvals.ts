import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ApprovalRequestWire, ApprovalStatus } from '@/lib/api/contracts';

export function useApprovals(filter: { mine?: boolean; requestedByMe?: boolean; status?: ApprovalStatus } = {}) {
  const params = new URLSearchParams();
  if (filter.mine) params.set('mine', 'true');
  if (filter.requestedByMe) params.set('requestedByMe', 'true');
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();

  return useQuery({
    queryKey: ['approvals', filter],
    queryFn: async () => (await apiFetch<{ approvals: ApprovalRequestWire[] }>(`/approvals${qs ? `?${qs}` : ''}`)).approvals,
    staleTime: 15_000,
  });
}

export function useCreateApprovalRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientId?: string | null; resourceType: ApprovalRequestWire['resource_type']; resourceId: string }) =>
      apiFetch<ApprovalRequestWire>('/approvals', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals'] }),
  });
}

export function useResolveApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: string; status: 'approved' | 'rejected' | 'changes_requested'; comment?: string }) =>
      apiFetch<ApprovalRequestWire>(`/approvals/${id}`, { method: 'PATCH', body: JSON.stringify({ status, comment }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals'] }),
  });
}
