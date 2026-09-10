import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentName } from '@desigual-os/types';
import { apiFetch } from '@/lib/api/client';
import {
  mapConversationDetail,
  mapConversationMessage,
  mapConversationSummary,
  type ConversationDetailWire,
  type ConversationMessageWire,
  type ConversationSummaryWire,
  type UpdateConversationRequestWire,
} from '@/lib/api/contracts';

export function useConversations(agent: AgentName | null, clientId?: string | null, projectId?: string | null) {
  return useQuery({
    queryKey: ['conversations', { agent, clientId: clientId ?? null, projectId: projectId ?? null }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (agent) params.set('agent', agent);
      if (clientId) params.set('client_id', clientId);
      if (projectId) params.set('project_id', projectId);
      const query = params.toString();
      const wire = await apiFetch<{ conversations: ConversationSummaryWire[] }>(`/conversations${query ? `?${query}` : ''}`);
      return wire.conversations.map(mapConversationSummary);
    },
    // Chat é compartilhado pela equipe: sem isso, uma conversa nova de outra pessoa
    // (ou um agente respondendo) só aparecia na barra lateral depois de um reload manual.
    refetchInterval: 10_000,
  });
}

export function useConversation(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversations', conversationId, 'detail'],
    queryFn: async () => mapConversationDetail(await apiFetch<ConversationDetailWire>(`/conversations/${conversationId}`)),
    enabled: Boolean(conversationId),
  });
}

/**
 * Histórico persistido da conversa - fonte da verdade do que aparece na thread.
 * staleTime 0 de propósito: abrir uma conversa sempre busca o estado atual do
 * banco (a invalidação via WS/polling cobre o "enquanto está aberta").
 */
export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversations', conversationId, 'messages'],
    queryFn: async () => {
      const wire = await apiFetch<{ conversation_id: string; messages: ConversationMessageWire[] }>(
        `/conversations/${conversationId}/messages`,
      );
      return wire.messages.map(mapConversationMessage);
    },
    enabled: Boolean(conversationId),
    staleTime: 0,
  });
}

/** Renomear, mover pra projeto (projectId null = tirar do projeto), trocar visibilidade. */
export function useUpdateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateConversationRequestWire & { id: string }) =>
      mapConversationDetail(
        await apiFetch<ConversationDetailWire>(`/conversations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', variables.id, 'detail'] });
    },
  });
}

/** Apaga a conversa e as mensagens dela (204). */
export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
