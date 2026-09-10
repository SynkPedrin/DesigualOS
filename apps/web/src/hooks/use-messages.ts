import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapMessage,
  mapMessageThread,
  type MessageThreadsResponseWire,
  type MessageWire,
} from '@/lib/api/contracts';

/** Threads + total_unread (badge real do header). A resposta mudou de `{threads}`
 * pra `{threads, total_unread}` quando favorito/arquivado entraram no backend. */
export function useMessageThreads() {
  return useQuery({
    queryKey: ['messages', 'threads'],
    queryFn: async () => {
      const wire = await apiFetch<MessageThreadsResponseWire>('/messages/threads');
      return { threads: wire.threads.map(mapMessageThread), totalUnread: wire.total_unread };
    },
    refetchInterval: 10_000,
  });
}

/** Opening a thread marks the partner's messages as read on the backend - call only when the
 * user actually views it, not for a preview. */
export function useMessageThread(userId: string | null) {
  return useQuery({
    queryKey: ['messages', 'thread', userId],
    queryFn: async () => {
      const wire = await apiFetch<{ messages: MessageWire[] }>(`/messages/${userId}`);
      return wire.messages.map(mapMessage);
    },
    enabled: Boolean(userId),
    refetchInterval: 5_000,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { recipientId: string; content: string; file?: File | null }) => {
      if (input.file) {
        const formData = new FormData();
        // Per the backend: recipient_id and content must be appended before the file field -
        // @fastify/multipart only sees fields that precede the file part.
        formData.append('recipient_id', input.recipientId);
        formData.append('content', input.content);
        formData.append('file', input.file);
        return mapMessage(await apiFetch<MessageWire>('/messages', { method: 'POST', body: formData }));
      }
      return mapMessage(
        await apiFetch<MessageWire>('/messages', {
          method: 'POST',
          body: JSON.stringify({ recipient_id: input.recipientId, content: input.content }),
        }),
      );
    },
    onSuccess: (_message, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'thread', variables.recipientId] });
      queryClient.invalidateQueries({ queryKey: ['messages', 'threads'] });
    },
  });
}
