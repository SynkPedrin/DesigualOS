import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import type {
  ClickUpClientCommentWire,
  CreateClickUpTaskCommentRequestWire,
  CreateClickUpTaskCommentResponseWire,
} from '@/lib/api/contracts';

/**
 * Thread agregada de comentários do ClickUp do cliente inteiro (todas as
 * tarefas), lida na hora. 409 = cliente sem lista vinculada, tratado como
 * estado na tela, não como erro. Refetch moderado pra refletir o que a
 * equipe escreve direto no ClickUp.
 */
export function useClientClickUpComments(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'clickup-comments'],
    queryFn: async () => {
      const wire = await apiFetch<{ comments: ClickUpClientCommentWire[] }>(`/clients/${clientId}/comments`);
      return wire.comments;
    },
    enabled: Boolean(clientId),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: (failureCount, error) => !(error instanceof ApiRequestError && [403, 409].includes(error.status)) && failureCount < 1,
  });
}

/** Posta comentário de verdade na tarefa no ClickUp e invalida a thread
 * agregada: o comentário volta do próprio ClickUp no próximo fetch. */
export function usePostClickUpTaskComment(clientId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { taskId: string; text: string }) => {
      const body: CreateClickUpTaskCommentRequestWire = { comment_text: input.text };
      return apiFetch<CreateClickUpTaskCommentResponseWire>(`/clickup/tasks/${input.taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'clickup-comments'] });
      queryClient.invalidateQueries({ queryKey: ['clients', clientId, 'overview'] });
    },
  });
}
