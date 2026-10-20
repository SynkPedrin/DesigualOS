'use client';

import { useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { apiFetch, apiUploadWithProgress } from '@/lib/api/client';

/**
 * Comunicação interna — dados da tela. Tudo sob a chave ['internal-chat', …]:
 * os eventos ao vivo (chat.event) entram direto neste cache
 * (applyInternalChatEvent), e a reconexão do WebSocket invalida tudo para
 * recuperar o que passou enquanto a conexão estava fora.
 */

export interface ChatAttachment {
  id: string;
  message_id: string | null;
  filename: string;
  mimetype: string;
  kind: 'image' | 'video' | 'document' | 'archive';
  size_bytes: number;
  width: number | null;
  height: number | null;
  url: string;
  created_at: string;
  sender_name?: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar_url: string | null;
  content: string | null;
  client_message_id: string;
  reply_to: { id: string; sender_name: string | null; content: string | null; deleted: boolean } | null;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  attachments: ChatAttachment[];
  reactions: Array<{ emoji: string; user_ids: string[] }>;
  /** Só na tela: ainda subindo ('sending') ou falhou ('failed'). */
  local_status?: 'sending' | 'failed';
}

export interface ChatConversation {
  id: string;
  kind: 'general' | 'direct';
  title: string;
  partner: { id: string; name: string | null; avatar_url: string | null; online: boolean } | null;
  last_message: { content: string | null; deleted: boolean; has_attachment: boolean; sender_id: string | null; created_at: string } | null;
  unread_count: number;
  muted: boolean;
}

export interface ChatMember { id: string; name: string; avatar_url: string | null; is_me: boolean; online: boolean }

interface Page { messages: ChatMessage[]; has_more: boolean }

const keys = {
  conversations: ['internal-chat', 'conversations'] as const,
  unread: ['internal-chat', 'unread'] as const,
  members: ['internal-chat', 'members'] as const,
  messages: (id: string) => ['internal-chat', 'messages', id] as const,
  files: (id: string, kind: string, q: string) => ['internal-chat', 'files', id, kind, q] as const,
  search: (q: string) => ['internal-chat', 'search', q] as const,
};

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

export function useChatMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: keys.messages(conversationId ?? 'none'),
    enabled: Boolean(conversationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<Page>(`/internal-chat/conversations/${conversationId}/messages?limit=40${pageParam ? `&before=${pageParam}` : ''}`),
    // Páginas vêm da mais nova para a mais velha; "próxima" = mais antiga.
    getNextPageParam: (ultima) => (ultima.has_more && ultima.messages[0] ? ultima.messages[0].id : null),
    staleTime: 30_000,
  });
}

/** Mensagens em ordem cronológica, de todas as páginas carregadas. */
export function flattenMessages(data: InfiniteData<Page> | undefined): ChatMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.messages);
}

function upsertMessage(qc: QueryClient, message: ChatMessage) {
  qc.setQueryData<InfiniteData<Page>>(keys.messages(message.conversation_id), (old) => {
    if (!old) return old;
    let found = false;
    const pages = old.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) => {
        if (m.id === message.id || (m.client_message_id === message.client_message_id && m.sender_id === message.sender_id)) { found = true; return message; }
        return m;
      }),
    }));
    if (!found && pages[0]) pages[0] = { ...pages[0], messages: [...pages[0].messages, message] };
    return { ...old, pages };
  });
}

export function newClientMessageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface SendInput { content: string; replyTo?: ChatMessage['reply_to']; attachments?: ChatAttachment[]; mentions?: string[]; clientMessageId?: string }

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
          attachmentIds: (input.attachments ?? []).map((a) => a.id),
          mentions: input.mentions ?? [],
        }),
      }),
    onMutate: (input) => {
      upsertMessage(qc, {
        id: `local-${input.clientMessageId}`, conversation_id: conversationId, sender_id: me.id, sender_name: me.name, sender_avatar_url: null,
        content: input.content || null, client_message_id: input.clientMessageId,
        reply_to: input.replyTo ?? null,
        mentions: input.mentions ?? [], created_at: new Date().toISOString(), edited_at: null, deleted: false,
        attachments: input.attachments ?? [], reactions: [], local_status: 'sending',
      });
    },
    onSuccess: (message) => {
      upsertMessage(qc, message);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
    onError: (_e, input) => {
      qc.setQueryData<InfiniteData<Page>>(keys.messages(conversationId), (old) => old && ({
        ...old,
        pages: old.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.client_message_id === input.clientMessageId ? { ...m, local_status: 'failed' as const } : m)) })),
      }));
    },
  });
}

export function useEditChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; content: string }) =>
      apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${input.messageId}`, { method: 'PATCH', body: JSON.stringify({ content: input.content }) }),
    onSuccess: (m) => upsertMessage(qc, m),
  });
}

export function useDeleteChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: (m) => upsertMessage(qc, m),
  });
}

export function useReactChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; emoji: string }) =>
      apiFetch<ChatMessage>(`/internal-chat/conversations/${conversationId}/messages/${input.messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji: input.emoji }) }),
    onSuccess: (m) => upsertMessage(qc, m),
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

export function useChatFiles(conversationId: string | null, kind: string, q: string) {
  return useQuery({
    queryKey: keys.files(conversationId ?? 'none', kind, q),
    enabled: Boolean(conversationId),
    queryFn: async () => (await apiFetch<{ files: ChatAttachment[] }>(`/internal-chat/conversations/${conversationId}/attachments?limit=200${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)).files,
  });
}

export function useChatSearch(q: string) {
  return useQuery({
    queryKey: keys.search(q),
    enabled: q.trim().length >= 2,
    queryFn: async () => (await apiFetch<{ results: ChatMessage[] }>(`/internal-chat/search?q=${encodeURIComponent(q.trim())}`)).results,
    staleTime: 10_000,
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
export function notifyTyping(conversationId: string) {
  if (Date.now() - ultimoAvisoDeDigitacao < 3000) return;
  ultimoAvisoDeDigitacao = Date.now();
  void apiFetch(`/internal-chat/conversations/${conversationId}/typing`, { method: 'POST' }).catch(() => undefined);
}

// ---- "fulano está digitando…" (estado só da tela, vence sozinho em 5 s) ----
const digitando = new Map<string, Map<string, { name: string | null; until: number }>>();
const ouvintes = new Set<() => void>();
const avisarOuvintes = () => ouvintes.forEach((o) => o());

export function useTypingUsers(conversationId: string | null): string[] {
  return useSyncExternalStore(
    (cb) => { ouvintes.add(cb); const t = setInterval(cb, 1000); return () => { ouvintes.delete(cb); clearInterval(t); }; },
    () => {
      const mapa = conversationId ? digitando.get(conversationId) : undefined;
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
    // Silenciada já não entrava no número da barra lateral.
    zeradas = c.muted ? 0 : c.unread_count;
    return { ...c, unread_count: 0 };
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
    upsertMessage(qc, message);
    if (evento === 'message.created') {
      const conhecida = qc.getQueryData<ChatConversation[]>(keys.conversations)?.some((c) => c.id === conversationId);
      if (!conhecida) { void qc.invalidateQueries({ queryKey: keys.conversations }); void qc.invalidateQueries({ queryKey: keys.unread }); return; }
      const minha = message.sender_id === meId;
      const lendoAgora = conversaAberta === conversationId && typeof document !== 'undefined' && document.visibilityState === 'visible';
      let somar = 0;
      qc.setQueryData<ChatConversation[]>(keys.conversations, (old) => {
        if (!old) return old;
        const atualizadas = old.map((c) => {
          if (c.id !== conversationId) return c;
          const conta = !minha && !lendoAgora;
          if (conta && !c.muted) somar = 1;
          return {
            ...c,
            unread_count: conta ? c.unread_count + 1 : c.unread_count,
            last_message: { content: message.content, deleted: false, has_attachment: message.attachments.length > 0, sender_id: message.sender_id, created_at: message.created_at },
          };
        });
        // #Geral fica no topo; as privadas pela mais recente.
        const [geral, ...privadas] = [atualizadas.find((c) => c.kind === 'general'), ...atualizadas.filter((c) => c.kind !== 'general')];
        privadas.sort((a, b) => (b!.last_message?.created_at ?? '').localeCompare(a!.last_message?.created_at ?? ''));
        return [geral, ...privadas].filter(Boolean) as ChatConversation[];
      });
      if (somar) qc.setQueryData<number>(keys.unread, (n) => (n ?? 0) + somar);
      // Ela digitava; a mensagem chegou: some o "digitando".
      digitando.get(conversationId)?.delete(message.sender_id);
      avisarOuvintes();
    }
  } else if (evento === 'conversation.read') {
    zerarNaoLidas(qc, conversationId);
  } else if (evento === 'typing') {
    const userId = payload.user_id as string;
    if (userId === meId) return;
    const mapa = digitando.get(conversationId) ?? new Map();
    mapa.set(userId, { name: (payload.user_name as string | null) ?? null, until: Date.now() + 5000 });
    digitando.set(conversationId, mapa);
    avisarOuvintes();
  }
}

/** WebSocket voltou: busca de novo o que pode ter passado enquanto estava fora. */
export function recoverInternalChat(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['internal-chat'] });
}
