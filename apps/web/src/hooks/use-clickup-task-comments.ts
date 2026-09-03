import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ClickUpCommentWire } from '@/lib/api/contracts';

/**
 * Comentários de uma tarefa do ClickUp, lidos na hora (o "chat" da tarefa).
 * Usado na aba Conversas do workspace do cliente.
 */
export function useClickUpTaskComments(taskId: string | null) {
  return useQuery({
    queryKey: ['clickup', 'tasks', taskId, 'comments'],
    queryFn: async () => {
      const wire = await apiFetch<{ comments: ClickUpCommentWire[] }>(`/clickup/tasks/${taskId}/comments`);
      return wire.comments;
    },
    enabled: Boolean(taskId),
    retry: (failureCount) => failureCount < 1,
  });
}
