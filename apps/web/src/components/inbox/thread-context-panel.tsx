'use client';

import { useState } from 'react';
import { useInboxThread, useAssignInboxThread } from '@/hooks/use-inbox';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { ClientOverviewPanel } from '@/components/clients/client-overview-panel';
import { ClientDemandsPanel } from '@/components/clients/client-demands-panel';
import { ClientTasksPanel } from '@/components/clients/client-tasks-panel';
import { ClientStudioGallery } from '@/components/clients/client-studio-gallery';
import { cn } from '@/lib/utils';

const TABS = ['Visão geral', 'Demandas', 'Tarefas', 'Arquivos'] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  waiting_client: 'Aguardando cliente',
  waiting_agency: 'Aguardando agência',
  archived: 'Arquivada',
};

const CLIENT_STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'border-sinal/40 bg-sinal/10 text-sinal' },
  pontual: { label: 'Pontual', className: 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-roxo-eletrico' },
  onboarding: { label: 'Em onboarding', className: 'border-info/40 bg-info/10 text-info' },
  paused: { label: 'Em pausa', className: 'border-aviso/40 bg-aviso/10 text-aviso' },
  inactive: { label: 'Inativo', className: 'border-grafite-elevado bg-carbono text-nevoa' },
};

function SemCliente() {
  return (
    <p className="py-8 text-center text-sm text-nevoa">
      Esta conversa ainda não está vinculada a um cliente — atribua um responsável e o cliente certo pra ver isso aqui.
    </p>
  );
}

export function ThreadContextPanel({ threadId }: { threadId: string | null }) {
  const { data: thread } = useInboxThread(threadId);
  const { data: collaboratorsData } = useCollaborators();
  const assign = useAssignInboxThread(threadId ?? '');
  const { data: workspace } = useClientWorkspace(thread?.clientId ?? null);
  const [tab, setTab] = useState<Tab>('Visão geral');

  if (!threadId || !thread) {
    return <div className="p-4 text-sm text-nevoa">Nenhuma conversa selecionada.</div>;
  }

  const collaborators = collaboratorsData?.collaborators ?? [];
  const clientId = thread.clientId;
  const statusMeta = workspace?.client.status ? CLIENT_STATUS_META[workspace.client.status] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-4 p-4">
        <div className="flex items-center gap-3">
          <EntityAvatar name={thread.clientName ?? thread.contactName} kind="client" size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-branco-cru">{thread.clientName ?? 'Sem cliente vinculado'}</p>
            {statusMeta && (
              <span className={cn('mt-1 inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider', statusMeta.className)}>
                {statusMeta.label}
              </span>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-nevoa">Responsável</p>
          <select
            className="mt-1 w-full rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru"
            value={thread.assignedToUserId ?? ''}
            onChange={(e) => assign.mutate(e.target.value || null)}
          >
            <option value="">Não atribuída</option>
            {collaborators.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-nevoa">Canal</p>
            <p className="text-sm text-branco-cru">WhatsApp · {thread.contactPhone}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-nevoa">Status</p>
            <p className="text-sm text-branco-cru">{STATUS_LABEL[thread.status] ?? thread.status}</p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 border-y border-grafite-elevado px-2 py-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              tab === item ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'Visão geral' && (clientId ? <ClientOverviewPanel clientId={clientId} /> : <SemCliente />)}
        {tab === 'Demandas' && (clientId ? <ClientDemandsPanel clientId={clientId} conversationThreadId={thread.id} /> : <SemCliente />)}
        {tab === 'Tarefas' && (clientId ? <ClientTasksPanel clientId={clientId} clickupUrl={workspace?.client.clickupUrl ?? null} /> : <SemCliente />)}
        {tab === 'Arquivos' && (clientId ? <ClientStudioGallery clientId={clientId} /> : <SemCliente />)}
      </div>
    </div>
  );
}
