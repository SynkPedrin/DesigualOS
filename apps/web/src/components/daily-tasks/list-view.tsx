'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitFork, Plus } from 'lucide-react';
import { useWorkTasks, type TaskPatch, type WorkMember, type WorkStatus, type WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import { AssigneePicker, DuePicker, PriorityPicker } from './pickers';
import { StatusDot, StatusPill } from './primitivas';

export interface TaskActions {
  abrir: (t: WorkTaskWire) => void;
  atualizar: (t: WorkTaskWire, patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => void;
  criar: (b: { title: string; statusId?: string; parentTaskId?: string; listId: string }) => void;
}

const COLUNAS = 'grid-cols-[minmax(0,1fr)_110px_130px_120px] md:grid-cols-[minmax(0,1fr)_150px_150px_150px]';

function InlineAdd({ rotulo, onSubmit, recuo = 0 }: { rotulo: string; onSubmit: (t: string) => void; recuo?: number }) {
  const [aberto, setAberto] = useState(false);
  const [txt, setTxt] = useState('');
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-nevoa hover:text-branco-cru" style={{ paddingLeft: 36 + recuo }}>
        <Plus size={13} /> {rotulo}
      </button>
    );
  }
  return (
    <form
      className="px-3 py-1.5"
      style={{ paddingLeft: 36 + recuo }}
      onSubmit={(e) => { e.preventDefault(); if (txt.trim()) { onSubmit(txt.trim()); setTxt(''); } }}
    >
      <input
        autoFocus
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { if (!txt.trim()) setAberto(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setTxt(''); setAberto(false); } }}
        placeholder={`${rotulo} — Enter para criar, Esc para sair`}
        className="w-full rounded border border-sinal/50 bg-carbono px-2 py-1 text-sm text-branco-cru outline-none"
      />
    </form>
  );
}

function Linha({ t, nivel, ctx }: { t: WorkTaskWire; nivel: number; ctx: Ctx }) {
  const [aberta, setAberta] = useState(false);
  const subs = useWorkTasks({ parentTaskId: t.id, enabled: aberta });
  const statusFinal = ctx.statuses.find((s) => s.category === 'done');
  const feita = t.status?.category === 'done';
  return (
    <>
      <div className={cn('group grid items-center gap-2 border-b border-grafite-elevado/60 px-3 py-1.5 hover:bg-grafite-elevado/40', COLUNAS)}>
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: nivel * 22 }}>
          <button type="button" aria-label={aberta ? 'Recolher subtarefas' : 'Expandir subtarefas'} onClick={() => setAberta((v) => !v)} className={cn('shrink-0 rounded p-0.5 text-nevoa hover:text-branco-cru', t.subtaskCount === 0 && 'invisible')}>
            {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button
            type="button"
            aria-label={feita ? 'Reabrir' : 'Concluir'}
            onClick={() => { const alvo = feita ? ctx.statuses.find((s) => s.isInitial) : statusFinal; if (alvo) ctx.actions.atualizar(t, { statusId: alvo.id }); }}
          >
            <StatusDot cor={t.status?.color ?? '#6b7280'} feito={feita} />
          </button>
          <button type="button" onClick={() => ctx.actions.abrir(t)} title={t.title} className={cn('truncate text-left text-sm hover:underline', feita ? 'text-nevoa' : 'text-branco-cru')}>
            {t.title}
          </button>
          {t.subtaskCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-nevoa" title={`${t.subtaskCount} subtarefa(s)`}><GitFork size={11} className="rotate-90" />{t.subtaskCount}</span>
          )}
          <button type="button" aria-label="Adicionar subtarefa" onClick={() => setAberta(true)} className="invisible shrink-0 rounded p-0.5 text-nevoa hover:text-branco-cru group-hover:visible"><Plus size={13} /></button>
        </div>
        <div><AssigneePicker tarefa={t} membros={ctx.membros} onChange={(ids) => ctx.actions.atualizar(t, { assigneeIds: ids })} /></div>
        <div><DuePicker tarefa={t} onChange={(iso) => ctx.actions.atualizar(t, { dueAt: iso })} /></div>
        <div><PriorityPicker tarefa={t} onChange={(p) => ctx.actions.atualizar(t, { priority: p })} /></div>
      </div>
      {aberta && (
        <>
          {subs.data?.rows.map((s) => <Linha key={s.id} t={s} nivel={nivel + 1} ctx={ctx} />)}
          {subs.isPending && <div className="px-3 py-1 text-xs text-nevoa" style={{ paddingLeft: 36 + (nivel + 1) * 22 }}>Carregando…</div>}
          <InlineAdd rotulo="Adicionar subtarefa" recuo={(nivel + 1) * 22} onSubmit={(title) => ctx.actions.criar({ title, parentTaskId: t.id, listId: t.listId, statusId: statusInicial(ctx.statuses) })} />
        </>
      )}
    </>
  );
}

interface Ctx { statuses: WorkStatus[]; membros: WorkMember[]; actions: TaskActions }
const statusInicial = (s: WorkStatus[]): string => (s.find((x) => x.isInitial) ?? s[0])!.id;

export function ListView({ tarefas, statuses, membros, listId, actions, onNovoStatus }: { tarefas: WorkTaskWire[]; statuses: WorkStatus[]; membros: WorkMember[]; listId: string | null; actions: TaskActions; onNovoStatus: (nome: string) => void }) {
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [abertosPorPadrao] = useState(true);
  const [visiveis, setVisiveis] = useState<Record<string, number>>({});
  const grupos = useMemo(() => [...statuses].sort((a, b) => a.position - b.position).map((s) => ({ s, itens: tarefas.filter((t) => t.statusId === s.id) })), [statuses, tarefas]);
  const ctx: Ctx = { statuses, membros, actions };
  const recolhido = (id: string, n: number, cat: string) => (fechados.has(id) ? true : abertosPorPadrao && cat === 'done' && n > 25 && !fechados.has(`+${id}`));
  const alternar = (id: string, n: number, cat: string) => setFechados((prev) => {
    const novo = new Set(prev);
    if (recolhido(id, n, cat)) { novo.delete(id); novo.add(`+${id}`); } else { novo.add(id); novo.delete(`+${id}`); }
    return novo;
  });
  const [novoStatus, setNovoStatus] = useState('');
  return (
    <div className="space-y-6">
      {grupos.filter(({ itens }) => itens.length > 0 || tarefas.length === 0).map(({ s, itens }) => {
        const fechado = recolhido(s.id, itens.length, s.category);
        const limite = visiveis[s.id] ?? 100;
        return (
          <section key={s.id} aria-label={`Status ${s.name}`}>
            <div className="mb-1 flex items-center gap-2">
              <button type="button" onClick={() => alternar(s.id, itens.length, s.category)} aria-expanded={!fechado} className="text-nevoa hover:text-branco-cru">
                {fechado ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
              <StatusPill nome={s.name} cor={s.color} categoria={s.category} contagem={itens.length} />
            </div>
            {!fechado && (
              <div>
                <div className={cn('grid gap-2 border-b border-grafite-elevado px-3 py-1 text-[11px] text-nevoa', COLUNAS)} style={{ paddingLeft: 36 }}>
                  <span>Nome</span><span>Responsável</span><span className="whitespace-nowrap">Data de vencimento</span><span>Prioridade</span>
                </div>
                {itens.slice(0, limite).map((t) => <Linha key={t.id} t={t} nivel={0} ctx={ctx} />)}
                {itens.length > limite && (
                  <button type="button" onClick={() => setVisiveis((v) => ({ ...v, [s.id]: limite + 100 }))} className="px-9 py-1.5 text-xs text-nevoa hover:text-branco-cru">
                    Mostrar mais ({limite} de {itens.length})
                  </button>
                )}
                {listId && <InlineAdd rotulo="Adicionar Tarefa" onSubmit={(title) => actions.criar({ title, statusId: s.id, listId })} />}
              </div>
            )}
          </section>
        );
      })}
      <form className="flex items-center gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); if (novoStatus.trim()) { onNovoStatus(novoStatus.trim()); setNovoStatus(''); } }}>
        <Plus size={13} className="text-nevoa" />
        <input value={novoStatus} onChange={(e) => setNovoStatus(e.target.value)} placeholder="Novo status" className="rounded bg-transparent px-1 py-1 text-nevoa outline-none placeholder:text-nevoa focus:text-branco-cru" />
      </form>
    </div>
  );
}
