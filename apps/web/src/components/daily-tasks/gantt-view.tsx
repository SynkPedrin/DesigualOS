'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkTaskWire } from '@/hooks/use-work';
import type { TaskActions } from './list-view';

const DIA = 28;
const DIAS_VISIVEIS = 90;
const MS_DIA = 86_400_000;
const inicioDoDia = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };

/** Linha do tempo: cada tarefa com data vira uma barra do início ao vencimento; a linha vermelha é hoje. Sem data = fica de fora (e é avisado). */
export function GanttView({ tarefas, actions }: { tarefas: WorkTaskWire[]; actions: TaskActions }) {
  const [deslocamento, setDeslocamento] = useState(0);
  const inicio = useMemo(() => new Date(inicioDoDia(new Date()).getTime() + (deslocamento - 14) * MS_DIA), [deslocamento]);
  const comData = useMemo(() => tarefas.filter((t) => t.dueAt || t.startAt).sort((a, b) => new Date(a.startAt ?? a.dueAt!).getTime() - new Date(b.startAt ?? b.dueAt!).getTime()).slice(0, 300), [tarefas]);
  const semData = tarefas.length - tarefas.filter((t) => t.dueAt || t.startAt).length;
  const dias = Array.from({ length: DIAS_VISIVEIS }, (_, i) => new Date(inicio.getTime() + i * MS_DIA));
  const hoje = Math.floor((inicioDoDia(new Date()).getTime() - inicio.getTime()) / MS_DIA);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Voltar 30 dias" onClick={() => setDeslocamento((d) => d - 30)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setDeslocamento(0)} className="rounded border border-grafite-elevado px-2 py-0.5 text-xs text-nevoa hover:text-branco-cru">Hoje</button>
        <button type="button" aria-label="Avançar 30 dias" onClick={() => setDeslocamento((d) => d + 30)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><ChevronRight size={16} /></button>
        {semData > 0 && <span className="text-xs text-nevoa">{semData} tarefa(s) sem data não aparecem aqui.</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-grafite-elevado">
        <div style={{ width: 220 + DIAS_VISIVEIS * DIA }} className="relative">
          <div className="sticky top-0 z-10 flex border-b border-grafite-elevado bg-grafite text-[10px] text-nevoa">
            <div className="sticky left-0 z-10 w-[220px] shrink-0 bg-grafite px-2 py-1">Tarefa</div>
            {dias.map((d, i) => (
              <div key={i} style={{ width: DIA }} className={`shrink-0 border-l border-grafite-elevado/50 py-1 text-center ${d.getDay() === 0 || d.getDay() === 6 ? 'bg-grafite-elevado/40' : ''}`}>
                {d.getDate() === 1 || i === 0 ? <span className="block font-semibold">{d.toLocaleDateString('pt-BR', { month: 'short' })}</span> : <span className="block opacity-0">.</span>}
                {d.getDate()}
              </div>
            ))}
          </div>
          {comData.map((t) => {
            const ini = inicioDoDia(new Date(t.startAt ?? t.dueAt!));
            const fim = inicioDoDia(new Date(t.dueAt ?? t.startAt!));
            const x = Math.floor((ini.getTime() - inicio.getTime()) / MS_DIA);
            const largura = Math.max(1, Math.floor((fim.getTime() - ini.getTime()) / MS_DIA) + 1);
            return (
              <div key={t.id} className="relative flex h-8 items-center border-b border-grafite-elevado/40 hover:bg-grafite-elevado/30">
                <button type="button" onClick={() => actions.abrir(t)} title={t.title} className="sticky left-0 z-[5] w-[220px] shrink-0 truncate bg-carbono px-2 text-left text-xs text-branco-cru hover:underline">{t.title}</button>
                <button
                  type="button"
                  onClick={() => actions.abrir(t)}
                  aria-label={`${t.title}: ${largura} dia(s)`}
                  className="absolute top-1.5 h-5 truncate rounded px-1 text-left text-[10px] text-white"
                  style={{ left: 220 + x * DIA, width: largura * DIA - 2, background: t.status?.color ?? '#6b7280', opacity: x + largura < 0 || x > DIAS_VISIVEIS ? 0 : 1 }}
                >
                  {largura > 2 ? t.title : ''}
                </button>
              </div>
            );
          })}
          {hoje >= 0 && hoje < DIAS_VISIVEIS && <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500" style={{ left: 220 + hoje * DIA + DIA / 2 }} />}
        </div>
      </div>
    </div>
  );
}
