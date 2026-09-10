'use client';

import { CalendarDays, ExternalLink } from 'lucide-react';
import type { ClickUpPersonWire, ClickUpTaskWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/** Avatar real do ClickUp, com as iniciais/cor da própria conta como fallback. */
function PersonAvatar({ person, size = 24 }: { person: ClickUpPersonWire; size?: number }) {
  const initials = person.initials ?? person.name.slice(0, 2).toUpperCase();

  return (
    <span
      title={person.name}
      style={{ width: size, height: size, backgroundColor: person.avatar_url ? undefined : person.color ?? '#7C3AED' }}
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-carbono font-mono text-[9px] font-bold text-branco-cru"
    >
      {person.avatar_url ? (
        // <img> e não next/image: o host é attachments.clickup.com, fora do
        // loader configurado do Next.
        <img src={person.avatar_url} alt={person.name} className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

function dueLabel(iso: string | null): { text: string; late: boolean } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const late = due.getTime() < Date.now();
  return { text: due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), late };
}

/**
 * Linha de tarefa "igual no ClickUp": status com a cor real dele, prioridade,
 * tags, prazo (destacando atraso) e as FOTOS de quem está atribuído - pedido
 * do Endrigo pra bater o olho e saber de quem é.
 */
export function ClickUpTaskRow({ task, fallbackUrl }: { task: ClickUpTaskWire; fallbackUrl: string | null }) {
  const due = dueLabel(task.due_date);

  return (
    <a
      href={task.url ?? fallbackUrl ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-2 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-grafite-elevado hover:bg-carbono"
    >
      <div className="flex items-start gap-3">
        {task.status && (
          <span
            aria-hidden
            style={{ backgroundColor: task.status_color ?? '#87909e' }}
            className="mt-1.5 size-2 shrink-0 rounded-full"
          />
        )}
        <span className="min-w-0 flex-1 text-sm leading-snug text-branco-cru">{task.name}</span>

        {task.assignees.length > 0 ? (
          <span className="flex shrink-0 -space-x-1.5">
            {task.assignees.slice(0, 4).map((person) => (
              <PersonAvatar key={person.id} person={person} />
            ))}
            {task.assignees.length > 4 && (
              <span className="inline-flex size-6 items-center justify-center rounded-full border border-carbono bg-grafite-elevado font-mono text-[9px] text-nevoa">
                +{task.assignees.length - 4}
              </span>
            )}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[10px] text-nevoa">sem responsável</span>
        )}

        <ExternalLink size={13} className="mt-1 shrink-0 text-nevoa opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-5">
        {task.status && (
          <span
            style={{ color: task.status_color ?? undefined, borderColor: `${task.status_color ?? '#3f3f46'}66` }}
            className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
          >
            {task.status}
          </span>
        )}
        {task.priority && (
          <span
            style={{ color: task.priority_color ?? undefined, borderColor: `${task.priority_color ?? '#3f3f46'}66` }}
            className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase"
          >
            {task.priority}
          </span>
        )}
        {task.tags.map((tag) => (
          <span
            key={tag.name}
            style={{ backgroundColor: `${tag.background ?? '#3f3f46'}33`, color: tag.background ?? undefined }}
            className="rounded px-1.5 py-0.5 font-mono text-[10px]"
          >
            {tag.name}
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

      {task.description && (
        <p className="line-clamp-2 pl-5 text-[11px] leading-relaxed text-nevoa">{task.description}</p>
      )}
    </a>
  );
}
