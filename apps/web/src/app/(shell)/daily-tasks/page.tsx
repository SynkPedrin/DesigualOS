'use client';

import { useMemo, useState } from 'react';
import { ListChecks, Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  PRIORIDADES,
  useCreateList,
  useCreateSpace,
  useCreateTask,
  useSpaceStatuses,
  useUpdateTask,
  useWorkTasks,
  useWorkTree,
  type WorkTreeSpace,
} from '@/hooks/use-work';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

function NovoNome({ placeholder, onSubmit, busy }: { placeholder: string; onSubmit: (nome: string) => void; busy?: boolean }) {
  const [nome, setNome] = useState('');
  return (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim()) {
          onSubmit(nome.trim());
          setNome('');
        }
      }}
    >
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru placeholder:text-nevoa/50"
      />
      <button type="submit" disabled={busy || !nome.trim()} aria-label={placeholder} className="rounded bg-grafite-elevado px-2 text-nevoa hover:text-branco-cru disabled:opacity-40">
        <Plus size={14} />
      </button>
    </form>
  );
}

function ListaBtn({ nome, ativa, onClick }: { nome: string; ativa: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} title={nome} className={cn('w-full truncate rounded px-2 py-1 text-left text-xs', ativa ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
        {nome}
      </button>
    </li>
  );
}

function Arvore({ spaces, listId, spaceId, onPick }: { spaces: WorkTreeSpace[]; listId: string | null; spaceId: string | null; onPick: (listId: string | null, spaceId: string) => void }) {
  const criarEspaco = useCreateSpace();
  const criarLista = useCreateList();
  return (
    <Surface className="max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/60">Espaços e listas</p>
      {spaces.map((s) => {
        const aberto = s.id === spaceId;
        const soltas = s.lists.filter((l) => !l.folderId);
        return (
          <div key={s.id} className="space-y-1">
            <button type="button" onClick={() => onPick(null, s.id)} aria-expanded={aberto} className={cn('w-full truncate text-left text-sm font-semibold', aberto ? 'text-branco-cru' : 'text-nevoa')}>
              {aberto ? '▾' : '▸'} {s.name} <span className="font-normal text-nevoa/50">{s.lists.length}</span>
            </button>
            {aberto && (
              <div className="space-y-2 pl-2">
                {s.folders.map((f) => {
                  const dela = s.lists.filter((l) => l.folderId === f.id);
                  return dela.length === 0 ? null : (
                    <div key={f.id}>
                      <p className="truncate px-2 text-[11px] font-medium uppercase tracking-wide text-nevoa/60" title={f.name}>{f.name}</p>
                      <ul className="space-y-0.5">{dela.map((l) => <ListaBtn key={l.id} nome={l.name} ativa={listId === l.id} onClick={() => onPick(l.id, s.id)} />)}</ul>
                    </div>
                  );
                })}
                {soltas.length > 0 && <ul className="space-y-0.5">{soltas.map((l) => <ListaBtn key={l.id} nome={l.name} ativa={listId === l.id} onClick={() => onPick(l.id, s.id)} />)}</ul>}
                <NovoNome placeholder="Nova lista" busy={criarLista.isPending} onSubmit={(name) => criarLista.mutate({ spaceId: s.id, name })} />
              </div>
            )}
          </div>
        );
      })}
      <div className="border-t border-grafite-elevado pt-2">
        <NovoNome placeholder="Novo espaço" busy={criarEspaco.isPending} onSubmit={(n) => criarEspaco.mutate(n)} />
      </div>
    </Surface>
  );
}

export default function DailyTasksPage() {
  const tree = useWorkTree();
  const [listId, setListId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [titulo, setTitulo] = useState('');
  const [limite, setLimite] = useState(200);
  const [comConcluidas, setComConcluidas] = useState(false);

  const spaces = tree.data?.spaces ?? [];
  const spaceAtivo = spaceId ?? spaces[0]?.id ?? null;
  const tasks = useWorkTasks({ listId, spaceId: listId ? null : spaceAtivo, q: q.trim() || undefined, completed: comConcluidas ? undefined : false, limit: limite });
  const statuses = useSpaceStatuses(spaceAtivo);
  const criarTarefa = useCreateTask();
  const atualizar = useUpdateTask();

  const statusPorId = useMemo(() => new Map((statuses.data?.statuses ?? []).map((s) => [s.id, s])), [statuses.data]);
  const listaAtiva = useMemo(() => spaces.flatMap((s) => s.lists).find((l) => l.id === listId) ?? null, [spaces, listId]);
  const erro = atualizar.error instanceof ApiRequestError ? atualizar.error.message : null;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Beta" title="Daily Tasks" description="Gestão de trabalho nativa do Desigual OS — independente do ClickUp." compact />
      {tree.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <Arvore spaces={spaces} listId={listId} spaceId={spaceAtivo} onPick={(l, s) => { setListId(l); setSpaceId(s); setLimite(200); }} />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold text-branco-cru">{listaAtiva?.name ?? 'Todas as tarefas do espaço'}</h2>
              <span className="text-xs text-nevoa">{tasks.data ? `${tasks.data.total} tarefa(s)` : ''}</span>
              <label className="ml-auto flex items-center gap-1 text-xs text-nevoa">
                <input type="checkbox" checked={comConcluidas} onChange={(e) => { setComConcluidas(e.target.checked); setLimite(200); }} />
                Mostrar concluídas
              </label>
              <label className="flex items-center gap-1 rounded border border-grafite-elevado px-2 py-1 text-xs text-nevoa">
                <Search size={12} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className="bg-transparent text-branco-cru outline-none" />
              </label>
            </div>
            {listaAtiva && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!titulo.trim()) return;
                  criarTarefa.mutate({ listId: listaAtiva.id, title: titulo.trim() }, { onSuccess: () => setTitulo('') });
                }}
              >
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Nova tarefa — Enter para criar"
                  className="flex-1 rounded border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/50"
                />
                <button type="submit" disabled={criarTarefa.isPending || !titulo.trim()} className="rounded bg-sinal px-3 text-sm font-semibold text-grafite disabled:opacity-40">
                  Criar
                </button>
              </form>
            )}
            {criarTarefa.error instanceof ApiRequestError && <p role="alert" className="text-xs text-red-400">{criarTarefa.error.message}</p>}
            {erro && <p role="alert" className="text-xs text-red-400">{erro}</p>}
            {tasks.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : tasks.data && tasks.data.rows.length > 0 ? (
              <Surface className="divide-y divide-grafite-elevado">
                {tasks.data.rows.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-16 shrink-0 font-mono text-[11px] text-nevoa">DT-{t.number}</span>
                    <span className={cn('min-w-0 flex-1 truncate text-sm', t.completedAt ? 'text-nevoa line-through' : 'text-branco-cru')} style={{ paddingLeft: t.depth * 16 }}>
                      {t.title}
                    </span>
                    <span className="hidden text-xs text-nevoa sm:inline">{t.priority ? PRIORIDADES[t.priority] : ''}</span>
                    <select
                      aria-label={`Status de DT-${t.number}`}
                      value={t.statusId}
                      onChange={(e) => atualizar.mutate({ id: t.id, expectedVersion: t.version, statusId: e.target.value })}
                      className="rounded border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru"
                      style={{ borderColor: statusPorId.get(t.statusId)?.color }}
                    >
                      {(statuses.data?.statuses ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {tasks.data.total > tasks.data.rows.length && (
                  <button type="button" onClick={() => setLimite((n) => n + 200)} className="w-full px-3 py-2 text-xs text-nevoa hover:text-branco-cru">
                    Mostrar mais ({tasks.data.rows.length} de {tasks.data.total})
                  </button>
                )}
              </Surface>
            ) : (
              <EmptyState
                icon={ListChecks}
                title={spaces.length === 0 ? 'Crie o primeiro espaço' : listaAtiva ? 'Nenhuma tarefa nesta lista' : 'Nenhuma tarefa neste espaço'}
                description={spaces.length === 0 ? 'Use "Novo espaço" ao lado, depois crie uma lista para começar.' : 'Escolha uma lista à esquerda para criar tarefas.'}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
