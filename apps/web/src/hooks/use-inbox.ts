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
    staleTime: 5_000,
    refetchInterval: 8_000,
  });
}

export function useInboxThread(threadId: string | null) {
  return useQuery({
    queryKey: ['inbox-thread', threadId],
    queryFn: async () => mapInboxThread(await apiFetch<InboxThreadWire>(`/inbox/threads/${threadId}`)),
    enabled: Boolean(threadId),
    refetchInterval: 10_000,
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
    staleTime: 3_000,
    refetchInterval: 4_000,
  });
}

function invalidateThread(queryClient: ReturnType<typeof useQueryClient>, threadId: string) {
  void queryClient.invalidateQueries({ queryKey: ['inbox-messages', threadId] });
  void queryClient.invalidateQueries({ queryKey: ['inbox-threads'] });
  void queryClient.invalidateQueries({ queryKey: ['inbox-thread', threadId] });
}

export function useSendInboxMessage(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<InboxMessageWire>(`/inbox/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => invalidateThread(queryClient, threadId),
  });
}

export function useSendInboxMedia(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; caption?: string; voiceNote?: boolean }) => {
      const body = new FormData();
      if (input.caption) body.append('caption', input.caption);
      if (input.voiceNote) body.append('voiceNote', 'true');
      body.append('file', input.file);
      return apiFetch<InboxMessageWire>(`/inbox/threads/${threadId}/messages/media`, { method: 'POST', body }, { timeoutMs: 120_000 });
    },
    onSuccess: () => invalidateThread(queryClient, threadId),
  });
}

export function useMarkInboxRead(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/inbox/threads/${threadId}/read`, { method: 'POST' }),
    onSuccess: () => invalidateThread(queryClient, threadId),
  });
}

export function useUpdateInboxStatus(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: 'open' | 'waiting_client' | 'waiting_agency' | 'archived') =>
      apiFetch(`/inbox/threads/${threadId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => invalidateThread(queryClient, threadId),
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
    onSuccess: () => invalidateThread(queryClient, threadId),
  });
}
