'use client';

import { ExternalLink, Link2Off, Loader2 } from 'lucide-react';
import { ClickUpTaskRow } from './clickup-task-row';
import { useClientClickUpTasks } from '@/hooks/use-client-clickup-tasks';
import { ApiRequestError } from '@/lib/api/client';

/**
 * Tarefas do ClickUp de UM cliente — extraído do modal (era `TasksPanel`
 * privado de `client-detail-overlay.tsx`) pra ser reaproveitado também no
 * painel de contexto do Inbox (aba "Tarefas") sem duplicar a lógica.
 */
export function ClientTasksPanel({ clientId, clickupUrl }: { clientId: string; clickupUrl: string | null }) {
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
