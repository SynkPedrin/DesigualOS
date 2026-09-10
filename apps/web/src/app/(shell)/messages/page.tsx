'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { MessagesSidebar, type MessagesFilter } from '@/components/messages/messages-sidebar';
import { MessagesEmptyState } from '@/components/messages/messages-empty-state';
import { ConversationView, type ConversationPartner } from '@/components/messages/conversation-view';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { useMessageThreads } from '@/hooks/use-messages';
import { useCollaborators } from '@/hooks/use-collaborators';
import { cn } from '@/lib/utils';

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesPageContent />
    </Suspense>
  );
}

const VALID_FILTERS: readonly MessagesFilter[] = ['todas', 'nao-lidas', 'favoritas', 'arquivadas'];

function parseFilter(value: string | null): MessagesFilter {
  return VALID_FILTERS.includes(value as MessagesFilter) ? (value as MessagesFilter) : 'todas';
}

function MessagesPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(searchParams.get('to'));
  const [filter, setFilter] = useState<MessagesFilter>(parseFilter(searchParams.get('filter')));
  const [pickerOpen, setPickerOpen] = useState(false);

  const {
    data: threadsData,
    isPending: threadsPending,
    isError: threadsError,
    refetch: refetchThreads,
  } = useMessageThreads();
  const {
    data: collaboratorsData,
    isPending: collaboratorsPending,
    isError: collaboratorsError,
    refetch: refetchCollaborators,
  } = useCollaborators();

  // O estado mora na URL (?to= / ?filter=): o deep link da command palette
  // (/messages?to=<userId>) abre a thread direto e refresh não perde o contexto.
  function syncUrl(userId: string | null, nextFilter: MessagesFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (userId) params.set('to', userId);
    else params.delete('to');
    if (nextFilter === 'todas') params.delete('filter');
    else params.set('filter', nextFilter);
    const query = params.toString();
    router.replace(`/messages${query ? `?${query}` : ''}`, { scroll: false });
  }

  // Navegação externa pra mesma rota (command palette com outro ?to=) não
  // remonta a página - o efeito aplica o novo valor, espelhando o chat-thread.
  const lastToParam = useRef(searchParams.get('to'));
  useEffect(() => {
    const to = searchParams.get('to');
    if (to === lastToParam.current) return;
    lastToParam.current = to;
    setSelectedUserId(to);
  }, [searchParams]);

  function handleSelect(userId: string | null) {
    lastToParam.current = userId;
    setSelectedUserId(userId);
    syncUrl(userId, filter);
  }

  function handleFilterChange(nextFilter: MessagesFilter) {
    setFilter(nextFilter);
    syncUrl(selectedUserId, nextFilter);
  }

  const thread = useMemo(
    () => threadsData?.threads.find((t) => t.user.id === selectedUserId),
    [threadsData, selectedUserId],
  );
  const collaborator = useMemo(
    () => collaboratorsData?.collaborators.find((c) => c.userId === selectedUserId),
    [collaboratorsData, selectedUserId],
  );

  const partner: ConversationPartner | null = useMemo(() => {
    if (!selectedUserId) return null;
    if (collaborator) {
      return {
        id: collaborator.userId,
        name: collaborator.name,
        email: collaborator.email,
        avatarUrl: collaborator.avatarUrl,
        lastSeenAt: collaborator.lastSeenAt,
        clickup: collaborator.clickup
          ? { username: collaborator.clickup.username, color: collaborator.clickup.color, initials: collaborator.clickup.initials }
          : null,
      };
    }
    if (thread) {
      return {
        id: thread.user.id,
        name: thread.user.name,
        email: null,
        avatarUrl: thread.user.avatarUrl,
        lastSeenAt: thread.user.lastSeenAt,
        clickup: null,
      };
    }
    return null;
  }, [selectedUserId, collaborator, thread]);

  const directoryLoaded = !threadsPending && !collaboratorsPending;

  if (directoryLoaded && (threadsError || collaboratorsError)) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <InlineSectionError
          message="Não conseguimos carregar suas mensagens."
          onRetry={() => {
            refetchThreads();
            refetchCollaborators();
          }}
        />
      </div>
    );
  }

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.25, ease: 'easeOut' as const };
  const panelInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 };
  const panelExit = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <MessagesSidebar
        selectedUserId={selectedUserId}
        onSelect={handleSelect}
        filter={filter}
        onFilterChange={handleFilterChange}
        pickerOpen={pickerOpen}
        onPickerOpenChange={setPickerOpen}
        className={cn(selectedUserId && 'hidden lg:flex')}
      />

      <div className={cn('relative grid min-h-0 min-w-0 flex-1', !selectedUserId && 'hidden lg:grid')}>
        <AnimatePresence initial={false}>
          {selectedUserId && partner ? (
            <motion.div
              key={selectedUserId}
              initial={panelInitial}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={panelExit}
              transition={transition}
              className="col-start-1 row-start-1 flex min-h-0 flex-col"
            >
              <ConversationView partner={partner} thread={thread} onBack={() => handleSelect(null)} />
            </motion.div>
          ) : selectedUserId && !directoryLoaded ? (
            <motion.div
              key="loading-partner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={panelExit}
              transition={transition}
              className="col-start-1 row-start-1 flex min-h-0 flex-col gap-3"
            >
              <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                <Skeleton className="size-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-12 w-1/2" />
              <Skeleton className="h-12 w-2/3" />
            </motion.div>
          ) : selectedUserId && !partner ? (
            <motion.div
              key="partner-not-found"
              initial={panelInitial}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={panelExit}
              transition={transition}
              className="col-start-1 row-start-1 flex min-h-0 flex-col items-center justify-center gap-3 text-center"
            >
              <MessageCircle size={22} className="text-nevoa" />
              <p className="text-sm font-medium text-branco-cru">Conversa não encontrada</p>
              <p className="max-w-xs text-xs text-nevoa">
                Este usuário não está mais no diretório de colaboradores.
              </p>
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="rounded-md border border-grafite-elevado bg-grafite px-3 py-1.5 text-xs font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
              >
                Voltar
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={panelInitial}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={panelExit}
              transition={transition}
              className="col-start-1 row-start-1 flex min-h-0 flex-col"
            >
              <MessagesEmptyState
                onNewConversation={() => setPickerOpen(true)}
                onFilterChange={handleFilterChange}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
