'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ExternalLink, Link2Off, Loader2, MessageCircle, X } from 'lucide-react';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { useIsMaster } from '@/hooks/use-is-master';
import { GrantAccessForm } from './grant-access-form';
import { ClickUpTaskRow } from './clickup-task-row';
import { ClickUpTaskCommentsPanel } from './clickup-task-comments';
import { ClientOverviewPanel } from './client-overview-panel';
import { ClientStudioGallery } from './client-studio-gallery';
import { useClientClickUpTasks } from '@/hooks/use-client-clickup-tasks';
import { ApiRequestError } from '@/lib/api/client';
import type { ClientSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const BASE_TABS = ['ClickUp', 'Visão Geral', 'Conversas', 'Studio'] as const;
/** "Acesso" só pra master - mesma regra da tela antiga, não afrouxa nada. */
const MASTER_TABS = [...BASE_TABS, 'Acesso'] as const;
type Tab = (typeof MASTER_TABS)[number];

function TasksPanel({ clientId, clickupUrl }: { clientId: string; clickupUrl: string | null }) {
  const { data: tasks, isPending, error } = useClientClickUpTasks(clientId);

  if (error instanceof ApiRequestError && error.status === 409) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Link2Off size={22} className="text-nevoa" />
        <p className="text-sm text-branco-cru">Cliente ainda não vinculado ao ClickUp</p>
        <p className="max-w-sm text-xs text-nevoa">Rode a importação em Configurações → Integrações.</p>
      </div>
    );
  }
  if (isPending) {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-nevoa">
        <Loader2 size={15} className="animate-spin" /> Buscando tarefas no ClickUp…
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-nevoa">{tasks?.length ?? 0} tarefa(s) · lido do ClickUp agora</p>
        {clickupUrl && (
          <a
            href={clickupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
          >
            <ExternalLink size={13} /> Abrir no ClickUp
          </a>
        )}
      </div>
      {!tasks || tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-nevoa">Nenhuma tarefa aberta.</p>
      ) : (
        <div className="space-y-0.5">
          {tasks.map((task) => (
            <ClickUpTaskRow key={task.id} task={task} fallbackUrl={clickupUrl} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O card clicado "sobe, vira e dá zoom" até virar a ficha inteira do cliente.
 * `layoutId` casa com o card da roleta: o Framer Motion interpola posição e
 * tamanho entre os dois, então é o MESMO card crescendo, não um modal que
 * aparece por cima. rotateX no início é o "virar" saindo do tombo da roleta.
 */
export function ClientDetailOverlay({ client, onClose }: { client: ClientSummary; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('ClickUp');
  const { isMaster } = useIsMaster();
  const tabs: readonly Tab[] = isMaster ? MASTER_TABS : BASE_TABS;
  const { data: workspace } = useClientWorkspace(client.id);
  const clickupUrl = workspace?.client.clickupUrl ?? client.clickupUrl;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-carbono/85 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        layoutId={`client-card-${client.id}`}
        onClick={(event) => event.stopPropagation()}
        initial={{ rotateX: 35, y: 60 }}
        animate={{ rotateX: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        style={{ transformStyle: 'preserve-3d', perspective: 1200 }}
        className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-grafite-elevado bg-grafite shadow-elevated"
      >
        <div className="flex items-start justify-between gap-4 border-b border-grafite-elevado p-6">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-2xl font-bold text-branco-cru">{client.name}</h2>
            <p className="mt-1 font-mono text-[11px] text-nevoa">
              {client.status} · {client.clickupListId ? `lista ${client.clickupListId}` : 'sem vínculo no ClickUp'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {workspace?.projectId && (
              <Link
                href={`/chat?project=${workspace.projectId}`}
                className="flex items-center gap-1.5 rounded-md border border-roxo-eletrico/40 bg-roxo-eletrico/10 px-3 py-1.5 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/70"
              >
                <MessageCircle size={14} />
                Abrir chat
              </Link>
            )}
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-grafite-elevado px-6 py-3">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === item ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru',
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === 'ClickUp' && <TasksPanel clientId={client.id} clickupUrl={clickupUrl} />}

          {tab === 'Visão Geral' && <ClientOverviewPanel clientId={client.id} />}

          {tab === 'Conversas' && <ClickUpTaskCommentsPanel clientId={client.id} />}

          {tab === 'Studio' && <ClientStudioGallery clientId={client.id} />}

          {tab === 'Acesso' && isMaster && <GrantAccessForm clientId={client.id} />}
        </div>
      </motion.div>
    </motion.div>
  );
}
