'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { WorkMember, WorkStatus, WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import { faixaDaLinha } from '@/components/ui/prazo';
import { urgenciaDoPrazo } from '@/lib/prazo';
import { useColunas, type TaskActions } from './list-view';
import { andamento, BarraDeProgresso } from './ui';
import { LogoDoCliente, nomeLimpo, useListIndex } from './cliente';
import { AvatarStack, DueDate, PriorityFlag, StatusPill } from './primitivas';

/** Quadro: uma coluna por status; arrastar o cartão muda o status (a regra de transição continua sendo do servidor). */
export function BoardView({ tarefas, statuses, membros, listId, actions }: { tarefas: WorkTaskWire[]; statuses: WorkStatus[]; membros: WorkMember[]; listId: string | null; actions: TaskActions }) {
  const { colunas } = useColunas();
  const tem = (c: Parameters<typeof colunas.includes>[0]) => colunas.includes(c);
  const [sobre, setSobre] = useState<string | null>(null);
  const [novo, setNovo] = useState<string | null>(null);
  const [txt, setTxt] = useState('');
  const [vazias, setVazias] = useState(false);
  const listas = useListIndex();
  const mapa = new Map(membros.map((m) => [m.id, m]));
  return (
    <div>
    <label className="mb-2 flex items-center gap-1.5 text-xs text-nevoa"><input type="checkbox" checked={vazias} onChange={(e) => setVazias(e.target.checked)} /> Mostrar colunas vazias (para arrastar para um status sem tarefas)</label>
    <div className="flex gap-3 overflow-x-auto pb-3">
      {[...statuses].sort((a, b) => a.position - b.position).filter((s) => vazias || tarefas.some((t) => t.statusId === s.id) || tarefas.length === 0).map((s) => {
        const itens = tarefas.filter((t) => t.statusId === s.id);
        return (
          <section
            key={s.id}
            aria-label={`Coluna ${s.name}`}
            onDragOver={(e) => { e.preventDefault(); setSobre(s.id); }}
            onDragLeave={() => setSobre((v) => (v === s.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault(); setSobre(null);
              const t = tarefas.find((x) => x.id === e.dataTransfer.getData('text/plain'));
              if (t && t.statusId !== s.id) actions.atualizar(t, { statusId: s.id });
            }}
            className={cn('flex max-h-[70vh] w-72 shrink-0 flex-col rounded-lg bg-grafite/60 p-2', sobre === s.id && 'ring-1 ring-sinal')}
          >
            <div className="mb-2 flex items-center justify-between px-1"><StatusPill nome={s.name} cor={s.color} categoria={s.category} contagem={itens.length} /></div>
            <div className="space-y-2 overflow-y-auto">
              {itens.slice(0, 80).map((t) => (
                <article key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} onClick={() => actions.abrir(t)} className={cn('cursor-pointer rounded-md border border-grafite-elevado bg-carbono p-2.5 hover:border-nevoa/40', faixaDaLinha(t.completedAt ? null : urgenciaDoPrazo(t.dueAt)))}>
                  <p className="flex items-start gap-1.5 text-sm text-branco-cru">{tem('cliente') && <LogoDoCliente nome={nomeLimpo(listas.get(t.listId)?.nome ?? '')} className="mt-0.5" />}<span>{t.title}</span></p>
                  {tem('andamento') && t.subtaskCount > 0 && <div className="mt-2"><BarraDeProgresso pct={andamento(t)} /></div>}
                  {tem('tags') && t.tags.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1">{t.tags.slice(0, 3).map((x) => <span key={x} className="rounded bg-grafite-elevado px-1.5 py-0.5 text-[10px] text-nevoa">{x}</span>)}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {tem('responsavel') ? <AvatarStack ids={t.assigneeIds} membros={mapa} size={20} /> : <span />}
                    {tem('prazo') && <DueDate tarefa={t} />}
                    {tem('prioridade') && <PriorityFlag valor={t.priority} />}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-nevoa/60">{t.key}{t.subtaskCount > 0 ? ` · ${t.subtaskCount} subtarefas` : ''}</p>
                </article>
              ))}
              {itens.length > 80 && <p className="px-1 text-xs text-nevoa">+{itens.length - 80} (use a Lista para ver todas)</p>}
              {listId && (novo === s.id ? (
                <form onSubmit={(e) => { e.preventDefault(); if (txt.trim()) { actions.criar({ title: txt.trim(), statusId: s.id, listId }); setTxt(''); } }}>
                  <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => !txt && setNovo(null)} placeholder="Nome da tarefa" className="w-full rounded border border-sinal/50 bg-carbono px-2 py-1 text-sm text-branco-cru outline-none" />
                </form>
              ) : (
                <button type="button" onClick={() => setNovo(s.id)} className="flex w-full items-center gap-1 px-1 py-1 text-xs text-nevoa hover:text-branco-cru"><Plus size={13} /> Adicionar Tarefa</button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
    </div>
  );
}
