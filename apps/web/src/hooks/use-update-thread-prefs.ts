import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { MessageThreadPrefsWire, UpdateMessageThreadPrefsRequestWire } from '@/lib/api/contracts';

/**
 * PATCH /messages/threads/:partnerId - favorito/arquivado são preferências por
 * usuário (direct_message_thread_prefs), upsertadas; só os campos enviados mudam.
 * A invalidação das threads atualiza badge, agrupamento e filtros na hora.
 */
export function useUpdateThreadPrefs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ partnerId, ...body }: UpdateMessageThreadPrefsRequestWire & { partnerId: string }) =>
      apiFetch<MessageThreadPrefsWire>(`/messages/threads/${partnerId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'threads'] });
    },
  });
}
