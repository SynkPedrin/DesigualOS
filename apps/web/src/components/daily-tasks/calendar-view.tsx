'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { WorkMember, WorkTaskWire } from '@/hooks/use-work';
import { PRIORIDADES } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import type { TaskActions } from './list-view';
import { Avatar } from './primitivas';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DRAG = 'application/x-work-calendar-task';
const chave = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Calendário mensal pelos prazos. Cada dia mostra o que VENCE nele; arrastar um cartão para outro dia reagenda
 * (mantém a hora); o painel do dia lista tudo e cria tarefa já com aquela data. Sem data fica à parte, nunca some.
 */
export function CalendarView({ tarefas, actions, membros = [], onCriar }: { tarefas: WorkTaskWire[]; actions: TaskActions; membros?: WorkMember[]; onCriar?: ((dia: Date, titulo: string) => void) | undefined }) {
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [dia, setDia] = useState<Date | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [novo, setNovo] = useState('');
  const porMembro = useMemo(() => new Map(membros.map((m) => [m.id, m])), [membros]);
  const { dias, semData, resumo } = useMemo(() => {
    const inicio = new Date(ref); inicio.setDate(1 - inicio.getDay());
    const grade = Array.from({ length: 42 }, (_, i) => { const d = new Date(inicio); d.setDate(inicio.getDate() + i); return d; });
    const porDia = new Map<string, WorkTaskWire[]>();
    for (const t of tarefas) if (t.dueAt) { const k = chave(new Date(t.dueAt)); porDia.set(k, [...(porDia.get(k) ?? []), t]); }
    const doMes = tarefas.filter((t) => t.dueAt && new Date(t.dueAt).getMonth() === ref.getMonth() && new Date(t.dueAt).getFullYear() === ref.getFullYear());
    const agora = new Date();
    return {
      dias: grade.map((d) => ({ d, itens: porDia.get(chave(d)) ?? [] })),
      semData: tarefas.filter((t) => !t.dueAt),
      resumo: { total: doMes.length, abertas: doMes.filter((t) => !t.completedAt).length, atrasadas: doMes.filter((t) => !t.completedAt && new Date(t.dueAt!) < agora).length },
    };
  }, [ref, tarefas]);
  const mover = (n: number) => setRef((r) => new Date(r.getFullYear(), r.getMonth() + n, 1));
  const hoje = new Date();
  const doDia = dia ? (dias.find((x) => chave(x.d) === chave(dia))?.itens ?? []) : [];
  const reagendar = (id: string, alvo: Date) => {
    const t = tarefas.find((x) => x.id === id);
    if (!t?.dueAt) return;
    const atual = new Date(t.dueAt);
    if (chave(atual) === chave(alvo)) return;
    const novoDia = new Date(alvo); novoDia.setHours(atual.getHours(), atual.getMinutes(), 0, 0);
    actions.atualizar(t, { dueAt: novoDia.toISOString() });
  };
  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Mês anterior" onClick={() => mover(-1)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><ChevronLeft size={16} /></button>
          <h3 className="w-44 text-center text-base font-semibold capitalize text-branco-cru">{ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>
          <button type="button" aria-label="Próximo mês" onClick={() => mover(1)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><ChevronRight size={16} /></button>
          <button type="button" onClick={() => { const d = new Date(); d.setDate(1); setRef(d); setDia(new Date()); }} className="rounded border border-grafite-elevado px-2 py-0.5 text-xs text-nevoa hover:text-branco-cru">Hoje</button>
          <span className="ml-auto text-xs text-nevoa">{resumo.total} no mês · {resumo.abertas} abertas{resumo.atrasadas > 0 && <span className="text-red-400"> · {resumo.atrasadas} atrasadas</span>}</span>
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-grafite-elevado text-xs">
          {DIAS.map((d) => <div key={d} className="border-b border-grafite-elevado bg-grafite px-2 py-1.5 text-nevoa">{d}</div>)}
          {dias.map(({ d, itens }) => {
            const ehHoje = chave(d) === chave(hoje);
            return (
              <div
                key={d.toISOString()}
                role="gridcell"
                aria-label={`${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}: ${itens.length} tarefa(s)`}
                onClick={() => setDia(d)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setSobre(chave(d)); } }}
                onDragLeave={() => setSobre((v) => (v === chave(d) ? null : v))}
                onDrop={(e) => { e.preventDefault(); setSobre(null); const id = e.dataTransfer.getData(DRAG); if (id) reagendar(id, d); }}
                className={cn('min-h-28 cursor-pointer border-b border-r border-grafite-elevado/60 p-1 hover:bg-grafite-elevado/30', d.getMonth() !== ref.getMonth() && 'bg-grafite/40 text-nevoa/50', ehHoje && 'bg-sinal/5', sobre === chave(d) && 'ring-1 ring-inset ring-sinal', dia && chave(dia) === chave(d) && 'outline outline-1 -outline-offset-1 outline-sinal/60')}
              >
                <p className={cn('mb-1 flex items-center justify-between px-0.5 text-[11px]', ehHoje ? 'font-semibold text-sinal' : 'text-nevoa')}>{itens.length > 0 && <span className="rounded-full bg-grafite-elevado px-1.5 text-[10px] text-branco-cru">{itens.length}</span>}<span className="ml-auto">{d.getDate()}</span></p>
                {itens.slice(0, 4).map((t) => {
                  const atrasada = !t.completedAt && new Date(t.dueAt!) < hoje && chave(d) !== chave(hoje);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG, t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={(e) => { e.stopPropagation(); actions.abrir(t); }}
                      title={`${t.key} · ${t.title}${t.status ? ` · ${t.status.name}` : ''}`}
                      className={cn('mb-0.5 flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-white', t.completedAt && 'opacity-60 line-through', atrasada && 'ring-1 ring-red-400')}
                      style={{ background: t.status?.color ?? '#6b7280' }}
                    >
                      {t.priority > 0 && t.priority < 3 && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-white" style={{ boxShadow: `0 0 0 1px ${PRIORIDADES[t.priority]!.color}` }} />}
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {itens.length > 4 && <p className="px-1 text-[10px] text-nevoa">+{itens.length - 4} no dia</p>}
              </div>
            );
          })}
        </div>
        {semData.length > 0 && <p className="text-xs text-nevoa">{semData.length} tarefa(s) sem data de vencimento não aparecem no calendário.</p>}
      </div>
      {dia && (
        <aside aria-label="Painel do dia" className="w-72 shrink-0 space-y-3 rounded-lg border border-grafite-elevado bg-grafite p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold capitalize text-branco-cru">{dia.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
            <button type="button" aria-label="Fechar painel do dia" onClick={() => setDia(null)} className="text-nevoa hover:text-branco-cru"><X size={14} /></button>
          </div>
          {doDia.length === 0 ? <p className="text-xs text-nevoa">Nada vence neste dia.</p> : (
            <ul className="space-y-1.5">
              {doDia.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => actions.abrir(t)} className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-grafite-elevado/60">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: t.status?.color ?? '#6b7280' }} />
                    <span className={cn('min-w-0 flex-1 truncate text-sm', t.completedAt ? 'text-nevoa line-through' : 'text-branco-cru')}>{t.title}</span>
                    {t.assigneeIds[0] && <Avatar nome={porMembro.get(t.assigneeIds[0])?.name ?? '?'} url={porMembro.get(t.assigneeIds[0])?.avatarUrl} size={20} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {onCriar && (
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (novo.trim()) { onCriar(dia, novo.trim()); setNovo(''); } }}>
              <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nova tarefa para este dia" aria-label="Nova tarefa para este dia" className="min-w-0 flex-1 rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru outline-none" />
              <button type="submit" aria-label="Criar tarefa no dia" disabled={!novo.trim()} className="rounded bg-sinal px-2 text-grafite disabled:opacity-40"><Plus size={14} /></button>
            </form>
          )}
        </aside>
      )}
    </div>
  );
}
