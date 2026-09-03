'use client';

import { Plus, MessageSquare, MessageCircle } from 'lucide-react';
import type { AgentName } from '@desigual-os/types';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useConversations } from '@/hooks/use-conversations';
import { useClients } from '@/hooks/use-clients';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ConversationSidebar({
  agentFilter,
  clientFilter,
  activeConversationId,
  onSelect,
  onNewConversation,
}: {
  agentFilter: AgentName | null;
  /** Projeto selecionado no ClientSelector: além de marcar conversas novas, também
   * restringe o histórico mostrado aqui — "tela de projeto" dentro do chat. */
  clientFilter: string | null;
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
}) {
  const { data: conversations, isPending } = useConversations(agentFilter, clientFilter);
  const { data: clients } = useClients();
  const clientName = clientFilter ? clients?.find((c) => c.id === clientFilter)?.name : null;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-grafite-elevado pr-4">
      <button
        type="button"
        onClick={onNewConversation}
        className="mb-4 flex items-center justify-center gap-2 rounded-md border border-grafite-elevado bg-grafite py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
      >
        <Plus size={15} />
        Nova conversa
      </button>

      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">
        {clientName ? `Conversas · ${clientName}` : 'Conversas'}
      </p>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {isPending ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)
        ) : !conversations || conversations.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma conversa"
            description={clientName ? `Ainda não tem conversa em ${clientName}.` : 'Comece uma nova conversa.'}
          />
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors',
                activeConversationId === conversation.id
                  ? 'bg-grafite-elevado'
                  : 'hover:bg-grafite',
              )}
            >
              {conversation.lastAgent ? (
                <AgentAvatar agent={conversation.lastAgent} size="sm" />
              ) : (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-grafite-elevado text-nevoa">
                  <MessageCircle size={12} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru">
                  {conversation.title ?? conversation.lastMessagePreview ?? 'Nova conversa'}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-nevoa">
                  {formatRelativeTime(conversation.updatedAt)}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
