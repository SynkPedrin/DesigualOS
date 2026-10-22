'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitFork, Plus } from 'lucide-react';
import { useWorkTasks, type TaskPatch, type WorkMember, type WorkStatus, type WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import { AssigneePicker, DuePicker, PriorityPicker } from './pickers';
import { RowMenu } from './row-menu';
import { TASK_DRAG } from './tree';
import { StatusDot, StatusPill } from './primitivas';

export interface TaskActions {
  abrir: (t: WorkTaskWire) => void;
  atualizar: (t: WorkTaskWire, patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => void;
  criar: (b: { title: string; statusId?: string; parentTaskId?: string; listId: string }) => void;
}

const COLUNAS = 'grid-cols-[minmax(0,1fr)_120px_110px_130px_120px] md:grid-cols-[minmax(0,1fr)_170px_150px_150px_130px]';

function InlineAdd({ rotulo, onSubmit, recuo = 0, abrir = false }: { rotulo: string; onSubmit: (t: string) => void; recuo?: number; abrir?: boolean }) {
  const [aberto, setAberto] = useState(abrir);
  const [txt, setTxt] = useState('');
  if (!aberto) {
    return (
      <div className="px-3 py-3" style={{ paddingLeft: 40 + recuo }}>
        <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-2 rounded-lg border border-dashed border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:border-sinal/60 hover:text-branco-cru">
          <Plus size={14} /> {rotulo}
        </button>
      </div>
    );
  }
  return (
    <form className="px-3 py-2" style={{ paddingLeft: 40 + recuo }} onSubmit={(e) => { e.preventDefault(); if (txt.trim()) { onSubmit(txt.trim()); setTxt(''); } }}>
      <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (!txt.trim()) setAberto(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { setTxt(''); setAberto(false); } }} placeholder={`${rotulo} — Enter para criar, Esc para sair`} className="w-full rounded border border-sinal/50 bg-carbono px-2 py-1.5 text-sm text-branco-cru outline-none" />
    </form>
  );
}

/** Progresso das subtarefas: "3/7" + barra. É o que diz de relance quanto falta dentro de uma tarefa. */
function ProgressoSubtarefas({ feitas, total }: { feitas: number; total: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-nevoa" title={`${feitas} de ${total} subtarefas concluídas`}>
      <GitFork size={12} className="rotate-90" />
      <span className="tabular-nums">{feitas}/{total}</span>
      <span className="h-1 w-10 overflow-hidden rounded bg-grafite-elevado"><span className="block h-full bg-sucesso" style={{ width: `${(feitas / Math.max(total, 1)) * 100}%` }} /></span>
    </span>
  );
}

function Linha({ t, nivel, ctx }: { t: WorkTaskWire; nivel: number; ctx: Ctx }) {
  const [aberta, setAberta] = useState(ctx.expandirTudo);
  const [criandoSub, setCriandoSub] = useState(false);
  useEffect(() => { setAberta(ctx.expandirTudo); }, [ctx.expandirTudo]);
  const subs = useWorkTasks({ parentTaskId: t.id, enabled: aberta, includeArchived: ctx.arquivadas });
  const statusFinal = ctx.statuses.find((s) => s.category === 'done');
  const feita = t.status?.category === 'done';
  return (
    <>
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.setData(TASK_DRAG, t.id); e.dataTransfer.effectAllowed = 'move'; }}
        className={cn('group grid items-center gap-2 border-b border-grafite-elevado/60 px-3 py-3.5 hover:bg-grafite-elevado/40', COLUNAS, nivel > 0 && 'bg-grafite/30', t.archivedAt && 'opacity-60')}
      >
        <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: nivel * 26 }}>
          {nivel > 0 && <span aria-hidden className="absolute bottom-1/2 top-[-14px] w-3 rounded-bl border-b border-l border-grafite-elevado" style={{ left: nivel * 26 - 14 }} />}
          <button type="button" aria-label={aberta ? 'Recolher subtarefas' : 'Expandir subtarefas'} onClick={() => setAberta((v) => !v)} className={cn('shrink-0 rounded p-0.5 text-nevoa hover:text-branco-cru', t.subtaskCount === 0 && 'invisible')}>
            {aberta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <button type="button" aria-label={feita ? 'Reabrir' : 'Concluir'} onClick={() => { const alvo = feita ? ctx.statuses.find((s) => s.isInitial) : statusFinal; if (alvo) ctx.actions.atualizar(t, { statusId: alvo.id }); }}>
            <StatusDot cor={t.status?.color ?? '#6b7280'} feito={feita} />
          </button>
          <button type="button" onClick={() => ctx.actions.abrir(t)} title={t.title} className={cn('truncate text-left text-[15px] hover:underline', nivel > 0 ? 'font-normal' : 'font-medium', feita ? 'text-nevoa' : 'text-branco-cru')}>
            {t.title}
          </button>
          {t.subtaskCount > 0 && <ProgressoSubtarefas feitas={t.subtaskDone} total={t.subtaskCount} />}
          {nivel > 0 && t.status && <StatusPill nome={t.status.name} cor={t.status.color} categoria={t.status.category} tamanho="sm" />}
          <button type="button" aria-label="Adicionar subtarefa" title="Criar uma subtarefa dentro desta tarefa" onClick={() => { setAberta(true); setCriandoSub(true); }} className="flex shrink-0 items-center gap-1 rounded-md border border-grafite-elevado px-2 py-0.5 text-[11px] text-nevoa hover:border-sinal/60 hover:text-branco-cru"><Plus size={12} /> Subtarefa</button>
        </div>
        <div><AssigneePicker tarefa={t} membros={ctx.membros} onChange={(ids) => ctx.actions.atualizar(t, { assigneeIds: ids })} /></div>
        <div><DuePicker tarefa={t} onChange={(iso) => ctx.actions.atualizar(t, { dueAt: iso })} /></div>
        <div><PriorityPicker tarefa={t} onChange={(p) => ctx.actions.atualizar(t, { priority: p })} /></div>
        <div className="flex items-center justify-end gap-2"><button type="button" onClick={() => ctx.actions.abrir(t)} className="rounded-md bg-grafite-elevado px-3 py-1 text-xs font-medium text-branco-cru hover:bg-sinal hover:text-grafite">Abrir</button><RowMenu t={t} onOpen={() => ctx.actions.abrir(t)} /></div>
      </div>
      {aberta && (
        <>
          {subs.data?.rows.map((s) => <Linha key={s.id} t={s} nivel={nivel + 1} ctx={ctx} />)}
          {subs.isPending && <div className="px-3 py-1 text-xs text-nevoa" style={{ paddingLeft: 40 + (nivel + 1) * 26 }}>Carregando…</div>}
          <InlineAdd key={criandoSub ? 'aberto' : 'fechado'} abrir={criandoSub} rotulo="Adicionar subtarefa" recuo={(nivel + 1) * 26} onSubmit={(title) => ctx.actions.criar({ title, parentTaskId: t.id, listId: t.listId, statusId: statusInicial(ctx.statuses) })} />
        </>
      )}
    </>
  );
}

interface Ctx { statuses: WorkStatus[]; membros: WorkMember[]; actions: TaskActions; expandirTudo: boolean; arquivadas: boolean }
const statusInicial = (s: WorkStatus[]): string => (s.find((x) => x.isInitial) ?? s[0])!.id;

export function ListView({ tarefas, statuses, membros, listId, actions, onNovoStatus, expandirTudo = false, arquivadas = false }: { tarefas: WorkTaskWire[]; statuses: WorkStatus[]; membros: WorkMember[]; listId: string | null; actions: TaskActions; onNovoStatus: (nome: string) => void; expandirTudo?: boolean; arquivadas?: boolean }) {
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [abertosPorPadrao] = useState(true);
  const [visiveis, setVisiveis] = useState<Record<string, number>>({});
  const grupos = useMemo(() => [...statuses].sort((a, b) => a.position - b.position).map((s) => ({ s, itens: tarefas.filter((t) => t.statusId === s.id) })), [statuses, tarefas]);
  const ctx: Ctx = { statuses, membros, actions, expandirTudo, arquivadas };
  const recolhido = (id: string, n: number, cat: string) => (fechados.has(id) ? true : abertosPorPadrao && cat === 'done' && n > 25 && !fechados.has(`+${id}`));
  const alternar = (id: string, n: number, cat: string) => setFechados((prev) => {
    const novo = new Set(prev);
    if (recolhido(id, n, cat)) { novo.delete(id); novo.add(`+${id}`); } else { novo.add(id); novo.delete(`+${id}`); }
    return novo;
  });
  const [novoStatus, setNovoStatus] = useState('');
  return (
    <div className="space-y-10">
      {grupos.filter(({ itens }) => itens.length > 0 || tarefas.length === 0).map(({ s, itens }) => {
        const fechado = recolhido(s.id, itens.length, s.category);
        const limite = visiveis[s.id] ?? 100;
        return (
          <section key={s.id} aria-label={`Status ${s.name}`}>
            <div className="mb-2 flex items-center gap-3">
              <button type="button" onClick={() => alternar(s.id, itens.length, s.category)} aria-expanded={!fechado} className="text-nevoa hover:text-branco-cru">
                {fechado ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
              <StatusPill nome={s.name} cor={s.color} categoria={s.category} contagem={itens.length} />
            </div>
            {!fechado && (
              <div>
                <div className={cn('grid gap-2 border-b border-grafite-elevado px-3 py-1 text-xs uppercase tracking-wide text-nevoa', COLUNAS)} style={{ paddingLeft: 40 }}>
                  <span>Tarefa</span><span>Quem faz</span><span className="whitespace-nowrap">Prazo</span><span>Prioridade</span><span className="text-right">Ações</span>
                </div>
                {itens.slice(0, limite).map((t) => <Linha key={t.id} t={t} nivel={0} ctx={ctx} />)}
                {itens.length > limite && (
                  <button type="button" onClick={() => setVisiveis((v) => ({ ...v, [s.id]: limite + 100 }))} className="px-9 py-1.5 text-xs text-nevoa hover:text-branco-cru">
                    Mostrar mais ({limite} de {itens.length})
                  </button>
                )}
                {listId && <InlineAdd rotulo="Adicionar tarefa neste status" onSubmit={(title) => actions.criar({ title, statusId: s.id, listId })} />}
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
