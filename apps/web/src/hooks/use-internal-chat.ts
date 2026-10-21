'use client';

import { useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { ApiRequestError, apiFetch, apiUploadWithProgress } from '@/lib/api/client';

/**
 * Comunicação interna — dados da tela. Tudo sob a chave ['internal-chat', …]:
 * os eventos ao vivo (chat.event) entram direto neste cache
 * (applyInternalChatEvent), e a reconexão do WebSocket invalida tudo para
 * recuperar o que passou enquanto a conexão estava fora.
 */

export interface ChatAttachment {
  id: string;
  message_id: string | null;
  conversation_id?: string;
  filename: string;
  mimetype: string;
  kind: 'image' | 'video' | 'document' | 'archive';
  size_bytes: number;
  width: number | null;
  height: number | null;
  url: string;
  created_at: string;
  sender_name?: string | null;
  thread_root_id?: string | null;
  conversation?: { kind: string; title: string } | null;
}

export type ChatObjectType = 'task' | 'client' | 'demand' | 'media_account' | 'campaign' | 'adset' | 'ad' | 'report' | 'media_alert';

export interface ChatObject {
  id: string;
  type: ChatObjectType;
  object_id: string | null;
  provider: string | null;
  context: Record<string, unknown>;
  /** Resumo do momento do compartilhamento; null = não mostrado a este leitor (ou evento ao vivo). */
  snapshot: Record<string, unknown> | null;
  /** O leitor não tem acesso ao item. */
  restricted: boolean;
  shared_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar_url: string | null;
  kind?: 'user' | 'system';
  content: string | null;
  client_message_id: string;
  reply_to: { id: string; sender_name: string | null; content: string | null; deleted: boolean } | null;
  thread_root_id?: string | null;
  reply_count?: number;
  last_reply_at?: string | null;
  thread_participants?: Array<{ id: string; name: string | null; avatar_url: string | null }>;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  pinned?: boolean;
  saved?: boolean | undefined;
  attachments: ChatAttachment[];
  reactions: Array<{ emoji: string; user_ids: string[] }>;
  objects?: ChatObject[];
  /** Em resultados de busca, menções e salvos. */
  conversation?: { kind: string; title: string } | null;
  /** Só na tela: ainda subindo ('sending') ou falhou ('failed'). */
  local_status?: 'sending' | 'failed';
}

export type ChatConversationKind = 'general' | 'direct' | 'channel' | 'group' | 'discussion';

export interface ChatConversation {
  id: string;
  kind: ChatConversationKind;
  title: string;
  description?: string | null;
  visibility?: string | null;
  entity?: { type: string; id: string | null } | null;
  role?: string;
  member_count?: number;
  partner: { id: string; name: string | null; avatar_url: string | null; online: boolean } | null;
  last_message: { content: string | null; deleted: boolean; has_attachment: boolean; sender_id: string | null; sender_name?: string | null; kind?: string | null; created_at: string } | null;
  unread_count: number;
  mentions_unread?: number;
  muted: boolean;
}

export type ChatPresence = 'online' | 'away' | 'offline';
export interface ChatMember { id: string; name: string; avatar_url: string | null; is_me: boolean; online: boolean; presence?: ChatPresence }

export interface ChatConversationDetail {
  id: string;
  kind: ChatConversationKind;
  title: string | null;
  description: string | null;
  visibility: string | null;
  archived: boolean;
  entity: { type: string; id: string | null } | null;
  my_role: string | null;
  is_member: boolean;
  can_manage: boolean;
  members: Array<{ id: string; name: string; avatar_url: string | null; role: string; last_read_at: string | null; presence: ChatPresence }>;
  pinned_count: number;
}

interface Page { messages: ChatMessage[]; has_more: boolean }
interface ThreadPage { root: ChatMessage; replies: ChatMessage[]; has_more: boolean }

/** "Não encontrada" (404) e "sem permissão" (403) não mudam com insistência: mostra o aviso na hora. */
const naoInsistirEm4xx = (tentativas: number, erro: unknown) =>
  !(erro instanceof ApiRequestError && erro.status >= 400 && erro.status < 500) && tentativas < 2;

export const chatKeys = {
  all: ['internal-chat'] as const,
  conversations: ['internal-chat', 'conversations'] as const,
  unread: ['internal-chat', 'unread'] as const,
  members: ['internal-chat', 'members'] as const,
  detail: (id: string) => ['internal-chat', 'detail', id] as const,
  messages: (id: string) => ['internal-chat', 'messages', id] as const,
  thread: (rootId: string) => ['internal-chat', 'thread', rootId] as const,
  pins: (id: string) => ['internal-chat', 'pins', id] as const,
  files: (id: string, kind: string, q: string) => ['internal-chat', 'files', id, kind, q] as const,
  library: (f: Record<string, string>) => ['internal-chat', 'library', f] as const,
  search: (f: Record<string, string>) => ['internal-chat', 'search', f] as const,
  mentions: ['internal-chat', 'mentions'] as const,
  saved: ['internal-chat', 'saved'] as const,
  browse: ['internal-chat', 'browse'] as const,
  preferences: ['internal-chat', 'preferences'] as const,
  object: (id: string) => ['internal-chat', 'object', id] as const,
};
const keys = chatKeys;

export function useChatConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: async () => (await apiFetch<{ conversations: ChatConversation[] }>('/internal-chat/conversations')).conversations,
    // Rede de segurança: o normal é o WebSocket atualizar na hora.
    refetchInterval: 60_000,
  });
}

/** Contador do item "Comunicação" na barra lateral. */
export function useChatUnread(enabled: boolean) {
  return useQuery({
    queryKey: keys.unread,
    queryFn: async () => (await apiFetch<{ unread: number }>('/internal-chat/unread')).unread,
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useChatMembers(enabled = true) {
  return useQuery({
    queryKey: keys.members,
    queryFn: async () => (await apiFetch<{ members: ChatMember[] }>('/internal-chat/members')).members,
    enabled,
    staleTime: 30_000,
  });
}

export function useConversationDetail(conversationId: string | null) {
  return useQuery({
    queryKey: keys.detail(conversationId ?? 'none'),
    enabled: Boolean(conversationId),
    queryFn: () => apiFetch<ChatConversationDetail>(`/internal-chat/conversations/${conversationId}`),
    retry: naoInsistirEm4xx,
    staleTime: 30_000,
  });
}

export function useChatMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: keys.messages(conversationId ?? 'none'),
    enabled: Boolean(conversationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<Page>(`/internal-chat/conversations/${conversationId}/messages?limit=40${pageParam ? `&before=${pageParam}` : ''}`),
    retry: naoInsistirEm4xx,
    // Páginas vêm da mais nova para a mais velha; "próxima" = mais antiga.
    getNextPageParam: (ultima) => (ultima.has_more && ultima.messages[0] ? ultima.messages[0].id : null),
    staleTime: 30_000,
  });
}

export function useThread(conversationId: string | null, rootId: string | null) {
  return useInfiniteQuery({
    queryKey: keys.thread(rootId ?? 'none'),
    enabled: Boolean(conversationId && rootId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const r = await apiFetch<ThreadPage>(`/internal-chat/conversations/${conversationId}/threads/${rootId}?limit=50${pageParam ? `&before=${pageParam}` : ''}`);
      return { messages: r.replies, has_more: r.has_more, root: r.root };
    },
    getNextPageParam: (ultima) => (ultima.has_more && ultima.messages[0] ? ultima.messages[0].id : null),
    staleTime: 30_000,
  });
}

/** Mensagens em ordem cronológica, de todas as páginas carregadas. */
export function flattenMessages(data: InfiniteData<Page> | undefined): ChatMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.messages);
}

function trocarNasPaginas<P extends Page>(old: InfiniteData<P> | undefined, message: ChatMessage, acrescentar: boolean): InfiniteData<P> | undefined {
  if (!old) return old;
  let found = false;
  const pages = old.pages.map((p) => ({
    ...p,
    messages: p.messages.map((m) => {
      if (m.id === message.id || (m.client_message_id === message.client_message_id && m.sender_id === message.sender_id)) {
        found = true;
        // O evento ao vivo vem sem os resumos dos itens: guarda os que este leitor já tinha.
        return mesclarObjetos(m, message);
      }
      return m;
    }),
  }));
  if (!found && acrescentar && pages[0]) pages[0] = { ...pages[0], messages: [...pages[0].messages, message] };
  return { ...old, pages };
}

function mesclarObjetos(antiga: ChatMessage, nova: ChatMessage): ChatMessage {
  if (!nova.objects?.length || !antiga.objects?.length) return { ...nova, saved: nova.saved ?? antiga.saved };
  const porId = new Map(antiga.objects.map((o) => [o.id, o]));
  return {
    ...nova,
    saved: nova.saved ?? antiga.saved,
    objects: nova.objects.map((o) => (o.snapshot === null && !o.restricted && porId.get(o.id) ? porId.get(o.id)! : o)),
  };
}

/** Coloca/atualiza a mensagem no lugar certo: linha principal ou a thread dela. */
function upsertMessage(qc: QueryClient, message: ChatMessage, acrescentar = true) {
  if (message.thread_root_id) {
    qc.setQueryData<InfiniteData<Page & { root: ChatMessage }>>(keys.thread(message.thread_root_id), (old) => trocarNasPaginas(old, message, acrescentar));
    return;
  }
  qc.setQueryData<InfiniteData<Page>>(keys.messages(message.conversation_id), (old) => trocarNasPaginas(old, message, acrescentar));
  // A mensagem também pode ser a raiz de uma thread aberta.
  qc.setQueryData<InfiniteData<Page & { root: ChatMessage }>>(keys.thread(message.id), (old) => old && ({
    ...old,
    pages: old.pages.map((p) => ({ ...p, root: mesclarObjetos(p.root, message) })),
  }));
}

export function newClientMessageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ObjectToShare { type: ChatObjectType; id: string; context?: Record<string, unknown>; label?: string }

export interface SendInput {
  content: string;
  replyTo?: ChatMessage['reply_to'];
  threadRootId?: string | null;
  attachments?: ChatAttachment[];
  mentions?: string[];
  objects?: ObjectToShare[];
  clientMessageId?: string;
}

/**
 * Envio com bolha imediata. O clientMessageId é gerado AQUI e reaproveitado no
 * "tentar de novo": o servidor reconhece o mesmo envio e nunca duplica.
 */
export function useSendChatMessage(conversationId: string, me: { id: string; name: string | null }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInput & { clientMessageId: string }) =>
      apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: input.content || null,
          clientMessageId: input.clientMessageId,
          replyToId: input.replyTo?.id ?? null,
          threadRootId: input.threadRootId ?? null,
          attachmentIds: (input.attachments ?? []).map((a) => a.id),
          mentions: input.mentions ?? [],
          objects: (input.objects ?? []).map((o) => ({ type: o.type, id: o.id, ...(o.context ? { context: o.context } : {}) })),
        }),
      }),
    onMutate: (input) => {
      upsertMessage(qc, {
        id: `local-${input.clientMessageId}`, conversation_id: conversationId, sender_id: me.id, sender_name: me.name, sender_avatar_url: null,
        kind: 'user', content: input.content || null, client_message_id: input.clientMessageId,
        reply_to: input.replyTo ?? null, thread_root_id: input.threadRootId ?? null, reply_count: 0,
        mentions: input.mentions ?? [], created_at: new Date().toISOString(), edited_at: null, deleted: false,
        attachments: input.attachments ?? [], reactions: [],
        objects: (input.objects ?? []).map((o, i) => ({ id: `local-obj-${i}`, type: o.type, object_id: o.id, provider: null, context: o.context ?? {}, snapshot: { name: o.label ?? 'Item' }, restricted: false, shared_at: new Date().toISOString() })),
        local_status: 'sending',
      });
    },
    onSuccess: (message) => {
      upsertMessage(qc, message);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
    onError: (_e, input) => {
      const marcar = <P extends Page>(old: InfiniteData<P> | undefined) => old && ({
        ...old,
        pages: old.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.client_message_id === input.clientMessageId ? { ...m, local_status: 'failed' as const } : m)) })),
      });
      if (input.threadRootId) qc.setQueryData<InfiniteData<Page & { root: ChatMessage }>>(keys.thread(input.threadRootId), marcar);
      else qc.setQueryData<InfiniteData<Page>>(keys.messages(conversationId), marcar);
    },
  });
}

export function useEditChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; content: string }) =>
      apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${input.messageId}`, { method: 'PATCH', body: JSON.stringify({ content: input.content }) }),
    onSuccess: (m) => upsertMessage(qc, m, false),
  });
}

export function useDeleteChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: (m) => upsertMessage(qc, m, false),
  });
}

export function useReactChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; emoji: string }) =>
      apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${input.messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji: input.emoji }) }),
    onSuccess: (m) => upsertMessage(qc, m, false),
  });
}

export function usePinMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; pinned: boolean }) =>
      apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${input.messageId}/pin`, { method: 'POST', body: JSON.stringify({ pinned: input.pinned }) }),
    onSuccess: (m) => {
      upsertMessage(qc, m, false);
      void qc.invalidateQueries({ queryKey: keys.pins(conversationId) });
      void qc.invalidateQueries({ queryKey: keys.detail(conversationId) });
    },
  });
}

export function useSaveMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: ChatMessage; saved: boolean }) =>
      apiFetch<{ saved: boolean }>(`/internal-chat/conversations/${conversationId}/messages/${input.message.id}/save`, { method: 'POST', body: JSON.stringify({ saved: input.saved }) }),
    onMutate: ({ message, saved }) => upsertMessage(qc, { ...message, saved }, false),
    onError: (_e, { message }) => upsertMessage(qc, message, false),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.saved }),
  });
}

export function usePins(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.pins(conversationId ?? 'none'),
    enabled: Boolean(conversationId) && enabled,
    queryFn: async () => (await apiFetch<{ messages: ChatMessage[] }>(`/internal-chat/conversations/${conversationId}/pins`)).messages,
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => apiFetch(`/internal-chat/conversations/${conversationId}/read`, { method: 'POST' }),
    onMutate: (conversationId) => zerarNaoLidas(qc, conversationId),
  });
}

export function useMuteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; muted: boolean }) =>
      apiFetch(`/internal-chat/conversations/${input.conversationId}/mute`, { method: 'POST', body: JSON.stringify({ muted: input.muted }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.conversations }); void qc.invalidateQueries({ queryKey: keys.unread }); },
  });
}

export function useOpenDirectChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiFetch<{ id: string }>('/internal-chat/conversations/direct', { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; visibility: 'public' | 'private'; memberIds: string[] }) =>
      apiFetch<{ id: string }>('/internal-chat/channels', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.conversations }); void qc.invalidateQueries({ queryKey: keys.browse }); },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string | undefined; memberIds: string[] }) => apiFetch<{ id: string }>('/internal-chat/groups', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useOpenDiscussion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { entity_type: 'client' | 'demand'; entity_id: string; title: string }) =>
      apiFetch<{ id: string }>('/internal-chat/discussions', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export interface BrowseChannel { id: string; title: string; description: string | null; archived: boolean; member_count: number; joined: boolean; last_message_at: string | null }

export function useBrowseChannels(enabled: boolean) {
  return useQuery({
    queryKey: keys.browse,
    enabled,
    queryFn: async () => (await apiFetch<{ channels: BrowseChannel[] }>('/internal-chat/channels/browse')).channels,
  });
}

function aposMudarConversa(qc: QueryClient, conversationId: string) {
  void qc.invalidateQueries({ queryKey: keys.conversations });
  void qc.invalidateQueries({ queryKey: keys.detail(conversationId) });
  void qc.invalidateQueries({ queryKey: keys.browse });
  void qc.invalidateQueries({ queryKey: keys.unread });
}

export function useConversationActions(conversationId: string) {
  const qc = useQueryClient();
  const depois = () => aposMudarConversa(qc, conversationId);
  const base = `/internal-chat/conversations/${conversationId}`;
  return {
    join: useMutation({ mutationFn: () => apiFetch(`${base}/join`, { method: 'POST' }), onSuccess: depois }),
    leave: useMutation({ mutationFn: () => apiFetch(`${base}/leave`, { method: 'POST' }), onSuccess: depois }),
    update: useMutation({ mutationFn: (input: { name?: string; title?: string | null; description?: string | null }) => apiFetch(base, { method: 'PATCH', body: JSON.stringify(input) }), onSuccess: depois }),
    archive: useMutation({ mutationFn: (archived: boolean) => apiFetch(`${base}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }), onSuccess: depois }),
    addMembers: useMutation({ mutationFn: (userIds: string[]) => apiFetch<{ added: string[] }>(`${base}/members`, { method: 'POST', body: JSON.stringify({ userIds }) }), onSuccess: depois }),
    removeMember: useMutation({ mutationFn: (userId: string) => apiFetch(`${base}/members/${userId}`, { method: 'DELETE' }), onSuccess: depois }),
  };
}

export function useChatFiles(conversationId: string | null, kind: string, q: string) {
  return useQuery({
    queryKey: keys.files(conversationId ?? 'none', kind, q),
    enabled: Boolean(conversationId),
    queryFn: async () => (await apiFetch<{ files: ChatAttachment[] }>(`/internal-chat/conversations/${conversationId}/attachments?limit=200${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)).files,
  });
}

export function useFileLibrary(filtros: { kind: string; q: string; sort: string }) {
  return useInfiniteQuery({
    queryKey: keys.library(filtros),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '60', offset: String(pageParam), sort: filtros.sort || 'recentes' });
      if (filtros.kind) p.set('kind', filtros.kind);
      if (filtros.q) p.set('q', filtros.q);
      return apiFetch<{ files: ChatAttachment[]; has_more: boolean }>(`/internal-chat/files?${p}`);
    },
    getNextPageParam: (ultima, todas) => (ultima.has_more ? todas.length * 60 : undefined),
  });
}

export interface SearchFilters { q: string; sender_id?: string | undefined; conversation_id?: string | undefined; from?: string | undefined; to?: string | undefined; attachment_kind?: string | undefined; object_type?: string | undefined }

export function useChatSearch(filtros: SearchFilters | string) {
  const f: SearchFilters = typeof filtros === 'string' ? { q: filtros } : filtros;
  const temAlgo = f.q.trim().length >= 2 || Boolean(f.sender_id || f.conversation_id || f.from || f.to || f.attachment_kind || f.object_type);
  const chave = Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>;
  return useQuery({
    queryKey: keys.search(chave),
    enabled: temAlgo,
    queryFn: async () => {
      const p = new URLSearchParams(chave);
      if (p.get('q')) p.set('q', p.get('q')!.trim());
      return (await apiFetch<{ results: ChatMessage[] }>(`/internal-chat/search?${p}`)).results;
    },
    staleTime: 10_000,
  });
}

export function useMentions(enabled: boolean) {
  return useQuery({ queryKey: keys.mentions, enabled, queryFn: async () => (await apiFetch<{ messages: ChatMessage[] }>('/internal-chat/mentions')).messages });
}

export function useSavedMessages(enabled: boolean) {
  return useQuery({ queryKey: keys.saved, enabled, queryFn: async () => (await apiFetch<{ messages: ChatMessage[] }>('/internal-chat/saved')).messages });
}

export interface ChatPreferences { dnd_until: string | null; notify_reactions: boolean; notify_channel_messages: boolean }

export function useChatPreferences() {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: keys.preferences, queryFn: () => apiFetch<ChatPreferences>('/internal-chat/preferences') });
  const salvar = useMutation({
    mutationFn: (input: Partial<ChatPreferences>) => apiFetch<ChatPreferences>('/internal-chat/preferences', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (p) => qc.setQueryData(keys.preferences, p),
  });
  return { ...consulta, salvar };
}

export type ObjectState =
  | { id: string; type: ChatObjectType; provider: string | null; state: 'ok'; data: Record<string, unknown>; fetched_at: string; object_id: string; context: Record<string, unknown> }
  | { id: string; type: ChatObjectType; provider: string | null; state: 'sem_acesso' | 'removido' | 'indisponivel'; message: string };

/** Estado ATUAL de um item compartilhado, com a permissão de quem está lendo. */
export function useObjectState(objectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.object(objectId ?? 'none'),
    enabled: Boolean(objectId) && enabled && !objectId?.startsWith('local-'),
    queryFn: () => apiFetch<ObjectState>(`/internal-chat/objects/${objectId}`),
    retry: naoInsistirEm4xx,
    staleTime: 60_000,
  });
}

export function useCreateTaskFromMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; idempotency_key: string; title: string; description?: string | undefined; client_id: string; assignee_clickup_id?: number | null; due_date?: number | null; priority?: 1 | 2 | 3 | 4 | null }) => {
      const { messageId, ...body } = input;
      return apiFetch<{ task_id: string; url: string; replay: boolean; message: ChatMessage }>(`/internal-chat/conversations/${conversationId}/messages/${messageId}/create-task`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: (r) => upsertMessage(qc, r.message),
  });
}

export function useAskAgent() {
  return useMutation({
    mutationFn: (input: { action: 'analyze_object'; object_id: string } | { action: 'summarize_conversation'; conversation_id: string; thread_root_id?: string | null; extra?: string }) =>
      apiFetch<{ agent: string; conversation_id: string; execution_id: string | null }>('/internal-chat/assist', { method: 'POST', body: JSON.stringify(input) }),
  });
}

export function useAttachmentPolicy() {
  return useQuery({
    queryKey: ['internal-chat', 'policy'],
    queryFn: () => apiFetch<{ extensions: string[]; max_bytes: Record<string, number> }>('/internal-chat/attachment-policy'),
    staleTime: 10 * 60_000,
  });
}

export function uploadChatAttachment(conversationId: string, file: File, onProgress: (f: number) => void, signal: AbortSignal) {
  const body = new FormData();
  body.append('file', file, file.name);
  return apiUploadWithProgress<ChatAttachment>(`/internal-chat/conversations/${conversationId}/attachments`, body, onProgress, signal);
}

let ultimoAvisoDeDigitacao = 0;
/** Avisa "digitando…" no máximo a cada 3 s. */
export function notifyTyping(conversationId: string, threadRootId?: string | null) {
  if (Date.now() - ultimoAvisoDeDigitacao < 3000) return;
  ultimoAvisoDeDigitacao = Date.now();
  void apiFetch(`/internal-chat/conversations/${conversationId}/typing`, { method: 'POST', body: JSON.stringify({ thread_root_id: threadRootId ?? null }) }).catch(() => undefined);
}

let ultimaPresenca: string | null = null;
/** Online / ausente conforme a aba está à vista. Não guarda histórico: é só para saber se vale chamar agora. */
export function reportPresence(state: 'online' | 'away') {
  if (ultimaPresenca === state) return;
  ultimaPresenca = state;
  void apiFetch('/internal-chat/presence', { method: 'POST', body: JSON.stringify({ state }) }).catch(() => { ultimaPresenca = null; });
}

// ---- "fulano está digitando…" (estado só da tela, vence sozinho em 5 s) ----
const digitando = new Map<string, Map<string, { name: string | null; until: number }>>();
const ouvintes = new Set<() => void>();
const avisarOuvintes = () => ouvintes.forEach((o) => o());
const chaveDeDigitacao = (conversationId: string, threadRootId?: string | null) => (threadRootId ? `${conversationId}:${threadRootId}` : conversationId);

export function useTypingUsers(conversationId: string | null, threadRootId?: string | null): string[] {
  return useSyncExternalStore(
    (cb) => { ouvintes.add(cb); const t = setInterval(cb, 1000); return () => { ouvintes.delete(cb); clearInterval(t); }; },
    () => {
      const mapa = conversationId ? digitando.get(chaveDeDigitacao(conversationId, threadRootId)) : undefined;
      if (!mapa) return SEM_NINGUEM;
      const agora = Date.now();
      const nomes = [...mapa.values()].filter((v) => v.until > agora).map((v) => v.name ?? 'Alguém');
      const chave = nomes.join('|');
      return cacheDeNomes.get(chave) ?? (cacheDeNomes.set(chave, nomes), nomes);
    },
    () => SEM_NINGUEM,
  );
}
const SEM_NINGUEM: string[] = [];
const cacheDeNomes = new Map<string, string[]>();

function zerarNaoLidas(qc: QueryClient, conversationId: string) {
  let zeradas = 0;
  qc.setQueryData<ChatConversation[]>(keys.conversations, (old) => old?.map((c) => {
    if (c.id !== conversationId) return c;
    // Silenciada só entrava no número da barra lateral pelas menções.
    zeradas = c.muted ? (c.mentions_unread ?? 0) : c.unread_count;
    return { ...c, unread_count: 0, mentions_unread: 0 };
  }));
  if (zeradas) qc.setQueryData<number>(keys.unread, (n) => Math.max(0, (n ?? 0) - zeradas));
}

/** Conversa aberta agora nesta aba (a tela registra): mensagem dela não conta como não lida. */
let conversaAberta: string | null = null;
export function setOpenConversation(id: string | null) { conversaAberta = id; }

/**
 * Evento ao vivo da Comunicação entrando no cache. Payload já filtrado pelo
 * servidor (só chega a quem pode ler a conversa).
 */
export function applyInternalChatEvent(qc: QueryClient, payload: Record<string, unknown>, meId: string | null) {
  const evento = payload.event;
  const conversationId = payload.conversation_id as string | undefined;
  if (!conversationId) return;
  if (evento === 'message.created' || evento === 'message.updated') {
    const message = payload.message as ChatMessage;
    upsertMessage(qc, message, evento === 'message.created');
    if (evento === 'message.updated' && message.pinned !== undefined) void qc.invalidateQueries({ queryKey: keys.pins(conversationId) });
    if (evento === 'message.created') {
      // Ela digitava; a mensagem chegou: some o "digitando".
      digitando.get(chaveDeDigitacao(conversationId, message.thread_root_id))?.delete(message.sender_id);
      avisarOuvintes();
      // Resposta em thread e aviso de sistema não mexem na lista nem nas não lidas.
      if (message.thread_root_id) return;
      const conhecida = qc.getQueryData<ChatConversation[]>(keys.conversations)?.some((c) => c.id === conversationId);
      if (!conhecida) { void qc.invalidateQueries({ queryKey: keys.conversations }); void qc.invalidateQueries({ queryKey: keys.unread }); return; }
      const minha = message.sender_id === meId;
      const sistema = message.kind === 'system';
      const lendoAgora = conversaAberta === conversationId && typeof document !== 'undefined' && document.visibilityState === 'visible';
      const meMencionou = Boolean(meId && message.mentions.includes(meId));
      let somar = 0;
      qc.setQueryData<ChatConversation[]>(keys.conversations, (old) => {
        if (!old) return old;
        const atualizadas = old.map((c) => {
          if (c.id !== conversationId) return c;
          const conta = !minha && !lendoAgora && !sistema;
          if (conta && (!c.muted || meMencionou)) somar = 1;
          return {
            ...c,
            unread_count: conta ? c.unread_count + 1 : c.unread_count,
            mentions_unread: conta && meMencionou ? (c.mentions_unread ?? 0) + 1 : (c.mentions_unread ?? 0),
            last_message: { content: message.content, deleted: false, has_attachment: message.attachments.length > 0, sender_id: message.sender_id, sender_name: message.sender_name, kind: message.kind ?? 'user', created_at: message.created_at },
          };
        });
        // #Geral fica no topo; o resto pela mais recente.
        const [geral, ...outras] = [atualizadas.find((c) => c.kind === 'general'), ...atualizadas.filter((c) => c.kind !== 'general')];
        outras.sort((a, b) => (b!.last_message?.created_at ?? '').localeCompare(a!.last_message?.created_at ?? ''));
        return [geral, ...outras].filter(Boolean) as ChatConversation[];
      });
      if (somar) qc.setQueryData<number>(keys.unread, (n) => (n ?? 0) + somar);
      if (meMencionou) void qc.invalidateQueries({ queryKey: keys.mentions });
    }
  } else if (evento === 'conversation.read') {
    const quem = payload.user_id as string | undefined;
    if (!quem || quem === meId) {
      zerarNaoLidas(qc, conversationId);
    } else {
      // Outra pessoa leu: atualiza o "visto" do painel da conversa.
      qc.setQueryData<ChatConversationDetail>(keys.detail(conversationId), (old) => old && ({
        ...old,
        members: old.members.map((m) => (m.id === quem ? { ...m, last_read_at: String(payload.read_at ?? new Date().toISOString()) } : m)),
      }));
    }
  } else if (evento === 'typing') {
    const userId = payload.user_id as string;
    if (userId === meId) return;
    const chave = chaveDeDigitacao(conversationId, payload.thread_root_id as string | null | undefined);
    const mapa = digitando.get(chave) ?? new Map();
    mapa.set(userId, { name: (payload.user_name as string | null) ?? null, until: Date.now() + 5000 });
    digitando.set(chave, mapa);
    avisarOuvintes();
  } else if (evento === 'conversation.added' || evento === 'conversation.updated' || evento === 'conversation.removed') {
    aposMudarConversa(qc, conversationId);
    if (evento === 'conversation.removed') qc.removeQueries({ queryKey: keys.messages(conversationId) });
  }
}

/** WebSocket voltou: busca de novo o que pode ter passado enquanto estava fora. */
export function recoverInternalChat(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['internal-chat'] });
}
