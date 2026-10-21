'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import type { TaskActions } from './list-view';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Calendário mensal pelas datas de vencimento. Tarefa sem data aparece à parte, nunca some. */
export function CalendarView({ tarefas, actions }: { tarefas: WorkTaskWire[]; actions: TaskActions }) {
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const { dias, semData } = useMemo(() => {
    const inicio = new Date(ref); inicio.setDate(1 - inicio.getDay());
    const dias = Array.from({ length: 42 }, (_, i) => { const d = new Date(inicio); d.setDate(inicio.getDate() + i); return d; });
    const porDia = new Map<string, WorkTaskWire[]>();
    for (const t of tarefas) if (t.dueAt) { const k = new Date(t.dueAt).toDateString(); porDia.set(k, [...(porDia.get(k) ?? []), t]); }
    return { dias: dias.map((d) => ({ d, itens: porDia.get(d.toDateString()) ?? [] })), semData: tarefas.filter((t) => !t.dueAt) };
  }, [ref, tarefas]);
  const mover = (n: number) => setRef((r) => new Date(r.getFullYear(), r.getMonth() + n, 1));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => mover(-1)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><ChevronLeft size={16} /></button>
        <h3 className="w-40 text-center text-sm font-semibold capitalize text-branco-cru">{ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>
        <button type="button" aria-label="Próximo mês" onClick={() => mover(1)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><ChevronRight size={16} /></button>
        <button type="button" onClick={() => { const d = new Date(); d.setDate(1); setRef(d); }} className="rounded border border-grafite-elevado px-2 py-0.5 text-xs text-nevoa hover:text-branco-cru">Hoje</button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-grafite-elevado text-xs">
        {DIAS.map((d) => <div key={d} className="border-b border-grafite-elevado bg-grafite px-2 py-1 text-nevoa">{d}</div>)}
        {dias.map(({ d, itens }) => (
          <div key={d.toISOString()} className={cn('min-h-24 border-b border-r border-grafite-elevado/60 p-1', d.getMonth() !== ref.getMonth() && 'bg-grafite/40 text-nevoa/50', d.toDateString() === new Date().toDateString() && 'bg-sinal/5')}>
            <p className="mb-0.5 text-right text-[11px] text-nevoa">{d.getDate()}</p>
            {itens.slice(0, 3).map((t) => (
              <button key={t.id} type="button" onClick={() => actions.abrir(t)} title={t.title} className="mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-white" style={{ background: t.status?.color ?? '#6b7280' }}>{t.title}</button>
            ))}
            {itens.length > 3 && <p className="text-[10px] text-nevoa">+{itens.length - 3}</p>}
          </div>
        ))}
      </div>
      {semData.length > 0 && <p className="text-xs text-nevoa">{semData.length} tarefa(s) sem data de vencimento não aparecem no calendário.</p>}
    </div>
  );
}
