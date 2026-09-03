import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapAutomation,
  mapAutomationRun,
  type AutomationRunWire,
  type AutomationWire,
  type CreateAutomationRequestWire,
} from '@/lib/api/contracts';

export function useAutomations() {
  return useQuery({
    queryKey: ['automations'],
    queryFn: async () => {
      const wire = await apiFetch<{ automations: AutomationWire[] }>('/automations');
      return wire.automations.map(mapAutomation);
    },
  });
}

export function useAutomationRuns(automationId: string | null) {
  return useQuery({
    queryKey: ['automations', automationId, 'runs'],
    queryFn: async () => {
      const wire = await apiFetch<{ runs: AutomationRunWire[] }>(`/automations/${automationId}/runs`);
      return wire.runs.map(mapAutomationRun);
    },
    enabled: Boolean(automationId),
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAutomationRequestWire) =>
      apiFetch<AutomationWire>('/automations', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}

export function useToggleAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      apiFetch<AutomationWire>(`/automations/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: input.enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}
