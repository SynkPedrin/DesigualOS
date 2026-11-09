'use client';

import { urgenciaDoPrazo } from '@/lib/prazo';
import { faixaDaLinha, Prazo } from '@/components/ui/prazo';
import { CalendarDays, UserRound } from 'lucide-react';
import type { AgencyTaskWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';
import { tarefaConcluida } from '@/lib/tarefa-concluida';


const SEM_STATUS = 'Sem status';

// Tarefa concluída (pronto/encerrado) nunca está atrasada, por mais velho que seja o prazo.
function dueLabel(ms: number | null, concluida: boolean): { text: string; late: boolean; concluida: boolean } | null {
  if (!ms) return null;
  const late = !concluida && ms < Date.now();
  return { text: new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), late, concluida };
}

function TaskKanbanCard({ task, showClient }: { task: AgencyTaskWire; showClient: boolean }) {
  const due = dueLabel(task.due_date, tarefaConcluida(task));
  const donos = task.assignees.filter((a) => a.trim().length > 0);

  return (
    <a
      href={task.url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className={cn('flex flex-col gap-2 rounded-lg border border-grafite-elevado bg-carbono p-3 transition-colors hover:border-roxo-eletrico/60', !due?.concluida && faixaDaLinha(urgenciaDoPrazo(task.due_date)))}
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
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-nevoa">
          <CalendarDays size={12} />
          {due.text}
          <Prazo prazo={task.due_date} feito={due.concluida} />
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
