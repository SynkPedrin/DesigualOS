'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Link2Off, Loader2, MessageSquare } from 'lucide-react';
import { useClientClickUpTasks } from '@/hooks/use-client-clickup-tasks';
import { useClickUpTaskComments } from '@/hooks/use-clickup-task-comments';
import { ApiRequestError } from '@/lib/api/client';
import type { ClickUpTaskWire } from '@/lib/api/contracts';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** O ClickUp manda `date` como epoch em ms em string, não ISO. */
function commentTimeLabel(date: string): string {
  const millis = Number(date);
  if (!Number.isFinite(millis)) return '';
  return formatRelativeTime(new Date(millis).toISOString());
}

function TaskComments({ task }: { task: ClickUpTaskWire }) {
  const { data: comments, isPending, isError } = useClickUpTaskComments(task.id);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-grafite-elevado bg-carbono p-4">
      {isPending && (
        <p className="flex items-center gap-2 py-8 text-sm text-nevoa">
          <Loader2 size={15} className="animate-spin" /> Buscando comentários no ClickUp…
        </p>
      )}
      {isError && <p className="py-8 text-center text-sm text-erro">Não foi possível carregar os comentários.</p>}
      {comments && comments.length === 0 && (
        <p className="py-8 text-center text-sm text-nevoa">Nenhum comentário nessa tarefa ainda.</p>
      )}
      {comments && comments.length > 0 && (
        <ul className="space-y-3">
          {[...comments]
            .sort((a, b) => Number(a.date) - Number(b.date))
            .map((comment) => (
              <li key={comment.id} className="rounded-lg border border-grafite-elevado bg-grafite px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-branco-cru">{comment.username ?? 'ClickUp'}</span>
                  <span className="shrink-0 font-mono text-[10px] text-nevoa">{commentTimeLabel(comment.date)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-branco-cru/90">{comment.text}</p>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Aba Conversas do workspace do cliente: o chat de comentários das tarefas
 * do ClickUp daquele cliente, lido pela API na hora. Não confundir com as
 * conversas de agentes do Desigual OS.
 */
export function ClickUpTaskCommentsPanel({ clientId }: { clientId: string }) {
  const { data: tasks, isPending, error } = useClientClickUpTasks(clientId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    const firstTask = tasks?.at(0);
    if (!selectedTaskId && firstTask) {
      setSelectedTaskId(firstTask.id);
    }
  }, [tasks, selectedTaskId]);

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
  if (!tasks || tasks.length === 0) {
    return <p className="py-8 text-center text-sm text-nevoa">Nenhuma tarefa aberta pra puxar comentários.</p>;
  }

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks.at(0);
  if (!selectedTask) {
    return <p className="py-8 text-center text-sm text-nevoa">Nenhuma tarefa aberta pra puxar comentários.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => setSelectedTaskId(task.id)}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
              task.id === selectedTask.id
                ? 'border-roxo-eletrico/60 bg-grafite-elevado text-branco-cru'
                : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
            )}
          >
            <MessageSquare size={12} className="shrink-0" />
            <span className="truncate">{task.name}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="truncate font-mono text-[11px] text-nevoa">{selectedTask.name}</p>
        {selectedTask.url && (
          <a
            href={selectedTask.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
          >
            <ExternalLink size={13} /> Abrir no ClickUp
          </a>
        )}
      </div>

      <TaskComments key={selectedTask.id} task={selectedTask} />
    </div>
  );
}
