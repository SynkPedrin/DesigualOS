import type { RouterDecision } from '@desigual-os/router';
import type { StudioReferenceAsset } from '@desigual-os/types';
import { createAndEnqueueExecution } from './chat-service';
import type { ChatResult } from './result';
import { startWorkflow } from './workflow-service';

export interface DispatchParams {
  message: string;
  userId: string;
  clientId: string | null;
  conversationId: string | null;
  decision: RouterDecision;
  attachments?: StudioReferenceAsset[];
}

/**
 * Ponto único que POST /chat chama: decide entre execução de agente único
 * (Fase 09) ou workflow multi agente (Fase 10) a partir do que o Router
 * decidiu.
 */
export async function dispatchChatMessage(params: DispatchParams): Promise<ChatResult> {
  const { decision } = params;
  if (decision.workflow && decision.workflow.length > 1) {
    return startWorkflow({ ...params, decision: { ...decision, workflow: decision.workflow } });
  }
  return createAndEnqueueExecution(params);
}
