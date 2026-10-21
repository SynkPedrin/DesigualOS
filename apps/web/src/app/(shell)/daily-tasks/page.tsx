'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Columns3, List as ListIcon, Search, Table2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ListChecks } from 'lucide-react';
import { Arvore } from '@/components/daily-tasks/tree';
import { BoardView } from '@/components/daily-tasks/board-view';
import { CalendarView } from '@/components/daily-tasks/calendar-view';
import { ListView, type TaskActions } from '@/components/daily-tasks/list-view';
import { TableView } from '@/components/daily-tasks/table-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
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
  type TaskPatch,
  type WorkTaskWire,
} from '@/hooks/use-work';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Visao = 'lista' | 'quadro' | 'calendario' | 'tabela';
const VISOES: Array<{ id: Visao; label: string; icon: typeof ListIcon }> = [
  { id: 'lista', label: 'Lista', icon: ListIcon },
  { id: 'quadro', label: 'Quadro', icon: Columns3 },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
  { id: 'tabela', label: 'Tabela', icon: Table2 },
];

export default function DailyTasksPage() {
  const tree = useWorkTree();
  const membrosQ = useWorkMembers();
  const [listId, setListId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>('lista');
  const [q, setQ] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [filtroResp, setFiltroResp] = useState<string | null>(null);
  const [filtroPrio, setFiltroPrio] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const spaces = tree.data?.spaces ?? [];
  const spaceAtivo = spaceId ?? spaces.find((s) => s.lists.length > 0)?.id ?? spaces[0]?.id ?? null;
  const space = spaces.find((s) => s.id === spaceAtivo) ?? null;
  const lista = useMemo(() => space?.lists.find((l) => l.id === listId) ?? null, [space, listId]);
  const pasta = lista?.folderId ? space?.folders.find((f) => f.id === lista.folderId) ?? null : null;

  // Entrar numa lista de verdade ao abrir: um espaço sozinho não tem tarefas para criar.
  useEffect(() => { if (!listId && space) { const alvo = [...space.lists].sort((a, b) => b.openTaskCount - a.openTaskCount)[0]; if (alvo) setListId(alvo.id); } }, [space, listId]);

  const tasks = useWorkTasks({ listId, spaceId: listId ? null : spaceAtivo, q: q.trim() || undefined, assigneeId: filtroResp, priorities: filtroPrio === null ? [] : [filtroPrio] });
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
      <div className="grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
        <div className="md:sticky md:top-2 md:self-start">
          {tree.isPending ? <Skeleton className="h-64 w-full" /> : <Arvore spaces={spaces} listId={listId} spaceId={spaceAtivo} onPick={(l, s) => { setListId(l); setSpaceId(s); }} />}
        </div>
        <div className="min-w-0 space-y-3">
          <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-sm text-nevoa">
            {space && <span>{space.name}</span>}
            {pasta && <><ChevronRight size={13} /><span>{pasta.name}</span></>}
            {lista && <><ChevronRight size={13} /><strong className="text-branco-cru">{lista.name}</strong></>}
          </nav>
          <div className="flex flex-wrap items-center gap-2 border-b border-grafite-elevado">
            <div role="tablist" aria-label="Visualização" className="flex">
              {VISOES.map((v) => (
                <button key={v.id} role="tab" aria-selected={visao === v.id} type="button" onClick={() => setVisao(v.id)} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', visao === v.id ? 'border-sinal text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru')}>
                  <v.icon size={14} /> {v.label}
                </button>
              ))}
              <span title="Em breve" className="flex cursor-not-allowed items-center gap-1.5 px-3 py-2 text-sm text-nevoa/40">Gantt</span>
            </div>
            <div className="ml-auto flex items-center gap-2 pb-1">
              <select aria-label="Filtrar por responsável" value={filtroResp ?? ''} onChange={(e) => setFiltroResp(e.target.value || null)} className="rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-nevoa">
                <option value="">Todos os responsáveis</option>
                {membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select aria-label="Filtrar por prioridade" value={filtroPrio ?? ''} onChange={(e) => setFiltroPrio(e.target.value === '' ? null : Number(e.target.value))} className="rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-nevoa">
                <option value="">Toda prioridade</option>
                {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORIDADES[p]!.label}</option>)}
              </select>
              {eu && <Avatar nome={eu.name} url={eu.avatarUrl} size={20} />}
              {buscando ? (
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setBuscando(false)} placeholder="Buscar tarefas" className="w-44 rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru outline-none" />
              ) : (
                <button type="button" aria-label="Buscar" onClick={() => setBuscando(true)} className="rounded p-1 text-nevoa hover:bg-grafite-elevado"><Search size={15} /></button>
              )}
            </div>
          </div>
          {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
          {!pronto ? (
            <Skeleton className="h-64 w-full" />
          ) : spaces.length === 0 || !space ? (
            <EmptyState icon={ListChecks} title="Crie o primeiro espaço" description='Use "Novo espaço" ao lado, depois crie uma lista para começar.' />
          ) : st.length === 0 ? (
            <EmptyState icon={ListChecks} title="Este espaço ainda não tem status" description="Crie o primeiro status em Novo status." />
          ) : visao === 'lista' ? (
            <ListView tarefas={rows} statuses={st} membros={membros} listId={listId} actions={actions} onNovoStatus={(n) => criarStatus.mutate(n)} />
          ) : visao === 'quadro' ? (
            <BoardView tarefas={rows} statuses={st} membros={membros} listId={listId} actions={actions} />
          ) : visao === 'calendario' ? (
            <CalendarView tarefas={rows} actions={actions} />
          ) : (
            <TableView tarefas={rows} statuses={st} membros={membros} actions={actions} />
          )}
          {pronto && tasks.data && tasks.data.total > rows.length && <p className="text-xs text-nevoa">Mostrando {rows.length} de {tasks.data.total} tarefas.</p>}
        </div>
      </div>
      {aberta && (
        <TaskDrawer
          taskId={aberta}
          onClose={() => setAberta(null)}
          onOpen={setAberta}
          statuses={st}
          membros={membros}
          atualizar={(id, v, patch: Omit<TaskPatch, 'id' | 'expectedVersion'>) => atualizar.mutateAsync({ id, expectedVersion: v, ...patch })}
        />
      )}
    </div>
  );
}
