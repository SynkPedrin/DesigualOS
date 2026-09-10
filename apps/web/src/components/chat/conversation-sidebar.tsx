'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Lock,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  FolderInput,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { AgentName } from '@desigual-os/types';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useConversations, useDeleteConversation, useUpdateConversation } from '@/hooks/use-conversations';
import { useProjects } from '@/hooks/use-projects';
import { useClients } from '@/hooks/use-clients';
import { useMe } from '@/hooks/use-me';
import { useIsMaster } from '@/hooks/use-is-master';
import { formatRelativeTime } from '@/lib/format';
import type { ChatProject, ConversationSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/** Menu de overflow comum (conversa e projeto): fecha clicando fora. */
function useOverflowMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);
  return { open, setOpen, ref };
}

function menuButtonClass(danger = false) {
  return cn(
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
    danger ? 'text-erro hover:bg-carbono' : 'text-branco-cru hover:bg-carbono',
  );
}

function ConversationItem({
  conversation,
  projects,
  active,
  canWrite,
  onSelect,
  onDeleted,
}: {
  conversation: ConversationSummary;
  projects: ChatProject[];
  active: boolean;
  /** Só o dono (ou master) pode renomear/mover/excluir - mesmo gate do backend. */
  canWrite: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  const menu = useOverflowMenu();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(conversation.title ?? '');
  const updateConversation = useUpdateConversation();
  const deleteConversation = useDeleteConversation();

  function submitRename() {
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === conversation.title) return;
    updateConversation.mutate({ id: conversation.id, title: trimmed });
  }

  function handleDelete() {
    deleteConversation.mutate(conversation.id, { onSuccess: onDeleted });
    menu.setOpen(false);
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-grafite-elevado px-2 py-1.5">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitRename();
            if (event.key === 'Escape') setRenaming(false);
          }}
          className="min-w-0 flex-1 rounded border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <button type="button" onClick={submitRename} aria-label="Salvar nome" className="rounded p-1 text-sinal hover:bg-carbono">
          <Check size={13} />
        </button>
        <button type="button" onClick={() => setRenaming(false)} aria-label="Cancelar" className="rounded p-1 text-nevoa hover:bg-carbono">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2.5 rounded-md px-2.5 py-2.5 transition-colors',
        active ? 'bg-grafite-elevado' : 'hover:bg-grafite',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        {conversation.lastAgent ? (
          <AgentAvatar agent={conversation.lastAgent} size="sm" />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-grafite-elevado text-nevoa">
            <MessageCircle size={12} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm text-branco-cru">
            <span className="truncate">{conversation.title ?? conversation.lastMessagePreview ?? 'Nova conversa'}</span>
            {conversation.visibility === 'public' ? (
              <span title="Compartilhada com a equipe" className="flex shrink-0 items-center gap-1 rounded border border-sinal/30 px-1 font-mono text-[9px] uppercase tracking-wider text-sinal">
                <Users size={9} />
                Equipe
              </span>
            ) : (
              <Lock size={10} className="shrink-0 text-nevoa" aria-label="Privada" />
            )}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-nevoa">{formatRelativeTime(conversation.updatedAt)}</p>
        </div>
      </button>

      {canWrite && (
        <div ref={menu.ref} className="relative shrink-0">
          <button
            type="button"
            aria-label="Opções da conversa"
            onClick={() => {
              menu.setOpen(!menu.open);
              setMoving(false);
              setConfirmingDelete(false);
            }}
            className={cn(
              'rounded p-1 text-nevoa transition-all hover:bg-carbono hover:text-branco-cru',
              menu.open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <MoreHorizontal size={14} />
          </button>

          {menu.open && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-grafite-elevado bg-grafite-elevado p-1 shadow-elevated">
              <button
                type="button"
                className={menuButtonClass()}
                onClick={() => {
                  setName(conversation.title ?? '');
                  setRenaming(true);
                  menu.setOpen(false);
                }}
              >
                <Pencil size={12} />
                Renomear
              </button>
              <button type="button" className={menuButtonClass()} onClick={() => setMoving((current) => !current)}>
                <FolderInput size={12} />
                Mover para projeto
              </button>
              {moving && (
                <div className="ml-3 border-l border-grafite py-0.5 pl-1.5">
                  <button
                    type="button"
                    className={menuButtonClass()}
                    onClick={() => {
                      updateConversation.mutate({ id: conversation.id, project_id: null });
                      menu.setOpen(false);
                    }}
                  >
                    Sem projeto
                  </button>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={cn(menuButtonClass(), 'truncate')}
                      onClick={() => {
                        updateConversation.mutate({ id: conversation.id, project_id: project.id });
                        menu.setOpen(false);
                      }}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={menuButtonClass()}
                onClick={() => {
                  updateConversation.mutate({
                    id: conversation.id,
                    visibility: conversation.visibility === 'public' ? 'private' : 'public',
                  });
                  menu.setOpen(false);
                }}
              >
                {conversation.visibility === 'public' ? <Lock size={12} /> : <Users size={12} />}
                {conversation.visibility === 'public' ? 'Tornar privada' : 'Compartilhar com a equipe'}
              </button>
              {confirmingDelete ? (
                <button type="button" className={menuButtonClass(true)} onClick={handleDelete}>
                  <Trash2 size={12} />
                  Confirmar exclusão
                </button>
              ) : (
                <button type="button" className={menuButtonClass(true)} onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={12} />
                  Excluir
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Uma seção plana da sidebar (Compartilhadas / Minhas conversas). Substituiu a árvore de
 * projetos (ProjectSection, removida em 09/09/2026 a pedido do usuário: "retire projetos e
 * conversas recentes do sidebar" — a organização primária do Chat passa a ser público/privado,
 * não mais pasta por cliente). O vínculo conversa↔cliente/projeto continua existindo no banco
 * (resolveDefaultProjectForClient, context-engine) — só não aparece mais como navegação aqui;
 * "mover pra projeto" no menu de cada conversa (ConversationItem) continua funcionando pra quem
 * quiser arquivar manualmente.
 */
function ConversationSection({
  title,
  icon,
  conversations,
  allProjects,
  activeConversationId,
  currentUserId,
  isMaster,
  emptyLabel,
  onSelect,
  onConversationDeleted,
}: {
  title: string;
  icon: React.ReactNode;
  conversations: ConversationSummary[];
  allProjects: ChatProject[];
  activeConversationId: string | null;
  currentUserId: string | undefined;
  isMaster: boolean;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onConversationDeleted: (id: string) => void;
}) {
  return (
    <section>
      <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">
        {icon}
        {title}
        <span className="font-mono text-[10px] text-nevoa">{conversations.length}</span>
      </p>
      <div className="space-y-1">
        {conversations.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-nevoa">{emptyLabel}</p>
        ) : (
          conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              projects={allProjects}
              active={activeConversationId === conversation.id}
              canWrite={conversation.userId === currentUserId || isMaster}
              onSelect={() => onSelect(conversation.id)}
              onDeleted={() => onConversationDeleted(conversation.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function ConversationSidebar({
  agentFilter,
  clientFilter,
  activeConversationId,
  onSelect,
  onNewConversation,
  onDeleteConversation,
}: {
  agentFilter: AgentName | null;
  /** Cliente selecionado no ClientSelector: além de marcar conversas novas, também
   * restringe o histórico mostrado aqui. */
  clientFilter: string | null;
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}) {
  const {
    data: conversations,
    isPending,
    isError,
    refetch,
  } = useConversations(agentFilter, clientFilter);
  const { data: projects } = useProjects();
  const { data: clients } = useClients();
  const { data: me } = useMe();
  const { isMaster } = useIsMaster();
  const clientName = clientFilter ? clients?.find((c) => c.id === clientFilter)?.name : null;

  const allProjects = projects ?? [];
  // Organização primária do Chat (09/09/2026, pedido do usuário): público/privado, não mais
  // pasta por cliente. "Projetos" e a lista "Conversas" (não-arquivadas) saíram da sidebar —
  // "mover pra projeto" continua disponível no menu de cada conversa pra quem quiser arquivar,
  // e o vínculo automático conversa↔cliente (resolveDefaultProjectForClient) continua gravando
  // no banco, só não vira navegação aqui.
  const list = conversations ?? [];
  const publicList = list.filter((conversation) => conversation.visibility === 'public');
  const privateList = list.filter((conversation) => conversation.visibility !== 'public');

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

      {clientName && (
        <p className="mb-3 truncate font-mono text-[10px] uppercase tracking-wider text-nevoa">Filtrando · {clientName}</p>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto">
        {isPending ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)
        ) : isError ? (
          <div className="space-y-4">
            <EmptyState
              icon={MessageSquare}
              title="Não conseguimos carregar suas conversas."
              description="Verifique sua conexão e tente novamente."
            />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : (
          <>
            <ConversationSection
              title="Compartilhadas com a equipe"
              icon={<Users size={11} className="text-sinal" />}
              conversations={publicList}
              allProjects={allProjects}
              activeConversationId={activeConversationId}
              currentUserId={me?.id}
              isMaster={isMaster}
              emptyLabel="Nenhuma conversa pública ainda."
              onSelect={onSelect}
              onConversationDeleted={onDeleteConversation}
            />
            <ConversationSection
              title="Minhas conversas"
              icon={<Lock size={10} />}
              conversations={privateList}
              allProjects={allProjects}
              activeConversationId={activeConversationId}
              currentUserId={me?.id}
              isMaster={isMaster}
              emptyLabel={clientName ? `Ainda não tem conversa em ${clientName}.` : 'Comece uma nova conversa.'}
              onSelect={onSelect}
              onConversationDeleted={onDeleteConversation}
            />
          </>
        )}
      </div>
    </aside>
  );
}
