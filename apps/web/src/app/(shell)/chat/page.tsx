import { Suspense } from 'react';
import { ChatThread } from '@/components/chat/chat-thread';

/**
 * O chat ocupa o centro da tela. A coluna direita (AgentsPanel) saiu daqui -
 * as infos de agente continuam em /agents e o componente segue no repo.
 * O rail de conversas (ConversationSidebar) continua renderizado dentro do
 * ChatThread, ao lado da coluna central com a home/conversa.
 */
export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatThread />
    </Suspense>
  );
}
