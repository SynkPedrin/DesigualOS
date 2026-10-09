'use client';

import { CalendarDays, UserRound } from 'lucide-react';
import type { AgencyTaskWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const SEM_STATUS = 'Sem status';

function dueLabel(ms: number | null): { text: string; late: boolean } | null {
  if (!ms) return null;
  const late = ms < Date.now();
  return { text: new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), late };
}

function TaskKanbanCard({ task, showClient }: { task: AgencyTaskWire; showClient: boolean }) {
  const due = dueLabel(task.due_date);
  const donos = task.assignees.filter((a) => a.trim().length > 0);

  return (
    <a
      href={task.url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-2 rounded-lg border border-grafite-elevado bg-carbono p-3 transition-colors hover:border-roxo-eletrico/60"
    >
      <p className="text-[13px] font-medium leading-snug text-branco-cru">{task.name}</p>
      {showClient && task.client && <p className="text-[11px] text-nevoa">{task.client.name}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <UserRound size={12} className={donos.length === 0 ? 'text-aviso' : 'text-nevoa'} />
        <span className={cn('text-[11px]', donos.length === 0 ? 'text-aviso' : 'text-nevoa')}>
          {donos.length === 0 ? 'sem responsável' : donos.join(', ')}
        </span>
      </div>
      {due && (
        <span className={cn('flex items-center gap-1 text-[11px]', due.late ? 'font-medium text-erro' : 'text-nevoa')}>
          <CalendarDays size={12} />
          {due.late ? `atrasada desde ${due.text}` : due.text}
        </span>
      )}
    </a>
  );
}

/**
 * Agrupa pelo status CRU do ClickUp (não um enum fixo nosso) — cada lista do
 * ClickUp define seus próprios status, e inventar colunas padronizadas
 * mostraria uma coluna vazia pra todo mundo que usa nomes diferentes. A ordem
 * é a ordem em que os status aparecem nas tarefas (primeira ocorrência),
 * então colunas custom ficam juntas de quem as criou, não ordenadas à toa.
 */
export function TaskKanbanBoard({ tasks, showClient }: { tasks: AgencyTaskWire[]; showClient: boolean }) {
  const colunas = new Map<string, AgencyTaskWire[]>();
  for (const task of tasks) {
    const chave = task.status ?? SEM_STATUS;
    const lista = colunas.get(chave) ?? [];
    lista.push(task);
    colunas.set(chave, lista);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {[...colunas.entries()].map(([status, tasksDoStatus]) => (
        <div key={status} className="flex w-72 shrink-0 flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-nevoa">{status}</h3>
            <span className="rounded-full bg-grafite-elevado px-2 py-0.5 text-[11px] text-nevoa">{tasksDoStatus.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {tasksDoStatus.map((task) => (
              <TaskKanbanCard key={task.id} task={task} showClient={showClient} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
