import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapAutomation,
  mapAutomationMetrics,
  mapAutomationRun,
  type Automation,
  type AutomationMetricsWire,
  type AutomationRunWire,
  type AutomationWire,
  type CreateAutomationRequestWire,
  type RunAutomationNowResponseWire,
  type UpdateAutomationRequestWire,
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

export function useAutomationMetrics() {
  return useQuery({
    queryKey: ['automations', 'metrics'],
    queryFn: async () => {
      const wire = await apiFetch<AutomationMetricsWire>('/automations/metrics');
      return mapAutomationMetrics(wire);
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

export function useUpdateAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string } & UpdateAutomationRequestWire) => {
      const { id, ...body } = input;
      return apiFetch<AutomationWire>(`/automations/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<RunAutomationNowResponseWire>(`/automations/${id}/run`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'metrics'] });
    },
  });
}

export function useDuplicateAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (automation: Automation) => {
      const body: CreateAutomationRequestWire = {
        name: `${automation.name} (cópia)`,
        agent: automation.agent,
        prompt: automation.prompt,
        client_id: automation.clientId,
        schedule: automation.schedule,
        schedule_label: automation.scheduleLabel,
        estimated_minutes_saved: automation.estimatedMinutesSaved,
      };
      return apiFetch<AutomationWire>('/automations', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
}

/** Erro do toggle otimista: a UI usa `error.message` no rollback para avisar que o
 * estado visual voltou ao valor real do servidor. */
export class ToggleAutomationError extends Error {
  constructor(cause: unknown) {
    super('Não foi possível alterar a automação. O estado foi restaurado.');
    this.name = 'ToggleAutomationError';
    this.cause = cause;
  }
}

export function useToggleAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      try {
        return await apiFetch<AutomationWire>(`/automations/${input.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: input.enabled }),
        });
      } catch (error) {
        throw new ToggleAutomationError(error);
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['automations'] });
      const previous = queryClient.getQueryData<Automation[]>(['automations']);
      queryClient.setQueryData<Automation[]>(['automations'], (current) =>
        current?.map((automation) =>
          automation.id === input.id ? { ...automation, enabled: input.enabled } : automation,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['automations'], context.previous);
      }
    },
    onSettled: () => {
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
