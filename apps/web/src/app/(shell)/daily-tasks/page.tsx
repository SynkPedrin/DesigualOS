'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, ChevronRight, Plus, Columns3, GanttChart, List as ListIcon, Search, Table2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ListChecks } from 'lucide-react';
import { Arvore } from '@/components/daily-tasks/tree';
import { BoardView } from '@/components/daily-tasks/board-view';
import { GanttView } from '@/components/daily-tasks/gantt-view';
import { CalendarView } from '@/components/daily-tasks/calendar-view';
import { ListView, type TaskActions } from '@/components/daily-tasks/list-view';
import { TableView } from '@/components/daily-tasks/table-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { LogoDoCliente, nomeLimpo } from '@/components/daily-tasks/cliente';
import { Avatar } from '@/components/daily-tasks/primitivas';
import {
  PRIORIDADES,
  useCreateStatus,
  useCreateTask,
  useSpaceStatuses,
  useUpdateTask,
  useWorkMembers,
  useWorkTasks,
  useWorkTree,
  type WorkTaskWire,
} from '@/hooks/use-work';
import { useSavedViewActions, useSavedViews } from '@/hooks/use-work-extra';
import { useClients } from '@/hooks/use-clients';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Visao = 'lista' | 'quadro' | 'calendario' | 'tabela' | 'gantt';
const VISOES: Array<{ id: Visao; label: string; icon: typeof ListIcon }> = [
  { id: 'lista', label: 'Lista', icon: ListIcon },
  { id: 'quadro', label: 'Quadro', icon: Columns3 },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
  { id: 'tabela', label: 'Tabela', icon: Table2 },
  { id: 'gantt', label: 'Gantt', icon: GanttChart },
];

export default function DailyTasksPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [arquivados, setArquivados] = useState(false);
  const [expandir, setExpandir] = useState(false);
  const [filtroCli, setFiltroCli] = useState<string | null>(null);
  const clientes = useClients().data ?? [];
  const tree = useWorkTree(arquivados);
  const membrosQ = useWorkMembers();
  const [listId, setListId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>('lista');
  const [q, setQ] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [filtroResp, setFiltroResp] = useState<string | null>(null);
  const [filtroPrio, setFiltroPrio] = useState<number | null>(null);
  const [abertaLocal, setAberta] = useState<string | null>(null);
  // `?task=<id>` abre a gaveta direto (links de notificação, Comunicação, Mídia).
  const aberta = abertaLocal ?? params.get('task');
  const fechar = () => { setAberta(null); if (params.get('task')) router.replace('/daily-tasks', { scroll: false }); };
  const [erro, setErro] = useState<string | null>(null);
  const [novaTarefa, setNovaTarefa] = useState('');
  const quickRef = useRef<HTMLInputElement>(null);
  const views = useSavedViews();
  const { salvar: salvarView } = useSavedViewActions();

  const spaces = tree.data?.spaces ?? [];
  const spaceAtivo = spaceId ?? spaces.find((s) => s.lists.length > 0)?.id ?? spaces[0]?.id ?? null;
  const space = spaces.find((s) => s.id === spaceAtivo) ?? null;
  const lista = useMemo(() => space?.lists.find((l) => l.id === listId) ?? null, [space, listId]);
  const pasta = lista?.folderId ? space?.folders.find((f) => f.id === lista.folderId) ?? null : null;

  // Entrar numa lista de verdade ao abrir: um espaço sozinho não tem tarefas para criar.
  useEffect(() => { if (!listId && space) { const alvo = [...space.lists].sort((a, b) => b.openTaskCount - a.openTaskCount)[0]; if (alvo) setListId(alvo.id); } }, [space, listId]);

  const tasks = useWorkTasks({ listId, spaceId: listId ? null : spaceAtivo, q: q.trim() || undefined, assigneeId: filtroResp, priorities: filtroPrio === null ? [] : [filtroPrio], includeArchived: arquivados, clientId: filtroCli });
  const statuses = useSpaceStatuses(spaceAtivo);
  const membros = membrosQ.data?.members ?? [];
  const criarStatus = useCreateStatus(spaceAtivo);
  const criarTarefa = useCreateTask();
  const atualizar = useUpdateTask();

  const mostrarErro = useCallback((e: unknown) => setErro(e instanceof ApiRequestError ? (e.status === 409 ? 'Outra pessoa alterou esta tarefa; a lista foi atualizada.' : e.message) : 'Algo deu errado.'), []);
  const actions: TaskActions = useMemo(() => ({
    abrir: (t: WorkTaskWire) => setAberta(t.id),
    atualizar: (t, patch) => { setErro(null); atualizar.mutate({ id: t.id, expectedVersion: t.version, ...patch }, { onError: mostrarErro }); },
    criar: (b) => { setErro(null); criarTarefa.mutate(b, { onError: mostrarErro }); },
  }), [atualizar, criarTarefa, mostrarErro]);

  const st = statuses.data?.statuses ?? [];
  const rows = tasks.data?.rows ?? [];
  const pronto = !tree.isPending && !tasks.isPending && !statuses.isPending;
  const eu = membros.find((m) => m.id === filtroResp);

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="md:sticky md:top-2 md:self-start">
          {tree.isPending ? <Skeleton className="h-64 w-full" /> : <Arvore spaces={spaces} listId={listId} spaceId={spaceAtivo} arquivados={arquivados} onArquivados={setArquivados} onPick={(l, s) => { setListId(l); setSpaceId(s); }} />}
        </div>
        <div className="min-w-0 space-y-3">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <nav aria-label="Caminho" className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-nevoa">
                {space && <span>{space.name}</span>}
                {pasta && <><ChevronRight size={12} /><span>{pasta.name}</span></>}
                <ChevronRight size={12} />
                {lista && <LogoDoCliente nome={nomeLimpo(lista.name)} className="!size-5" />}
                <h1 className="truncate text-base font-semibold text-branco-cru">{lista?.name ?? space?.name ?? 'Daily Tasks'}</h1>
              </nav>
              {tasks.data && <span className="text-xs text-nevoa">{tasks.data.total} tarefa(s) · {rows.filter((t) => !t.completedAt && t.dueAt && new Date(t.dueAt) < new Date()).length} atrasada(s)</span>}
              <div className="ml-auto flex items-center gap-2">
                {buscando ? (
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setBuscando(false)} placeholder="Buscar tarefas" aria-label="Buscar tarefas" className="w-48 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru outline-none" />
                ) : (
                  <button type="button" onClick={() => setBuscando(true)} className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2.5 py-1 text-sm text-nevoa hover:text-branco-cru"><Search size={14} /> Buscar</button>
                )}
                <button type="button" onClick={() => { quickRef.current?.focus(); quickRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} className="flex items-center gap-1.5 rounded-md bg-sinal px-3 py-1 text-sm font-semibold text-grafite hover:brightness-110"><Plus size={14} /> Tarefa</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-grafite-elevado pb-2">
              <div role="tablist" aria-label="Como ver as tarefas" className="flex flex-wrap gap-1">
                {VISOES.map((v) => (
                  <button key={v.id} role="tab" aria-selected={visao === v.id} type="button" onClick={() => setVisao(v.id)} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors', visao === v.id ? 'bg-sinal text-grafite' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru')}>
                    <v.icon size={14} /> {v.label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <select aria-label="Filtrar por responsável" value={filtroResp ?? ''} onChange={(e) => setFiltroResp(e.target.value || null)} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru">
                  <option value="">Quem faz: todos</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select aria-label="Filtrar por prioridade" value={filtroPrio ?? ''} onChange={(e) => setFiltroPrio(e.target.value === '' ? null : Number(e.target.value))} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru">
                  <option value="">Prioridade: todas</option>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}
                </select>
                <select aria-label="Filtrar por cliente" value={filtroCli ?? ''} onChange={(e) => setFiltroCli(e.target.value || null)} className="max-w-40 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru">
                  <option value="">Cliente: todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select
                  aria-label="Visões salvas"
                  value=""
                  onChange={(e) => {
                    const v = views.data?.views.find((x) => x.id === e.target.value);
                    if (!v) return;
                    setVisao((v.config.visao as Visao) ?? 'lista'); setFiltroResp(v.config.assigneeId ?? null); setFiltroPrio(v.config.priority ?? null);
                    if (v.config.spaceId) setSpaceId(v.config.spaceId);
                    setListId(v.config.listId ?? null);
                  }}
                  className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru"
                >
                  <option value="">Visões salvas…</option>{(views.data?.views ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <button type="button" onClick={() => { const n = window.prompt('Nome da visão (guarda lista, filtros e visualização atuais)'); if (n?.trim()) salvarView.mutate({ name: n.trim(), config: { visao, assigneeId: filtroResp, priority: filtroPrio, listId, spaceId: spaceAtivo } }); }} className="rounded-md border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru">Salvar visão</button>
                {visao === 'lista' && <label className="flex items-center gap-1 text-xs text-nevoa"><input type="checkbox" checked={expandir} onChange={(e) => setExpandir(e.target.checked)} /> Subtarefas abertas</label>}
              </div>
            </div>
          </header>
          {lista ? (
            <form className="flex items-center gap-2 rounded-lg border border-dashed border-grafite-elevado px-3 py-1.5 focus-within:border-sinal/60" onSubmit={(e) => { e.preventDefault(); if (novaTarefa.trim()) { actions.criar({ title: novaTarefa.trim(), listId: lista.id }); setNovaTarefa(''); } }}>
              <Plus size={15} className="text-sinal" />
              <input ref={quickRef} value={novaTarefa} onChange={(e) => setNovaTarefa(e.target.value)} placeholder={`Nova tarefa em "${lista.name}" — escreva e aperte Enter`} aria-label="Nome da nova tarefa" className="min-w-0 flex-1 bg-transparent text-sm text-branco-cru outline-none placeholder:text-nevoa" />
              <button type="submit" disabled={!novaTarefa.trim()} className="rounded-md bg-sinal px-3 py-1 text-xs font-semibold text-grafite disabled:opacity-40">Criar</button>
            </form>
          ) : (
            <p className="rounded-lg border border-dashed border-grafite-elevado px-3 py-2 text-sm text-nevoa">Para criar tarefas, <strong className="text-branco-cru">escolha uma lista</strong> no menu à esquerda.</p>
          )}
          {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
          {!pronto ? (
            <Skeleton className="h-64 w-full" />
          ) : spaces.length === 0 || !space ? (
            <EmptyState icon={ListChecks} title="Crie o primeiro espaço" description='Use "Novo espaço" ao lado, depois crie uma lista para começar.' />
          ) : st.length === 0 ? (
            <EmptyState icon={ListChecks} title="Este espaço ainda não tem status" description="Crie o primeiro status em Novo status." />
          ) : visao === 'lista' ? (
            <ListView tarefas={rows} statuses={st} membros={membros} listId={listId} actions={actions} onNovoStatus={(n) => criarStatus.mutate(n)} expandirTudo={expandir} arquivadas={arquivados} />
          ) : visao === 'quadro' ? (
            <BoardView tarefas={rows} statuses={st} membros={membros} listId={listId} actions={actions} />
          ) : visao === 'gantt' ? (
            <GanttView tarefas={rows} actions={actions} />
          ) : visao === 'calendario' ? (
            <CalendarView tarefas={rows} actions={actions} membros={membros} />
          ) : (
            <TableView tarefas={rows} statuses={st} membros={membros} actions={actions} />
          )}
          {pronto && tasks.data && tasks.data.total > rows.length && <p className="text-xs text-nevoa">Mostrando {rows.length} de {tasks.data.total} tarefas.</p>}
        </div>
      </div>
      {aberta && <TaskDrawer taskId={aberta} onClose={fechar} onOpen={setAberta} />}
    </div>
  );
}
