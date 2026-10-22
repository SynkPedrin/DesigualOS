'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GitFork, Plus } from 'lucide-react';
import { useSpaceStatuses, useWorkTasks, type TaskPatch, type WorkMember, type WorkStatus, type WorkTaskWire } from '@/hooks/use-work';
import { cn } from '@/lib/utils';
import { LogoDoCliente, nomeLimpo, useClientIndex, useListIndex } from './cliente';
import { AssigneePicker, PriorityPicker, StatusPicker } from './pickers';
import { StatusDot, StatusPill } from './primitivas';
import { RowMenu } from './row-menu';
import { TASK_DRAG } from './tree';
import { andamento, BarraDeProgresso, EmblemaDePrioridade, prazoRelativo } from './ui';
import { DuePicker } from './pickers';

export interface TaskActions {
  abrir: (t: WorkTaskWire) => void;
  atualizar: (t: WorkTaskWire, patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => void;
  criar: (b: { title: string; statusId?: string; parentTaskId?: string; listId: string }) => void;
}

/** checkbox · tarefa · progresso · responsável · prazo · prioridade · status · ações. Colunas finas somem em tela estreita. */
export const COLUNAS = 'grid-cols-[24px_minmax(0,1fr)_72px_96px_124px] xl:grid-cols-[24px_minmax(220px,1fr)_104px_72px_100px_104px_124px_96px]';
const so = 'hidden xl:flex';
// colunas de telas estreitas: tarefa · responsável · prazo · status (prioridade e progresso aparecem em tela larga)

function InlineAdd({ rotulo, onSubmit, recuo = 0, abrir = false }: { rotulo: string; onSubmit: (t: string) => void; recuo?: number; abrir?: boolean }) {
  const [aberto, setAberto] = useState(abrir);
  const [txt, setTxt] = useState('');
  if (!aberto) {
    return (
      <div className="px-3 py-1.5" style={{ paddingLeft: 44 + recuo }}>
        <button type="button" onClick={() => setAberto(true)} className="flex items-center gap-2 rounded-lg border border-dashed border-grafite-elevado px-2.5 py-1 text-xs text-nevoa hover:border-sinal/60 hover:text-branco-cru"><Plus size={12} /> {rotulo}</button>
      </div>
    );
  }
  return (
    <form className="px-3 py-2" style={{ paddingLeft: 44 + recuo }} onSubmit={(e) => { e.preventDefault(); if (txt.trim()) { onSubmit(txt.trim()); setTxt(''); } }}>
      <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (!txt.trim()) setAberto(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { setTxt(''); setAberto(false); } }} placeholder={`${rotulo} — Enter para criar, Esc para sair`} className="w-full rounded border border-sinal/50 bg-carbono px-2 py-1.5 text-sm text-branco-cru outline-none" />
    </form>
  );
}

export interface Ctx {
  statuses: WorkStatus[] | null;
  membros: WorkMember[];
  actions: TaskActions;
  expandirTudo: boolean;
  arquivadas: boolean;
  selecionadas: Set<string>;
  alternarSelecao: (id: string) => void;
  semSubtarefas?: boolean;
}
const statusInicial = (s: WorkStatus[]): string => (s.find((x) => x.isInitial) ?? s[0])!.id;

export function Linha({ t, nivel, ctx }: { t: WorkTaskWire; nivel: number; ctx: Ctx }) {
  const [aberta, setAberta] = useState(ctx.expandirTudo && !ctx.semSubtarefas);
  const [criandoSub, setCriandoSub] = useState(false);
  useEffect(() => { if (!ctx.semSubtarefas) setAberta(ctx.expandirTudo); }, [ctx.expandirTudo, ctx.semSubtarefas]);
  const listas = useListIndex();
  const clientes = useClientIndex();
  const info = listas.get(t.listId);
  const statusesProprios = useSpaceStatuses(ctx.statuses ? null : (info?.espacoId ?? null)).data?.statuses;
  const statuses = ctx.statuses ?? statusesProprios ?? [];
  const subs = useWorkTasks({ parentTaskId: t.id, enabled: aberta && !ctx.semSubtarefas, includeArchived: ctx.arquivadas });
  const feita = t.status?.category === 'done';
  const final = statuses.find((s) => s.category === 'done');
  const prazo = prazoRelativo(t.dueAt, feita);
  const atrasada = !feita && prazo?.cor === 'text-red-400';
  const nomeCliente = (t.clientId && clientes.get(t.clientId)) || null;
  const pct = andamento(t);
  return (
    <>
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.setData(TASK_DRAG, t.id); e.dataTransfer.effectAllowed = 'move'; }}
        className={cn('group grid items-center gap-3 border-b border-grafite-elevado/60 px-3 py-2 hover:bg-grafite-elevado/40', COLUNAS, nivel > 0 && 'bg-grafite/30', atrasada && nivel === 0 && 'bg-red-500/[0.06]', t.archivedAt && 'opacity-60')}
      >
        <input type="checkbox" aria-label={`Selecionar ${t.key}`} checked={ctx.selecionadas.has(t.id)} onChange={() => ctx.alternarSelecao(t.id)} />
        <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: nivel * 22 }}>
          {nivel > 0 && <span aria-hidden className="absolute bottom-1/2 top-[-12px] w-3 rounded-bl border-b border-l border-grafite-elevado" style={{ left: nivel * 22 - 12 }} />}
          {!ctx.semSubtarefas && (
            <button type="button" aria-label={aberta ? 'Recolher subtarefas' : 'Expandir subtarefas'} onClick={() => setAberta((v) => !v)} className={cn('shrink-0 rounded p-0.5 text-nevoa hover:text-branco-cru', t.subtaskCount === 0 && 'invisible')}>
              {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          <button type="button" aria-label={feita ? 'Reabrir' : 'Concluir'} title={feita ? 'Reabrir tarefa' : 'Marcar como concluída'} onClick={() => { const alvo = feita ? statuses.find((s) => s.isInitial) : final; if (alvo) ctx.actions.atualizar(t, { statusId: alvo.id }); }}>
            <StatusDot cor={t.status?.color ?? '#6b7280'} feito={feita} />
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => ctx.actions.abrir(t)} title={t.title} className={cn('block max-w-full truncate text-left text-sm hover:underline', nivel > 0 ? 'font-normal' : 'font-medium', feita ? 'text-nevoa line-through' : 'text-branco-cru')}>{t.title}</button>
            <span className="flex items-center gap-1.5 truncate text-[11px] text-nevoa">
              {nivel === 0 && <>{nomeCliente && <LogoDoCliente nome={nomeCliente} className="!size-3.5" />}<span className="truncate">{[nomeCliente, info ? nomeLimpo(info.nome) : null].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</span></>}
              {t.subtaskCount > 0 && <span className="flex shrink-0 items-center gap-1" title={`${t.subtaskDone} de ${t.subtaskCount} subtarefas concluídas`}><GitFork size={10} className="rotate-90" />{t.subtaskDone}/{t.subtaskCount}</span>}
            </span>
          </div>
          {!ctx.semSubtarefas && <button type="button" aria-label="Adicionar subtarefa" title="Criar uma subtarefa dentro desta tarefa" onClick={() => { setAberta(true); setCriandoSub(true); }} className="flex size-5 shrink-0 items-center justify-center rounded border border-grafite-elevado text-nevoa hover:border-sinal/60 hover:text-branco-cru"><Plus size={12} /></button>}
        </div>
        <div className={cn(so, 'items-center')}><BarraDeProgresso pct={pct} /></div>
        <div className="flex items-center"><AssigneePicker tarefa={t} membros={ctx.membros} onChange={(ids) => ctx.actions.atualizar(t, { assigneeIds: ids })} /></div>
        <div className="flex flex-col justify-center leading-tight">
          <DuePicker tarefa={t} onChange={(iso) => ctx.actions.atualizar(t, { dueAt: iso })} />
          {prazo && <span className={cn('px-1 text-[11px]', prazo.cor)}>{prazo.texto}</span>}
        </div>
        <div className={cn(so, 'items-center')}><PriorityPicker tarefa={t} badge onChange={(p) => ctx.actions.atualizar(t, { priority: p })} /></div>
        <div className="flex items-center"><StatusPicker tarefa={t} statuses={statuses} onChange={(statusId) => ctx.actions.atualizar(t, { statusId })} /></div>
        <div className="flex items-center justify-end gap-1"><button type="button" onClick={() => ctx.actions.abrir(t)} className="rounded-md bg-grafite-elevado px-2 py-1 text-xs font-medium text-branco-cru hover:bg-sinal hover:text-grafite">Abrir</button><RowMenu t={t} onOpen={() => ctx.actions.abrir(t)} /></div>
      </div>
      {aberta && !ctx.semSubtarefas && (
        <>
          {subs.data?.rows.map((s) => <Linha key={s.id} t={s} nivel={nivel + 1} ctx={ctx} />)}
          {subs.isPending && <div className="px-3 py-1 text-xs text-nevoa" style={{ paddingLeft: 44 + (nivel + 1) * 22 }}>Carregando…</div>}
          <InlineAdd key={criandoSub ? 'aberto' : 'fechado'} abrir={criandoSub} rotulo="Adicionar subtarefa" recuo={(nivel + 1) * 22} onSubmit={(title) => ctx.actions.criar({ title, parentTaskId: t.id, listId: t.listId, statusId: statusInicial(statuses) })} />
        </>
      )}
    </>
  );
}

export type ColunaOrdenavel = 'tarefa' | 'prazo' | 'prioridade' | 'andamento';
export function CabecalhoDaTabela({ ordem, onOrdenar, todasMarcadas, onMarcarTodas }: { ordem?: { col: ColunaOrdenavel; dir: 'asc' | 'desc' } | undefined; onOrdenar?: ((c: ColunaOrdenavel) => void) | undefined; todasMarcadas?: boolean; onMarcarTodas?: (() => void) | undefined }) {
  const col = (c: ColunaOrdenavel, nome: string, extra = '') => (
    <button type="button" disabled={!onOrdenar} onClick={() => onOrdenar?.(c)} className={cn('flex items-center gap-1 text-left uppercase tracking-wide hover:text-branco-cru', extra)}>
      {nome}{ordem?.col === c && (ordem.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  );
  return (
    <div className={cn('grid items-center gap-3 border-b border-grafite-elevado px-3 py-2 text-[11px] text-nevoa', COLUNAS)}>
      <input type="checkbox" aria-label="Selecionar todas" checked={Boolean(todasMarcadas)} onChange={() => onMarcarTodas?.()} disabled={!onMarcarTodas} />
      {col('tarefa', 'Tarefa')}
      {col('andamento', 'Andamento', so)}
      <span className="uppercase tracking-wide">Quem</span>
      {col('prazo', 'Prazo')}
      {col('prioridade', 'Prioridade', so)}
      <span className="uppercase tracking-wide">Status</span>
      <span className="text-right uppercase tracking-wide">Ações</span>
    </div>
  );
}

export function ordenarTarefas(ts: WorkTaskWire[], ordem: { col: ColunaOrdenavel; dir: 'asc' | 'desc' }): WorkTaskWire[] {
  const v = (t: WorkTaskWire): number | string => {
    if (ordem.col === 'tarefa') return t.title.toLowerCase();
    if (ordem.col === 'prazo') return t.dueAt ? new Date(t.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (ordem.col === 'prioridade') return t.priority === 0 ? 9 : t.priority;
    return andamento(t);
  };
  const f = ordem.dir === 'asc' ? 1 : -1;
  return [...ts].sort((a, b) => { const x = v(a); const y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * f; });
}

export function ListView({ tarefas, statuses, membros, listId, actions, onNovoStatus, expandirTudo = false, arquivadas = false, agrupar = false, selecionadas, onSelecionadas }: {
  tarefas: WorkTaskWire[]; statuses: WorkStatus[]; membros: WorkMember[]; listId: string | null; actions: TaskActions; onNovoStatus: (nome: string) => void;
  expandirTudo?: boolean; arquivadas?: boolean; agrupar?: boolean; selecionadas: Set<string>; onSelecionadas: (s: Set<string>) => void;
}) {
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [visiveis, setVisiveis] = useState<Record<string, number>>({});
  const [ordem, setOrdem] = useState<{ col: ColunaOrdenavel; dir: 'asc' | 'desc' }>({ col: 'prazo', dir: 'asc' });
  const [novoStatus, setNovoStatus] = useState('');
  const [limiteFlat, setLimiteFlat] = useState(100);
  const alternarSelecao = (id: string) => { const n = new Set(selecionadas); if (n.has(id)) n.delete(id); else n.add(id); onSelecionadas(n); };
  const ctx: Ctx = { statuses, membros, actions, expandirTudo, arquivadas, selecionadas, alternarSelecao };
  const grupos = useMemo(() => [...statuses].sort((a, b) => a.position - b.position).map((s) => ({ s, itens: tarefas.filter((t) => t.statusId === s.id) })), [statuses, tarefas]);
  const ordenadas = useMemo(() => ordenarTarefas(tarefas, ordem), [tarefas, ordem]);
  const mudarOrdem = (c: ColunaOrdenavel) => setOrdem((o) => (o.col === c ? { col: c, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'asc' }));

  if (!agrupar) {
    const mostradas = ordenadas.slice(0, limiteFlat);
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-xl border border-grafite-elevado">
          <CabecalhoDaTabela ordem={ordem} onOrdenar={mudarOrdem} todasMarcadas={mostradas.length > 0 && mostradas.every((t) => selecionadas.has(t.id))} onMarcarTodas={() => onSelecionadas(mostradas.every((t) => selecionadas.has(t.id)) ? new Set() : new Set(mostradas.map((t) => t.id)))} />
          {mostradas.map((t) => <Linha key={t.id} t={t} nivel={0} ctx={ctx} />)}
          {ordenadas.length === 0 && <p className="px-4 py-8 text-center text-sm text-nevoa">Nenhuma tarefa com esses filtros.</p>}
          {listId && <InlineAdd rotulo="Adicionar tarefa" onSubmit={(title) => actions.criar({ title, listId })} />}
        </div>
        {ordenadas.length > limiteFlat && <button type="button" onClick={() => setLimiteFlat((n) => n + 100)} className="w-full rounded-lg border border-grafite-elevado py-2 text-xs text-nevoa hover:text-branco-cru">Mostrar mais ({limiteFlat} de {ordenadas.length})</button>}
      </div>
    );
  }

  const recolhido = (id: string, n: number, cat: string) => (fechados.has(id) ? true : cat === 'done' && n > 25 && !fechados.has(`+${id}`));
  const alternar = (id: string, n: number, cat: string) => setFechados((prev) => {
    const novo = new Set(prev);
    if (recolhido(id, n, cat)) { novo.delete(id); novo.add(`+${id}`); } else { novo.add(id); novo.delete(`+${id}`); }
    return novo;
  });
  return (
    <div className="space-y-5">
      {grupos.filter(({ itens }) => itens.length > 0 || tarefas.length === 0).map(({ s, itens }) => {
        const fechado = recolhido(s.id, itens.length, s.category);
        const limite = visiveis[s.id] ?? 100;
        return (
          <section key={s.id} aria-label={`Status ${s.name}`}>
            <div className="mb-1 flex items-center gap-2">
              <button type="button" onClick={() => alternar(s.id, itens.length, s.category)} aria-expanded={!fechado} className="text-nevoa hover:text-branco-cru">{fechado ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
              <StatusPill nome={s.name} cor={s.color} categoria={s.category} contagem={itens.length} />
            </div>
            {!fechado && (
              <div className="overflow-hidden rounded-xl border border-grafite-elevado">
                <CabecalhoDaTabela />
                {itens.slice(0, limite).map((t) => <Linha key={t.id} t={t} nivel={0} ctx={ctx} />)}
                {itens.length > limite && <button type="button" onClick={() => setVisiveis((v) => ({ ...v, [s.id]: limite + 100 }))} className="px-9 py-1.5 text-xs text-nevoa hover:text-branco-cru">Mostrar mais ({limite} de {itens.length})</button>}
                {listId && <InlineAdd rotulo="Adicionar tarefa" onSubmit={(title) => actions.criar({ title, statusId: s.id, listId })} />}
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
