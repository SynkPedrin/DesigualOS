import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  agentSelectionToHint,
  mapChatResponse,
  type AgentSelection,
  type ChatAttachmentWire,
  type ChatRequestWire,
  type ChatResponseWire,
  type MotionBriefWire,
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
  /** Briefing estruturado do MotionBriefCard (já filtrado: só campos
   * preenchidos). Vai como `motion_brief` no POST /chat. */
  motionBrief?: MotionBriefWire | undefined;
}

export function useSendChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ message, clientId, agentSelection, conversationId, projectId, attachments, motionBrief }: SendChatMessageInput) => {
      const body: ChatRequestWire = {
        message,
        client_id: clientId,
        agent_hint: agentSelectionToHint(agentSelection),
        ...(conversationId ? { conversation_id: conversationId } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        ...(attachments?.length ? { attachments } : {}),
        ...(motionBrief ? { motion_brief: motionBrief } : {}),
      };
      // Timeout próprio (24/09/2026): turno operacional consulta o ClickUp ao
      // vivo ANTES do 202, e uma listagem da carteira inteira passa dos 30s
      // default — o fetch abortava, o front nunca recebia execution_id e o
      // balão ficava preso em "pensando" com a resposta já gravada no banco.
      const wire = await apiFetch<ChatResponseWire>('/chat', {
        method: 'POST',
        body: JSON.stringify(body),
      }, { timeoutMs: 120_000 });
      return mapChatResponse(wire);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
