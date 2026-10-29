import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapInboxMessage,
  mapInboxThread,
  type InboxMessage,
  type InboxMessageWire,
  type InboxThread,
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
    // Rede de segurança: o normal é o WebSocket (inbox.message / inbox.updated) atualizar na hora.
    refetchInterval: 20_000,
  });
}

export function useInboxThread(threadId: string | null) {
  return useQuery({
    queryKey: ['inbox-thread', threadId],
    queryFn: async () => mapInboxThread(await apiFetch<InboxThreadWire>(`/inbox/threads/${threadId}`)),
    enabled: Boolean(threadId),
    refetchInterval: 30_000,
  });
}

/**
 * Busca no servidor sem perder o que chegou ao vivo: a mensagem empurrada pelo
 * WebSocket (`inbox.message`, ver applyLiveInboxMessage) existe na tela antes
 * de existir no banco. Se o refetch chegar nesse meio-tempo, ela fica até o
 * servidor devolvê-la (mesmo externalMessageId) — sem piscar.
 */
async function fetchMessages(queryClient: ReturnType<typeof useQueryClient>, threadId: string): Promise<InboxMessage[]> {
  const wire = await apiFetch<{ messages: InboxMessageWire[] }>(`/inbox/threads/${threadId}/messages`);
  const server = wire.messages.map(mapInboxMessage);
  const known = new Set(server.map((m) => m.externalMessageId).filter(Boolean));
  const previous = queryClient.getQueryData<InboxMessage[]>(['inbox-messages', threadId]) ?? [];
  const now = Date.now();
  const pendingLocal = previous.filter((m) =>
    (m.id.startsWith('wa-') && !known.has(m.externalMessageId) && now - new Date(m.createdAt).getTime() < 60_000) ||
    (m.id.startsWith('local-') && m.deliveryStatus === 'pending' && !server.some((s) => s.direction === 'outbound' && s.content === m.content && s.attachmentFilename === m.attachmentFilename)),
  );
  return pendingLocal.length ? [...server, ...pendingLocal].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : server;
}

/** Abre a conversa a partir do que já está em memória (ver usePrefetchInboxMessages). */
export function prefetchInboxMessages(queryClient: ReturnType<typeof useQueryClient>, threadId: string) {
  return queryClient.prefetchQuery({ queryKey: ['inbox-messages', threadId], queryFn: () => fetchMessages(queryClient, threadId), staleTime: 30_000 });
}

export interface LiveInboxMessage {
  chat_id: string;
  external_id: string;
  direction: 'inbound' | 'outbound';
  content: string | null;
  type: string;
  has_media: boolean;
  sender_name: string | null;
  created_at: string;
}

const PREVIEW_LABELS: Record<string, string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', ptt: 'Áudio', voice: 'Áudio', document: 'Documento', sticker: 'Figurinha' };

/**
 * Mensagem do WhatsApp na tela no instante em que o webhook chega (antes de o
 * servidor gravar): sobe a conversa na lista e entra na conversa aberta. O
 * dado definitivo vem logo depois pelo `inbox.updated`.
 */
export function applyLiveInboxMessage(queryClient: ReturnType<typeof useQueryClient>, live: LiveInboxMessage): boolean {
  let threadId: string | null = null;
  const preview = live.content ?? PREVIEW_LABELS[live.type] ?? 'Mensagem';
  for (const [key, threads] of queryClient.getQueriesData<InboxThread[]>({ queryKey: ['inbox-threads'] })) {
    if (!threads) continue;
    const found = threads.find((t) => t.externalChatId === live.chat_id);
    if (!found) continue;
    threadId = found.id;
    const updated: InboxThread = {
      ...found,
      lastMessageAt: live.created_at,
      lastMessagePreview: preview,
      unreadCount: live.direction === 'inbound' ? found.unreadCount + 1 : found.unreadCount,
    };
    const rest = threads.filter((t) => t.id !== found.id);
    const pinned = rest.filter((t) => t.whatsappPinned);
    const others = rest.filter((t) => !t.whatsappPinned);
    queryClient.setQueryData(key, updated.whatsappPinned ? [updated, ...pinned, ...others] : [...pinned, updated, ...others]);
  }
  if (!threadId) return false;
  queryClient.setQueryData<InboxMessage[]>(['inbox-messages', threadId], (old) => {
    if (!old) return old;
    if (old.some((m) => m.externalMessageId === live.external_id)) return old;
    // Eco do que esta própria tela acabou de enviar: a bolha local já está lá.
    if (live.direction === 'outbound' && old.some((m) => m.id.startsWith('local-') && m.content === live.content)) return old;
    const message: InboxMessage = {
      id: `wa-${live.external_id}`, direction: live.direction, senderContactId: null, senderUserId: null,
      senderName: live.sender_name, content: live.content ?? (live.has_media ? null : preview),
      attachmentUrl: null, attachmentType: null, attachmentFilename: null, attachmentSizeBytes: null,
      externalMessageId: live.external_id, deliveryStatus: live.direction === 'outbound' ? 'sent' : 'delivered', createdAt: live.created_at,
    };
    return [...old, message];
  });
  return true;
}

export function useInboxMessages(threadId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['inbox-messages', threadId],
    queryFn: () => fetchMessages(queryClient, threadId!),
    enabled: Boolean(threadId),
    staleTime: 3_000,
    // Idem: mensagem nova chega pelo WebSocket; isto só cobre conexão caída.
    refetchInterval: 12_000,
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

/** Quem dá para marcar com @ na conversa (participantes do grupo). Só busca quando a conversa é grupo. */
export function useInboxMentionables(threadId: string | null, ehGrupo: boolean) {
  return useQuery({
    queryKey: ['inbox', 'mentionables', threadId],
    enabled: Boolean(threadId) && ehGrupo,
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<{ people: Array<{ id: string; token: string; nome: string }> }>(`/inbox/threads/${threadId}/mentionables`).then((r) => r.people),
  });
}

export function useSendInboxMessage(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Texto puro ou com marcações (@) — `mentions` são os ids do WhatsApp de quem foi marcado.
    mutationFn: (input: string | { text: string; mentions?: string[] }) => {
      const corpo = typeof input === 'string' ? { text: input } : { text: input.text, ...(input.mentions?.length ? { mentions: input.mentions } : {}) };
      return apiFetch<InboxMessageWire>(`/inbox/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify(corpo),
      });
    },
    onMutate: (input) => ({ localId: optimistic(queryClient, threadId, { content: typeof input === 'string' ? input : input.text }) }),
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

/** Vincula a conversa (e o contato) a um cliente; null desvincula. */
export function useLinkInboxThreadClient(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string | null) =>
      apiFetch<InboxThreadWire>(`/inbox/threads/${threadId}/client`, { method: 'PATCH', body: JSON.stringify({ clientId }) }),
    onSuccess: (wire) => {
      const anterior = queryClient.getQueryData<InboxThread>(['inbox-thread', threadId])?.clientId;
      queryClient.setQueryData(['inbox-thread', threadId], mapInboxThread(wire));
      invalidateThread(queryClient, threadId);
      // A visão geral do cliente novo (e do antigo, se trocou) mostra as conversas do WhatsApp.
      for (const id of new Set([wire.client_id, anterior].filter(Boolean))) {
        void queryClient.invalidateQueries({ queryKey: ['clients', id, 'overview'] });
      }
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
    onSuccess: () => invalidateThread(queryClient, threadId),
  });
}
