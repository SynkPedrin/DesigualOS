import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ClientAssignmentWire, ClientResponsibility } from '@/lib/api/contracts';

export function useClientAssignments(clientId: string) {
  return useQuery({
    queryKey: ['client-assignments', clientId],
    queryFn: async () => (await apiFetch<{ assignments: ClientAssignmentWire[] }>(`/clients/${clientId}/assignments`)).assignments,
  });
}

export function useSetClientAssignment(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; responsibility: ClientResponsibility }) =>
      apiFetch(`/clients/${clientId}/assignments`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-assignments', clientId] }),
  });
}

export function useRemoveClientAssignment(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; responsibility: ClientResponsibility }) =>
      apiFetch(`/clients/${clientId}/assignments`, { method: 'DELETE', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client-assignments', clientId] }),
  });
}
