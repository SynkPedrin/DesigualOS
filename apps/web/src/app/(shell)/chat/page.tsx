import { Suspense } from 'react';
import { ChatThread } from '@/components/chat/chat-thread';
import { AgentsPanel } from '@/components/agents/agents-panel';

export default function ChatPage() {
  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <Suspense fallback={null}>
          <ChatThread />
        </Suspense>
      </div>
      <AgentsPanel />
    </div>
  );
}
