import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapInboxMessage,
  mapInboxThread,
  type InboxMessage,
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
  /** 'archived' = arquivadas no WhatsApp; padrão = lista principal, sem elas. */
  view?: 'archived';
  /** Busca no servidor (nome, número, prévia), não só nas conversas carregadas. */
  q?: string;
}

function queryString(filter: InboxThreadFilter): string {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.view) params.set('view', filter.view);
  if (filter.q) params.set('q', filter.q);
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
    // Ao digitar na busca, a lista anterior fica na tela até a nova chegar.
    placeholderData: keepPreviousData,
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

/**
 * Bolha na hora do clique: a mensagem entra no cache como "aguardando envio"
 * antes de o servidor responder, e o status real (enviada / falhou) chega pelo
 * evento `inbox.updated`. Sem isso a pessoa via a mensagem só 5–7 s depois.
 */
function optimistic(queryClient: ReturnType<typeof useQueryClient>, threadId: string, partial: Partial<InboxMessage>): string {
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message: InboxMessage = {
    id, direction: 'outbound', senderContactId: null, senderUserId: null, senderName: null, content: null,
    attachmentUrl: null, attachmentType: null, attachmentFilename: null, attachmentSizeBytes: null,
    externalMessageId: null, deliveryStatus: 'pending', createdAt: new Date().toISOString(), ...partial,
  };
  void queryClient.cancelQueries({ queryKey: ['inbox-messages', threadId] });
  queryClient.setQueryData<InboxMessage[]>(['inbox-messages', threadId], (old) => [...(old ?? []), message]);
  return id;
}

function settleOptimistic(queryClient: ReturnType<typeof useQueryClient>, threadId: string, localId: string, real: InboxMessage | null) {
  queryClient.setQueryData<InboxMessage[]>(['inbox-messages', threadId], (old = []) => {
    if (!real) return old.map((m) => (m.id === localId ? { ...m, deliveryStatus: 'failed' } : m));
    // Um refetch pode já ter trazido a real; então a local só sai.
    if (old.some((m) => m.id === real.id)) return old.filter((m) => m.id !== localId);
    return old.map((m) => (m.id === localId ? real : m));
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
    onMutate: (text) => ({ localId: optimistic(queryClient, threadId, { content: text }) }),
    onSuccess: (wire, _text, context) => { if (context) settleOptimistic(queryClient, threadId, context.localId, mapInboxMessage(wire)); },
    onError: (_error, _text, context) => { if (context) settleOptimistic(queryClient, threadId, context.localId, null); },
    onSettled: () => invalidateThread(queryClient, threadId),
  });
}

export function useSendInboxMedia(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; caption?: string; voiceNote?: boolean; sticker?: boolean }) => {
      const body = new FormData();
      if (input.caption) body.append('caption', input.caption);
      if (input.voiceNote) body.append('voiceNote', 'true');
      if (input.sticker) body.append('sticker', 'true');
      body.append('file', input.file);
      return apiFetch<InboxMessageWire>(`/inbox/threads/${threadId}/messages/media`, { method: 'POST', body }, { timeoutMs: 600_000 });
    },
    onMutate: (input) => ({
      localId: optimistic(queryClient, threadId, {
        content: input.caption ?? null,
        attachmentUrl: URL.createObjectURL(input.file),
        attachmentType: input.file.type || 'application/octet-stream',
        attachmentFilename: input.file.name,
        attachmentSizeBytes: input.file.size,
      }),
    }),
    onSuccess: (wire, _input, context) => { if (context) settleOptimistic(queryClient, threadId, context.localId, mapInboxMessage(wire)); },
    onError: (_error, _input, context) => { if (context) settleOptimistic(queryClient, threadId, context.localId, null); },
    onSettled: () => invalidateThread(queryClient, threadId),
  });
}

export interface InboxSticker { messageId: string; url: string }

/** Figurinhas que passaram pelo WhatsApp de quem está logado (ver listRecentStickers na API). */
export function useInboxStickers(enabled: boolean) {
  return useQuery({
    queryKey: ['inbox-stickers'],
    queryFn: async () => (await apiFetch<{ stickers: Array<{ message_id: string; url: string }> }>('/inbox/stickers')).stickers.map((s): InboxSticker => ({ messageId: s.message_id, url: s.url })),
    enabled,
    staleTime: 60_000,
  });
}

export function useSendInboxSticker(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sticker: InboxSticker) =>
      apiFetch<InboxMessageWire>(`/inbox/threads/${threadId}/messages/sticker`, { method: 'POST', body: JSON.stringify({ messageId: sticker.messageId }) }),
    onMutate: (sticker) => ({
      localId: optimistic(queryClient, threadId, { attachmentUrl: sticker.url, attachmentType: 'image/webp', attachmentFilename: 'figurinha.webp' }),
    }),
    onSuccess: (wire, _s, context) => { if (context) settleOptimistic(queryClient, threadId, context.localId, mapInboxMessage(wire)); },
    onError: (_e, _s, context) => { if (context) settleOptimistic(queryClient, threadId, context.localId, null); },
    onSettled: () => invalidateThread(queryClient, threadId),
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
