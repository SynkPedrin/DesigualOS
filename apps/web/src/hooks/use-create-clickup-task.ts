import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

export interface NovaTarefaClickUp {
  listId: string;
  name: string;
  description?: string;
  /** Escala do ClickUp: 1 urgente, 2 alta, 3 normal, 4 baixa. */
  priority?: 1 | 2 | 3 | 4;
  /** Epoch em ms. */
  dueDate?: number;
}

/**
 * Cria a tarefa NO CLICKUP do cliente (POST /clickup/tasks). A tarefa nasce atribuída a quem criou e a rota só
 * aceita lista de cliente a que a pessoa tem acesso. Depois de criada, as listas de Tarefas e do Hoje se refazem.
 */
export function useCreateClickUpTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: NovaTarefaClickUp) =>
      apiFetch<{ id: string; url: string; assigned: boolean }>('/clickup/tasks', {
        method: 'POST',
        body: JSON.stringify({
          list_id: t.listId,
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          ...(t.priority ? { priority: t.priority } : {}),
          ...(t.dueDate ? { due_date: t.dueDate } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clickup', 'tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['today-summary'] });
    },
  });
}
