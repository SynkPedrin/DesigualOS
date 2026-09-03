import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import {
  mapClientWorkspace,
  type ClientAccessRole,
  type ClientWorkspaceWire,
  type GrantClientAccessRequestWire,
  type GrantClientAccessResponseWire,
} from '@/lib/api/contracts';

export function useClientWorkspace(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'workspace'],
    queryFn: async () => mapClientWorkspace(await apiFetch<ClientWorkspaceWire>(`/clients/${clientId}/workspace`)),
    enabled: Boolean(clientId),
    retry: (failureCount, error) => error instanceof ApiRequestError && error.status === 403 ? false : failureCount < 1,
  });
}

export function useGrantClientAccess(clientId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { email: string; role?: ClientAccessRole | undefined }) => {
      const body: GrantClientAccessRequestWire = { email: input.email, role: input.role };
      return apiFetch<GrantClientAccessResponseWire>(`/clients/${clientId}/access`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'workspace'] });
    },
  });
}
