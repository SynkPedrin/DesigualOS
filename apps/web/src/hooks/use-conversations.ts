import { useQuery } from '@tanstack/react-query';
import type { AgentName } from '@desigual-os/types';
import { apiFetch } from '@/lib/api/client';
import {
  mapConversationMessage,
  mapConversationSummary,
  type ConversationMessageWire,
  type ConversationSummaryWire,
} from '@/lib/api/contracts';

export function useConversations(agent: AgentName | null, clientId?: string | null) {
  return useQuery({
    queryKey: ['conversations', { agent, clientId: clientId ?? null }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (agent) params.set('agent', agent);
      if (clientId) params.set('client_id', clientId);
      const query = params.toString();
      const wire = await apiFetch<{ conversations: ConversationSummaryWire[] }>(`/conversations${query ? `?${query}` : ''}`);
      return wire.conversations.map(mapConversationSummary);
    },
    // Chat é compartilhado pela equipe agora: sem isso, uma conversa nova de outra pessoa
    // (ou um agente respondendo) só aparecia na barra lateral depois de um reload manual.
    refetchInterval: 10_000,
  });
}

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
  });
}
