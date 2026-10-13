'use client';

import { MessageCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { formatRelativeTime } from '@/lib/format';
import type { InboxThread } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/** Abas da lista (mockup "Conversas", 07/10/2026, revisado): Todas / Não
 * lidas / Clientes (tem cliente vinculado) / Contatos — todos os contatos do
 * WhatsApp conectado, não só quem já é cliente (ver `ContactsList` em
 * `app/(shell)/inbox/page.tsx`, que troca a lista inteira pra uma visão
 * nome+telefone quando esta aba está ativa). Trocou o recorte antigo por
 * status (minhas/não atribuídas/aguardando...) porque é o que o mockup pede
 * pra tela mais visível da demo; o recorte por status continua disponível
 * via filtro avançado, não removido do backend. */
export type InboxFilterKey = 'todas' | 'nao-lidas' | 'clientes' | 'contatos';

export const INBOX_FILTERS: Array<{ key: InboxFilterKey; label: string }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'nao-lidas', label: 'Não lidas' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'contatos', label: 'Contatos' },
];

export function ThreadList({
  threads,
  isPending,
  selectedId,
  onSelect,
}: {
  threads: InboxThread[] | undefined;
  isPending: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (isPending) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!threads || threads.length === 0) {
    return (
      <div className="p-4">
        <EmptyState icon={MessageCircle} title="Nenhuma conversa aqui" description="Quando uma conversa chegar nesse filtro, ela aparece aqui." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-grafite-elevado overflow-y-auto">
      {threads.map((thread) => {
        const nome = thread.clientName ?? thread.contactName;
        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onSelect(thread.id)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-grafite-elevado/60',
                selectedId === thread.id && 'bg-grafite-elevado',
              )}
            >
              <EntityAvatar name={nome} kind={thread.clientId ? 'client' : 'person'} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-branco-cru">{nome}</span>
                  {thread.lastMessageAt && <span className="shrink-0 text-xs text-nevoa">{formatRelativeTime(thread.lastMessageAt)}</span>}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-nevoa">{thread.lastMessagePreview ?? (thread.clientName ? 'Sem mensagens ainda' : 'Conversa interna')}</span>
                  {thread.unreadCount > 0 && (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-roxo-eletrico text-[10px] font-semibold text-branco-cru">
                      {thread.unreadCount}
                    </span>
                  )}
                  {thread.unreadCount === 0 && !thread.assignedToUserId && thread.clientId && (
                    <span className="shrink-0 rounded-full bg-sinal/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sinal">
                      Não atribuída
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
