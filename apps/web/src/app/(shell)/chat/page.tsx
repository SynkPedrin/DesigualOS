import { Suspense } from 'react';
import { ChatThread } from '@/components/chat/chat-thread';

/**
 * O chat ocupa o centro inteiro: a coluna direita (AgentsPanel) e o rail de
 * conversas dentro do ChatThread saíram daqui — a lista de conversas vai para
 * a sidebar global (tarefa separada) e as infos de agente continuam em /agents.
 * Os componentes seguem no repo.
 */
export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatThread />
    </Suspense>
  );
}
