import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapInboxMessage,
  mapInboxThread,
  type InboxMessageWire,
  type InboxThreadStatus,
  type InboxThreadWire,
} from '@/lib/api/contracts';

export interface InboxThreadFilter {
  status?: InboxThreadStatus;
  assigned?: 'me' | 'unassigned';
  /** Teto da página. A rota usa 30 por padrão e aceita até 100; mandar daqui
   *  faz a tela CONHECER o próprio teto, que é o que permite dizer "30+" em
   *  vez de estampar 30 como se fosse o total (ver lib/teto-de-pagina.ts). */
  limit?: number;
}

function queryString(filter: InboxThreadFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.assigned) params.set('assigned', filter.assigned);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useInboxThreads(filter: InboxThreadFilter = {}) {
  return useQuery({
    queryKey: ['inbox-threads', filter],
    queryFn: async () => {
      const wire = await apiFetch<{ threads: InboxThreadWire[] }>(`/inbox/threads${queryString(filter)}`);
      return wire.threads.map(mapInboxThread);
    },
    staleTime: 15_000,
  });
}

export function useInboxThread(threadId: string | null) {
  return useQuery({
    queryKey: ['inbox-thread', threadId],
    queryFn: async () => mapInboxThread(await apiFetch<InboxThreadWire>(`/inbox/threads/${threadId}`)),
    enabled: Boolean(threadId),
  });
}

export function useInboxMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['inbox-messages', threadId],
    queryFn: async () => {
      const wire = await apiFetch<{ messages: InboxMessageWire[] }>(`/inbox/threads/${threadId}/messages`);
      return wire.messages.map(mapInboxMessage);
    },
    enabled: Boolean(threadId),
    staleTime: 5_000,
  });
}

export function useSendInboxMessage(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<InboxMessageWire>(`/inbox/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-messages', threadId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
    },
  });
}

export function useAssignInboxThread(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string | null) =>
      apiFetch<{ id: string; assigned_to_user_id: string | null }>(`/inbox/threads/${threadId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-thread', threadId] });
    },
  });
}
