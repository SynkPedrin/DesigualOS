'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Archive, ArchiveRestore, MessageCircle, Plus, Search, Star, X } from 'lucide-react';
import type { NodeStatus } from '@desigual-os/types';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useAgentNodeStatuses } from '@/components/chat/agent-spotlight';
import { CollaboratorAvatar } from './collaborator-avatar';
import { useMessageThreads } from '@/hooks/use-messages';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useUpdateThreadPrefs } from '@/hooks/use-update-thread-prefs';
import { useConversations } from '@/hooks/use-conversations';
import { useMe } from '@/hooks/use-me';
import { AGENT_META, FEATURED_AGENTS } from '@/lib/agent-meta';
import { isOnlineNow } from '@/lib/presence';
import { formatRelativeTime } from '@/lib/format';
import type { Collaborator, MessageThread } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

export type MessagesFilter = 'todas' | 'nao-lidas' | 'favoritas' | 'arquivadas';

const FILTER_TABS: Array<{ id: MessagesFilter; label: string }> = [
  { id: 'todas', label: 'Todas' },
  { id: 'nao-lidas', label: 'Não lidas' },
  { id: 'favoritas', label: 'Favoritas' },
  { id: 'arquivadas', label: 'Arquivadas' },
];

const AGENT_STATUS_DOT: Record<NodeStatus, string> = {
  online: 'bg-sucesso',
  busy: 'bg-info',
  rendering: 'bg-info',
  warning: 'bg-aviso',
  degraded: 'bg-aviso',
  offline: 'bg-erro',
  maintenance: 'bg-nevoa',
};

const COLLABORATORS_CAP = 6;

/** Busca client-side com debounce: filtra agentes (nome/papel), colaboradores
 * (nome/e-mail) e threads (nome do parceiro + conteúdo da última mensagem)
 * sem bater no backend a cada tecla. */
function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function matchesFilter(thread: MessageThread, filter: MessagesFilter): boolean {
  switch (filter) {
    case 'nao-lidas':
      return thread.unreadCount > 0;
    case 'favoritas':
      return thread.favorited;
    case 'arquivadas':
      return thread.archived;
    default:
      return !thread.archived;
  }
}

interface ThreadGroup {
  label: string;
  threads: MessageThread[];
}

/** Agrupa por recência usando o timestamp real da última mensagem. Favoritas
 * sempre no topo (Fixadas); o resto cai em Hoje/Ontem/Últimos 7 dias/Anteriores. */
function groupThreadsByRecency(threads: MessageThread[]): ThreadGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const groups: ThreadGroup[] = [];
  const pinned = threads.filter((thread) => thread.favorited);
  if (pinned.length > 0) groups.push({ label: 'Fixadas', threads: pinned });

  const buckets: Array<{ label: string; match: (ts: number) => boolean; threads: MessageThread[] }> = [
    { label: 'Hoje', match: (ts) => ts >= startOfToday, threads: [] },
    { label: 'Ontem', match: (ts) => ts >= startOfYesterday && ts < startOfToday, threads: [] },
    { label: 'Últimos 7 dias', match: (ts) => ts >= startOfWeek && ts < startOfYesterday, threads: [] },
    { label: 'Anteriores', match: (ts) => ts < startOfWeek, threads: [] },
  ];
  for (const thread of threads) {
    if (thread.favorited) continue;
    const ts = new Date(thread.lastMessage.createdAt).getTime();
    buckets.find((bucket) => bucket.match(ts))?.threads.push(thread);
  }
  for (const bucket of buckets) {
    if (bucket.threads.length > 0) groups.push({ label: bucket.label, threads: bucket.threads });
  }
  return groups;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-nevoa first:mt-0">{children}</p>
  );
}

/** Linha de agente de IA: foto real, papel, dot do status do nó (master-only -
 * sem dado, sem dot) e prévia da conversa mais recente daquele agente. */
function AgentRow({ agent, status }: { agent: (typeof FEATURED_AGENTS)[number]; status: NodeStatus | null }) {
  const router = useRouter();
  const meta = AGENT_META[agent];
  const { data: conversations } = useConversations(agent);
  const latest = conversations?.[0] ?? null;

  function handleClick() {
    const query = latest ? `?agent=${agent}&conversation=${latest.id}` : `?agent=${agent}`;
    router.push(`/chat${query}`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-grafite"
    >
      <span className="relative shrink-0">
        <AgentAvatar agent={agent} size="md" />
        {status && (
          <span
            className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-carbono', AGENT_STATUS_DOT[status])}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-branco-cru">{meta.label}</span>
          <span className="shrink-0 rounded border border-roxo-eletrico/30 bg-roxo-eletrico/10 px-1 font-mono text-[9px] uppercase tracking-wider text-violeta-sutil">
            Agente IA
          </span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-nevoa">
          {latest ? (latest.title ?? latest.lastMessagePreview ?? meta.role) : meta.role}
        </span>
      </span>
      {latest && (
        <span className="shrink-0 font-mono text-[10px] text-nevoa">{formatRelativeTime(latest.updatedAt)}</span>
      )}
    </button>
  );
}

function CollaboratorRow({
  collaborator,
  onSelect,
}: {
  collaborator: Collaborator;
  onSelect: () => void;
}) {
  const online = isOnlineNow(collaborator.lastSeenAt);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-grafite"
    >
      <CollaboratorAvatar
        name={collaborator.name}
        avatarUrl={collaborator.avatarUrl}
        clickupColor={collaborator.clickup?.color}
        clickupInitials={collaborator.clickup?.initials}
        online={online}
        size="md"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-branco-cru">{collaborator.name}</span>
          <span className="shrink-0 rounded border border-grafite-elevado bg-grafite px-1 font-mono text-[9px] uppercase tracking-wider text-nevoa">
            {collaborator.clickup ? 'Colaborador · ClickUp' : 'Colaborador'}
          </span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-nevoa">
          {online ? 'Online agora' : collaborator.lastSeenAt ? `Visto ${formatRelativeTime(collaborator.lastSeenAt).toLowerCase()}` : collaborator.email}
        </span>
      </span>
    </button>
  );
}

function ThreadRow({
  thread,
  collaborator,
  active,
  onSelect,
}: {
  thread: MessageThread;
  collaborator: Collaborator | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const updatePrefs = useUpdateThreadPrefs();
  const online = isOnlineNow(thread.user.lastSeenAt);

  function toggleFavorite(event: React.MouseEvent) {
    event.stopPropagation();
    updatePrefs.mutate({ partnerId: thread.user.id, favorite: !thread.favorited });
  }

  function toggleArchived(event: React.MouseEvent) {
    event.stopPropagation();
    updatePrefs.mutate({ partnerId: thread.user.id, archived: !thread.archived });
  }

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors',
        active ? 'bg-grafite-elevado' : 'hover:bg-grafite',
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-roxo-eletrico" aria-hidden />}
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <CollaboratorAvatar
          name={thread.user.name}
          avatarUrl={thread.user.avatarUrl}
          clickupColor={collaborator?.clickup?.color}
          clickupInitials={collaborator?.clickup?.initials}
          online={online}
          size="md"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-branco-cru">{thread.user.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-nevoa">
              {formatRelativeTime(thread.lastMessage.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[10px] text-nevoa">
              {thread.lastMessage.content ?? thread.lastMessage.attachmentFilename ?? 'Anexo'}
            </span>
            {thread.unreadCount > 0 && (
              <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-sinal font-mono text-[10px] font-semibold text-carbono">
                {thread.unreadCount}
              </span>
            )}
          </span>
        </span>
      </button>

      <span className="absolute right-2 top-1.5 hidden shrink-0 gap-0.5 rounded-md bg-grafite-elevado/95 p-0.5 group-hover:flex">
        <button
          type="button"
          onClick={toggleFavorite}
          aria-label={thread.favorited ? 'Remover dos favoritos' : 'Favoritar conversa'}
          title={thread.favorited ? 'Remover dos favoritos' : 'Favoritar conversa'}
          className={cn(
            'rounded p-1 transition-colors hover:bg-carbono',
            thread.favorited ? 'text-sinal' : 'text-nevoa hover:text-branco-cru',
          )}
        >
          <Star size={12} fill={thread.favorited ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          onClick={toggleArchived}
          aria-label={thread.archived ? 'Desarquivar conversa' : 'Arquivar conversa'}
          title={thread.archived ? 'Desarquivar conversa' : 'Arquivar conversa'}
          className="rounded p-1 text-nevoa transition-colors hover:bg-carbono hover:text-branco-cru"
        >
          {thread.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
        </button>
      </span>
    </div>
  );
}

const FILTER_EMPTY_STATES: Record<MessagesFilter, { title: string; description: string }> = {
  todas: { title: 'Nenhuma conversa ainda', description: 'Comece por "Nova mensagem" ou escolha um colaborador acima.' },
  'nao-lidas': { title: 'Tudo em dia', description: 'Nenhuma mensagem não lida no momento.' },
  favoritas: { title: 'Nenhuma favorita', description: 'Toque na estrela de uma conversa para fixá-la aqui.' },
  arquivadas: { title: 'Nada arquivado', description: 'Conversas arquivadas aparecem aqui.' },
};

export function MessagesSidebar({
  selectedUserId,
  onSelect,
  filter,
  onFilterChange,
  pickerOpen,
  onPickerOpenChange,
  className,
}: {
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  filter: MessagesFilter;
  onFilterChange: (filter: MessagesFilter) => void;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const { data: me } = useMe();
  const {
    data: threadsData,
    isPending: threadsPending,
    isError: threadsError,
    refetch: refetchThreads,
  } = useMessageThreads();
  const { data: collaboratorsData, isPending: collaboratorsPending } = useCollaborators();
  const agentStatuses = useAgentNodeStatuses();

  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim().toLowerCase(), 200);
  const [showAllCollaborators, setShowAllCollaborators] = useState(false);

  const threads = useMemo(() => threadsData?.threads ?? [], [threadsData]);
  const collaborators = useMemo(
    () => (collaboratorsData?.collaborators ?? []).filter((c) => c.userId !== me?.id),
    [collaboratorsData, me?.id],
  );
  const collaboratorById = useMemo(
    () => new Map(collaborators.map((c) => [c.userId, c])),
    [collaborators],
  );

  const visibleCollaborators = useMemo(() => {
    const sorted = [...collaborators].sort((a, b) => {
      const onlineDiff = Number(isOnlineNow(b.lastSeenAt)) - Number(isOnlineNow(a.lastSeenAt));
      return onlineDiff !== 0 ? onlineDiff : a.name.localeCompare(b.name, 'pt-BR');
    });
    const filtered = query
      ? sorted.filter((c) => c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query))
      : sorted;
    return filtered;
  }, [collaborators, query]);

  const cappedCollaborators = showAllCollaborators || query
    ? visibleCollaborators
    : visibleCollaborators.slice(0, COLLABORATORS_CAP);

  const visibleAgents = query
    ? FEATURED_AGENTS.filter((agent) => {
        const meta = AGENT_META[agent];
        return meta.label.toLowerCase().includes(query) || meta.role.toLowerCase().includes(query);
      })
    : [...FEATURED_AGENTS];

  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      if (!matchesFilter(thread, filter)) return false;
      if (!query) return true;
      return (
        thread.user.name.toLowerCase().includes(query) ||
        (thread.lastMessage.content ?? '').toLowerCase().includes(query)
      );
    });
  }, [threads, filter, query]);

  // Agrupamento por recência só no filtro "Todas" - nos demais a lista é curta
  // e filtrada por um critério, agrupar viraria ruído.
  const threadGroups = filter === 'todas' && !query ? groupThreadsByRecency(filteredThreads) : null;

  const hasAnyResult =
    visibleAgents.length > 0 || visibleCollaborators.length > 0 || filteredThreads.length > 0;

  return (
    <aside className={cn('w-full flex-col lg:w-80 lg:shrink-0 lg:border-r lg:border-grafite-elevado lg:pr-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold text-branco-cru">Mensagens</h2>
        {(threadsData?.totalUnread ?? 0) > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sinal px-1.5 font-mono text-[10px] font-semibold text-carbono">
            {threadsData!.totalUnread}
          </span>
        )}
      </div>

      <div className="relative mb-3">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar conversas..."
          aria-label="Buscar conversas"
          className="w-full rounded-md border border-grafite-elevado bg-grafite py-2 pl-9 pr-8 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-nevoa transition-colors hover:text-branco-cru"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="mb-1 flex gap-1" role="tablist" aria-label="Filtrar conversas">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => onFilterChange(tab.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
              filter === tab.id
                ? 'border-roxo-eletrico/50 bg-roxo-eletrico/10 text-branco-cru'
                : 'border-transparent text-nevoa hover:text-branco-cru',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onPickerOpenChange(!pickerOpen)}
        className="my-3 flex items-center justify-center gap-2 rounded-md border border-grafite-elevado bg-grafite py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
      >
        <Plus size={15} />
        Nova mensagem
      </button>

      {pickerOpen && (
        <div className="mb-3 max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-grafite-elevado bg-carbono p-2">
          {collaborators.length === 0 ? (
            <p className="px-2 py-2 text-xs text-nevoa">Nenhum colaborador disponível.</p>
          ) : (
            collaborators.map((collaborator) => (
              <button
                key={collaborator.userId}
                type="button"
                onClick={() => {
                  onSelect(collaborator.userId);
                  onPickerOpenChange(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
              >
                <CollaboratorAvatar
                  name={collaborator.name}
                  avatarUrl={collaborator.avatarUrl}
                  clickupColor={collaborator.clickup?.color}
                  clickupInitials={collaborator.clickup?.initials}
                  online={isOnlineNow(collaborator.lastSeenAt)}
                  size="sm"
                />
                <span className="truncate">{collaborator.name}</span>
              </button>
            ))
          )}
        </div>
      )}

      <motion.div
        key={`${filter}:${query}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex-1 overflow-y-auto pb-2"
      >
        {visibleAgents.length > 0 && (
          <section>
            <SectionLabel>Agentes de IA</SectionLabel>
            <div className="space-y-0.5">
              {visibleAgents.map((agent) => (
                <AgentRow key={agent} agent={agent} status={agentStatuses?.[agent] ?? null} />
              ))}
            </div>
          </section>
        )}

        {visibleCollaborators.length > 0 && (
          <section>
            <SectionLabel>Colaboradores</SectionLabel>
            {collaboratorsData && !collaboratorsData.clickupSynced && (
              <p className="mb-2 rounded-md border border-grafite-elevado bg-grafite px-2.5 py-2 font-mono text-[10px] leading-relaxed text-nevoa">
                Não foi possível sincronizar com o ClickUp - exibindo dados locais.
              </p>
            )}
            {collaboratorsPending ? (
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <div className="space-y-0.5">
                {cappedCollaborators.map((collaborator) => (
                  <CollaboratorRow
                    key={collaborator.userId}
                    collaborator={collaborator}
                    onSelect={() => onSelect(collaborator.userId)}
                  />
                ))}
                {visibleCollaborators.length > COLLABORATORS_CAP && !query && (
                  <button
                    type="button"
                    onClick={() => setShowAllCollaborators((current) => !current)}
                    className="w-full rounded-md px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
                  >
                    {showAllCollaborators ? 'Ver menos' : `Ver todos (${visibleCollaborators.length})`}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <section>
          <SectionLabel>Conversas</SectionLabel>
          {threadsPending ? (
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : threadsError ? (
            <div className="space-y-4">
              <EmptyState
                icon={MessageCircle}
                title="Não conseguimos carregar suas conversas."
                description="Verifique sua conexão e tente novamente."
              />
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => refetchThreads()}
                  className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-grafite-elevado px-4 py-8 text-center">
              <MessageCircle size={20} className="text-nevoa" />
              <p className="text-sm font-medium text-branco-cru">
                {query ? `Nada encontrado para "${search.trim()}"` : FILTER_EMPTY_STATES[filter].title}
              </p>
              {!query && <p className="text-xs text-nevoa">{FILTER_EMPTY_STATES[filter].description}</p>}
            </div>
          ) : threadGroups ? (
            threadGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <p className="mb-1 px-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-nevoa/70">{group.label}</p>
                <div className="space-y-0.5">
                  {group.threads.map((thread) => (
                    <ThreadRow
                      key={thread.user.id}
                      thread={thread}
                      collaborator={collaboratorById.get(thread.user.id)}
                      active={selectedUserId === thread.user.id}
                      onSelect={() => onSelect(thread.user.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-0.5">
              {filteredThreads.map((thread) => (
                <ThreadRow
                  key={thread.user.id}
                  thread={thread}
                  collaborator={collaboratorById.get(thread.user.id)}
                  active={selectedUserId === thread.user.id}
                  onSelect={() => onSelect(thread.user.id)}
                />
              ))}
            </div>
          )}
        </section>

        {!threadsPending && !hasAnyResult && (
          <p className="mt-4 px-2.5 text-center text-xs text-nevoa">
            Nenhum resultado para "{search.trim()}" em agentes, colaboradores ou conversas.
          </p>
        )}
      </motion.div>
    </aside>
  );
}
