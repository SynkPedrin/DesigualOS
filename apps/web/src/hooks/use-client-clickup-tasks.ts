import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/client';
import type { ClickUpTaskWire } from '@/lib/api/contracts';

/**
 * Tarefas do cliente lidas do ClickUp na hora. 409 = o cliente ainda não foi
 * vinculado a uma lista do ClickUp (precisa rodar o sync em Configurações >
 * Integrações), e isso não é erro de sistema - a tela trata como estado.
 */
export function useClientClickUpTasks(clientId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['clients', clientId, 'clickup-tasks'],
    queryFn: async () => {
      const wire = await apiFetch<{ tasks: ClickUpTaskWire[] }>(`/clients/${clientId}/clickup/tasks`);
      return wire.tasks;
    },
    enabled: Boolean(clientId) && enabled,
    // Não insistir quando o cliente simplesmente não está vinculado.
    retry: (failureCount, error) => !(error instanceof ApiRequestError && [403, 409].includes(error.status)) && failureCount < 1,
  });
}
