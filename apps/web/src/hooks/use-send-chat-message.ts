import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  agentSelectionToHint,
  mapChatResponse,
  type AgentSelection,
  type ChatAttachmentWire,
  type ChatRequestWire,
  type ChatResponseWire,
} from '@/lib/api/contracts';

interface SendChatMessageInput {
  message: string;
  clientId: string | null;
  agentSelection: AgentSelection;
  conversationId: string | null;
  /** Só faz sentido pra conversa NOVA (abrir um chat dentro de um projeto):
   * o backend usa isso pra gravar conversations.project_id e, se clientId
   * vier vazio aqui, herdar o cliente do próprio projeto. */
  projectId?: string | null | undefined;
  /** Anexos já hospedados via POST /uploads (composer do chat), até 10. */
  attachments?: ChatAttachmentWire[] | undefined;
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ message, clientId, agentSelection, conversationId, projectId, attachments }: SendChatMessageInput) => {
      const body: ChatRequestWire = {
        message,
        client_id: clientId,
        agent_hint: agentSelectionToHint(agentSelection),
        ...(conversationId ? { conversation_id: conversationId } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        ...(attachments?.length ? { attachments } : {}),
      };
      const wire = await apiFetch<ChatResponseWire>('/chat', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return mapChatResponse(wire);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
