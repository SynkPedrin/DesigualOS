'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderClosed,
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
import { useDeleteProject, useProjects, useUpdateProject } from '@/hooks/use-projects';
import { useClients } from '@/hooks/use-clients';
import { useMe } from '@/hooks/use-me';
import { useIsMaster } from '@/hooks/use-is-master';
import { formatRelativeTime } from '@/lib/format';
import type { ChatProject, ConversationSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';
import { CreateProjectModal } from './create-project-modal';

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
  /** Só o dono (ou master) pode renomear/mover/excluir — mesmo gate do backend. */
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

function ProjectSection({
  project,
  conversations,
  allProjects,
  activeConversationId,
  expanded,
  onToggle,
  currentUserId,
  isMaster,
  onSelect,
  onConversationDeleted,
}: {
  project: ChatProject;
  conversations: ConversationSummary[];
  allProjects: ChatProject[];
  activeConversationId: string | null;
  expanded: boolean;
  onToggle: () => void;
  currentUserId: string | undefined;
  isMaster: boolean;
  onSelect: (id: string) => void;
  onConversationDeleted: (id: string) => void;
}) {
  const menu = useOverflowMenu();
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(project.name);
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  function submitRename() {
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === project.name) return;
    updateProject.mutate({ id: project.id, name: trimmed });
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
        <button type="button" onClick={submitRename} aria-label="Salvar nome do projeto" className="rounded p-1 text-sinal hover:bg-carbono">
          <Check size={13} />
        </button>
        <button type="button" onClick={() => setRenaming(false)} aria-label="Cancelar" className="rounded p-1 text-nevoa hover:bg-carbono">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-grafite">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left">
          {expanded ? <ChevronDown size={13} className="shrink-0 text-nevoa" /> : <ChevronRight size={13} className="shrink-0 text-nevoa" />}
          <FolderClosed size={13} className="shrink-0 text-sinal" />
          <span className="truncate text-sm text-branco-cru">{project.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-nevoa">{conversations.length}</span>
        </button>

        <div ref={menu.ref} className="relative shrink-0">
          <button
            type="button"
            aria-label="Opções do projeto"
            onClick={() => {
              menu.setOpen(!menu.open);
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
                  setName(project.name);
                  setRenaming(true);
                  menu.setOpen(false);
                }}
              >
                <Pencil size={12} />
                Renomear projeto
              </button>
              {confirmingDelete ? (
                <button
                  type="button"
                  className={menuButtonClass(true)}
                  onClick={() => {
                    deleteProject.mutate(project.id);
                    menu.setOpen(false);
                  }}
                >
                  <Trash2 size={12} />
                  Confirmar (conversas ficam soltas)
                </button>
              ) : (
                <button type="button" className={menuButtonClass(true)} onClick={() => setConfirmingDelete(true)}>
                  <Trash2 size={12} />
                  Excluir projeto
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="ml-4 space-y-1 border-l border-grafite-elevado pl-1.5">
          {conversations.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-nevoa">Sem conversas aqui ainda.</p>
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
      )}
    </div>
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
  const { data: conversations, isPending } = useConversations(agentFilter, clientFilter);
  const { data: projects } = useProjects();
  const { data: clients } = useClients();
  const { data: me } = useMe();
  const { isMaster } = useIsMaster();
  const clientName = clientFilter ? clients?.find((c) => c.id === clientFilter)?.name : null;

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  const allProjects = projects ?? [];
  const unfiled = (conversations ?? []).filter((conversation) => !conversation.projectId);
  const conversationsByProject = new Map<string, ConversationSummary[]>();
  for (const conversation of conversations ?? []) {
    if (!conversation.projectId) continue;
    const list = conversationsByProject.get(conversation.projectId) ?? [];
    list.push(conversation);
    conversationsByProject.set(conversation.projectId, list);
  }

  // Expandido por padrão; o clique colapsa. Projeto da conversa aberta nunca
  // fica colapsado, senão a seleção some da vista.
  function isExpanded(projectId: string) {
    const containsActive = (conversationsByProject.get(projectId) ?? []).some((c) => c.id === activeConversationId);
    return containsActive || !collapsedProjects[projectId];
  }

  const visibleProjects = allProjects.filter(
    (project) => !clientFilter || project.clientId === clientFilter || (conversationsByProject.get(project.id)?.length ?? 0) > 0,
  );

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

      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Projetos</p>
        <button
          type="button"
          onClick={() => setCreateProjectOpen(true)}
          aria-label="Criar projeto"
          title="Criar projeto"
          className="flex items-center gap-1 rounded-md border border-grafite-elevado bg-grafite px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
        >
          <Plus size={11} />
          Novo
        </button>
      </div>

      <div className="mb-3 space-y-0.5">
        {visibleProjects.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-nevoa">Nenhum projeto ainda.</p>
        ) : (
          visibleProjects.map((project) => (
            <ProjectSection
              key={project.id}
              project={project}
              conversations={conversationsByProject.get(project.id) ?? []}
              allProjects={allProjects}
              activeConversationId={activeConversationId}
              expanded={isExpanded(project.id)}
              onToggle={() => setCollapsedProjects((current) => ({ ...current, [project.id]: !current[project.id] }))}
              currentUserId={me?.id}
              isMaster={isMaster}
              onSelect={onSelect}
              onConversationDeleted={onDeleteConversation}
            />
          ))
        )}
      </div>

      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">
        {clientName ? `Conversas · ${clientName}` : 'Conversas'}
      </p>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {isPending ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)
        ) : unfiled.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma conversa"
            description={clientName ? `Ainda não tem conversa em ${clientName}.` : 'Comece uma nova conversa.'}
          />
        ) : (
          unfiled.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              projects={allProjects}
              active={activeConversationId === conversation.id}
              canWrite={conversation.userId === me?.id || isMaster}
              onSelect={() => onSelect(conversation.id)}
              onDeleted={() => onDeleteConversation(conversation.id)}
            />
          ))
        )}
      </div>

      {createProjectOpen && <CreateProjectModal onClose={() => setCreateProjectOpen(false)} />}
    </aside>
  );
}
