'use client';

import { CalendarDays, ExternalLink } from 'lucide-react';
import type { AgencyTaskWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

function dueLabel(ms: number | null): { text: string; late: boolean } | null {
  if (!ms) return null;
  const late = ms < Date.now();
  return { text: new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), late };
}

/**
 * Linha de tarefa da Central de Tasks (agência inteira / minhas tarefas).
 * Formato mais simples que ClickUpTaskRow (por cliente): a consulta de
 * operação inteira (GET /team/{id}/task) não devolve cor de status/prioridade
 * nem foto do responsável, só texto - ver AgencyTaskWire.
 */
export function AgencyTaskRow({ task, showClient }: { task: AgencyTaskWire; showClient: boolean }) {
  const due = dueLabel(task.due_date);

  return (
    <a
      href={task.url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-1.5 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-grafite-elevado hover:bg-carbono"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-nevoa/50" />
        <span className="min-w-0 flex-1 text-sm leading-snug text-branco-cru">{task.name}</span>
        {showClient && task.client && (
          <span className="shrink-0 rounded border border-grafite-elevado px-1.5 py-0.5 font-mono text-[10px] text-nevoa">
            {task.client.name}
          </span>
        )}
        <ExternalLink size={13} className="mt-1 shrink-0 text-nevoa opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-5">
        {task.status && (
          <span className="rounded border border-grafite-elevado px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">
            {task.status}
          </span>
        )}
        {task.priority && (
          <span className="rounded border border-grafite-elevado px-1.5 py-0.5 font-mono text-[10px] uppercase text-nevoa">
            {task.priority}
          </span>
        )}
        {task.assignees.slice(0, 3).map((assignee) => (
          <span key={assignee} className="rounded bg-grafite-elevado px-1.5 py-0.5 font-mono text-[10px] text-nevoa">
            {assignee}
          </span>
        ))}
        {task.tags.map((tag) => (
          <span key={tag} className="rounded bg-grafite-elevado px-1.5 py-0.5 font-mono text-[10px] text-nevoa">
            {tag}
          </span>
        ))}
        {due && (
          <span className={cn('inline-flex items-center gap-1 font-mono text-[10px]', due.late ? 'text-erro' : 'text-nevoa')}>
            <CalendarDays size={10} />
            {due.text}
            {due.late && ' · atrasada'}
          </span>
        )}
      </div>

      {task.description && <p className="line-clamp-2 pl-5 text-[11px] leading-relaxed text-nevoa">{task.description}</p>}
    </a>
  );
}
