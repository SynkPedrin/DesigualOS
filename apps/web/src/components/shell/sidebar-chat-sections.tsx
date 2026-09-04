'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { FolderClosed, MessageCircle, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversations } from '@/hooks/use-conversations';
import { useProjects } from '@/hooks/use-projects';
import { AGENT_META } from '@/lib/agent-meta';
import { cn } from '@/lib/utils';
import { CreateProjectModal } from '@/components/chat/create-project-modal';

const MAX_PROJECTS = 5;
const MAX_CONVERSATIONS = 7;

const sectionLabelClass = 'font-mono text-[10px] uppercase tracking-wider text-nevoa';

function rowClass(active: boolean) {
  return cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
    active ? 'bg-grafite text-branco-cru' : 'text-nevoa hover:bg-grafite/60 hover:text-branco-cru',
  );
}

/**
 * Organização estilo Claude na sidebar global: PROJETOS e CONVERSAS RECENTES
 * abaixo da nav principal. Dados reais (useProjects / useConversations, este com
 * polling de 10s) — o /chat em si não tem mais rail próprio, então a navegação
 * entre conversas acontece daqui via deep links (?conversation= / ?project=).
 *
 * Usa useSearchParams (destaque do item ativo), então quem renderiza precisa
 * envolver em <Suspense> — sem isso o build estático das páginas do shell falha.
 */
export function SidebarChatSections() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeConversationId = pathname === '/chat' ? searchParams.get('conversation') : null;
  const activeProjectId = pathname === '/chat' ? searchParams.get('project') : null;

  const { data: projects, isPending: projectsPending } = useProjects();
  const { data: conversations, isPending: conversationsPending } = useConversations(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const visibleProjects = (projects ?? []).slice(0, MAX_PROJECTS);
  const recentConversations = [...(conversations ?? [])]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_CONVERSATIONS);

  return (
    <div className="mt-5 space-y-5 pb-2">
      <section aria-label="Projetos">
        <div className="mb-1 flex items-center justify-between px-2">
          <p className={sectionLabelClass}>Projetos</p>
          <button
            type="button"
            onClick={() => setCreateProjectOpen(true)}
            aria-label="Criar projeto"
            title="Criar projeto"
            className="flex size-5 items-center justify-center rounded text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
          >
            <Plus size={13} />
          </button>
        </div>
        {projectsPending ? (
          <div className="space-y-1 px-1">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ) : visibleProjects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-nevoa">Nenhum projeto ainda.</p>
        ) : (
          <ul className="space-y-0.5">
            {visibleProjects.map((project) => (
              <li key={project.id}>
                <Link href={`/chat?project=${project.id}`} className={rowClass(activeProjectId === project.id)}>
                  <FolderClosed size={14} className="shrink-0 text-sinal" />
                  <span className="truncate">{project.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(projects?.length ?? 0) > MAX_PROJECTS && (
          <Link
            href="/history"
            className="mt-1 block rounded-md px-2 py-1 text-xs text-nevoa transition-colors hover:text-branco-cru"
          >
            Ver todos
          </Link>
        )}
      </section>

      <section aria-label="Conversas recentes">
        <p className={cn(sectionLabelClass, 'mb-1 px-2')}>Conversas recentes</p>
        {conversationsPending ? (
          <div className="space-y-1 px-1">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ) : recentConversations.length === 0 ? (
          <p className="px-2 py-1 text-xs text-nevoa">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="space-y-0.5">
            {recentConversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/chat?conversation=${conversation.id}`}
                  aria-current={activeConversationId === conversation.id ? 'page' : undefined}
                  className={rowClass(activeConversationId === conversation.id)}
                >
                  {conversation.lastAgent ? (
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', AGENT_META[conversation.lastAgent].bgClass)}
                    />
                  ) : (
                    <MessageCircle size={13} className="shrink-0" />
                  )}
                  <span className="truncate">
                    {conversation.title ?? conversation.lastMessagePreview ?? 'Nova conversa'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {createProjectOpen && <CreateProjectModal onClose={() => setCreateProjectOpen(false)} />}
    </div>
  );
}
