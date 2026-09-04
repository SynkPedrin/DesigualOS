'use client';

import { useState } from 'react';
import { ExternalLink, Link2Off, Loader2, Send } from 'lucide-react';
import { useClientClickUpTasks } from '@/hooks/use-client-clickup-tasks';
import { useClientClickUpComments, usePostClickUpTaskComment } from '@/hooks/use-client-clickup-comments';
import { ApiRequestError } from '@/lib/api/client';
import type { ClickUpClientCommentWire, ClickUpTaskWire } from '@/lib/api/contracts';
import { formatRelativeTime } from '@/lib/format';

/** O ClickUp manda `date` como epoch em ms em string, não ISO. */
function commentTimeLabel(date: string): string {
  const millis = Number(date);
  if (!Number.isFinite(millis)) return '';
  return formatRelativeTime(new Date(millis).toISOString());
}

function CommentCard({ comment }: { comment: ClickUpClientCommentWire }) {
  return (
    <li className="rounded-lg border border-grafite-elevado bg-grafite px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold text-branco-cru">{comment.username ?? 'ClickUp'}</span>
        <span className="shrink-0 font-mono text-[10px] text-nevoa">{commentTimeLabel(comment.date)}</span>
      </div>
      {comment.task_url ? (
        <a
          href={comment.task_url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex max-w-full items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-roxo-eletrico hover:underline"
        >
          <span className="truncate">{comment.task_name}</span>
          <ExternalLink size={10} className="shrink-0" />
        </a>
      ) : (
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-nevoa">{comment.task_name}</p>
      )}
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-branco-cru/90">{comment.text}</p>
    </li>
  );
}

function CommentComposer({ tasks, clientId }: { tasks: ClickUpTaskWire[]; clientId: string }) {
  const [taskId, setTaskId] = useState<string>(tasks.at(0)?.id ?? '');
  const [text, setText] = useState('');
  // tasks chegam depois do primeiro render; se o select ainda não tem valor,
  // cai na primeira tarefa disponível sem zerar uma escolha já feita.
  const effectiveTaskId = taskId || tasks.at(0)?.id || '';
  const postComment = usePostClickUpTaskComment(clientId);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !effectiveTaskId) return;
    await postComment.mutateAsync({ taskId: effectiveTaskId, text: trimmed });
    setText('');
  }

  return (
    <form onSubmit={handleSubmit} className="shrink-0 space-y-2 rounded-lg border border-grafite-elevado bg-carbono p-3">
      <div className="flex items-center gap-2">
        <label htmlFor="clickup-comment-task" className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-nevoa">
          Comentar em
        </label>
        <select
          id="clickup-comment-task"
          value={effectiveTaskId}
          onChange={(event) => setTaskId(event.target.value)}
          className="min-w-0 flex-1 truncate rounded-md border border-grafite-elevado bg-grafite px-2 py-1.5 text-xs text-branco-cru"
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Escreva um comentário pro ClickUp…"
          rows={2}
          className="min-w-0 flex-1 resize-none rounded-md border border-grafite-elevado bg-grafite px-2 py-1.5 text-sm text-branco-cru placeholder:text-nevoa"
        />
        <button
          type="submit"
          disabled={!text.trim() || !effectiveTaskId || postComment.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sinal px-3 py-2 text-xs font-semibold text-carbono transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {postComment.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Enviar
        </button>
      </div>
      {postComment.isError && <p className="text-xs text-erro">Não foi possível postar o comentário. Tente de novo.</p>}
    </form>
  );
}

/**
 * Aba Conversas do workspace do cliente: TODOS os comentários das tarefas do
 * ClickUp daquele cliente numa thread só (pedido do usuário), mais o composer
 * que posta de verdade na tarefa escolhida. Não confundir com as conversas
 * de agentes do Desigual OS.
 */
export function ClickUpTaskCommentsPanel({ clientId }: { clientId: string }) {
  const { data: comments, isPending, isError, error } = useClientClickUpComments(clientId);
  const { data: tasks } = useClientClickUpTasks(clientId);

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
        <Loader2 size={15} className="animate-spin" /> Buscando comentários no ClickUp…
      </p>
    );
  }
  if (isError) {
    return <p className="py-8 text-center text-sm text-erro">Não foi possível carregar os comentários.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="font-mono text-[11px] text-nevoa">
        {comments.length} comentário(s) · lido do ClickUp agora · atualiza sozinho a cada minuto
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-sm text-nevoa">Nenhum comentário nas tarefas deste cliente ainda.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
      </div>

      {tasks && tasks.length > 0 && <CommentComposer tasks={tasks} clientId={clientId} />}
    </div>
  );
}
