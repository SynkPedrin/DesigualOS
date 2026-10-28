'use client';

import { useMemo, useRef, useState } from 'react';
import { Archive } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { rotuloDoDia } from '@/components/daily-tasks/encerradas';
import { CabecalhoDaTabela, Linha, type TaskActions } from '@/components/daily-tasks/list-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { useClients } from '@/hooks/use-clients';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useModoEu } from '@/hooks/use-modo-eu';
import { useUpdateTask, useWorkMembers, useWorkTasks, type WorkTaskWire } from '@/hooks/use-work';

const campo = 'rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60';
const POR_VEZ = 200;

/**
 * Histórico das tarefas encerradas, de toda a equipe (ou só as suas, com o modo eu): a mais recente primeiro, agrupadas
 * pelo dia em que foram encerradas. Reabrir é trocar o status na própria linha ou no painel da tarefa.
 */
export default function EncerradasPage() {
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const [modoEu] = useModoEu();
  const [q, setQ] = useState('');
  const [cliente, setCliente] = useState<string | null>(null);
  const [limite, setLimite] = useState(POR_VEZ);
  const [aberta, setAberta] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const clientes = useClients().data ?? [];
  const membros = useWorkMembers().data?.members ?? [];
  const atualizar = useUpdateTask();
  const tasks = useWorkTasks({ completed: true, sort: 'completed', q: q.trim() || undefined, clientId: cliente, assigneeId: modoEu ? eu : null, includeSubtasks: true, limit: limite, enabled: !modoEu || Boolean(eu) });
  // "Ver mais antigas" troca a consulta; a lista atual fica na tela até a maior chegar (sem piscar nem perder a rolagem).
  const ultimas = useRef<{ rows: WorkTaskWire[]; total: number } | null>(null);
  if (tasks.data) ultimas.current = tasks.data;
  const rows = tasks.data?.rows ?? ultimas.current?.rows ?? [];
  const total = tasks.data?.total ?? ultimas.current?.total ?? 0;

  const grupos = useMemo(() => {
    const agora = new Date();
    const m = new Map<string, WorkTaskWire[]>();
    for (const t of rows) { if (!t.completedAt) continue; const k = rotuloDoDia(t.completedAt, agora); m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m.entries()]; // a API já devolve da mais recente para a mais antiga, então a ordem dos dias acompanha
  }, [rows]);

  const actions: TaskActions = { abrir: (t) => setAberta(t.id), atualizar: (t, patch) => atualizar.mutate({ id: t.id, expectedVersion: t.version, ...patch }), criar: () => undefined };
  const ctx = { statuses: null, membros, actions, expandirTudo: false, arquivadas: false, selecionadas, alternarSelecao: (id: string) => setSelecionadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), semSubtarefas: true };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-nevoa">
        <span className={modoEu ? 'font-medium text-lilas' : ''}>{modoEu ? 'Encerradas que eram suas' : 'Encerradas de toda a equipe'}</span>
        <input aria-label="Buscar nas encerradas" placeholder="Buscar pelo título" value={q} onChange={(e) => { setQ(e.target.value); setLimite(POR_VEZ); }} className={`${campo} w-56`} />
        <select aria-label="Cliente" value={cliente ?? ''} onChange={(e) => { setCliente(e.target.value || null); setLimite(POR_VEZ); }} className={`${campo} max-w-56`}><option value="">Todos os clientes</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {ultimas.current && <span className="ml-auto">{total} encerrada(s)</span>}
      </div>
      {tasks.isPending && !ultimas.current ? <Skeleton className="h-96 w-full" /> : rows.length === 0 ? (
        <EmptyState icon={Archive} title="Nenhuma tarefa encerrada aqui" description={q || cliente ? 'Nada encerrado com esse filtro.' : 'Quando uma tarefa for concluída, ela aparece aqui, com o dia em que foi encerrada.'} />
      ) : grupos.map(([dia, itens]) => (
        <section key={dia} aria-label={dia} className="space-y-1.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-sucesso first-letter:uppercase">{dia} <span className="font-normal text-nevoa">{itens.length}</span></h2>
          <div className="overflow-x-auto rounded-xl border border-grafite-elevado">
            <CabecalhoDaTabela />
            {itens.map((t) => <Linha key={t.id} t={t} nivel={0} ctx={ctx} />)}
          </div>
        </section>
      ))}
      {rows.length < total && (
        <button type="button" onClick={() => setLimite((l) => l + POR_VEZ)} disabled={tasks.isFetching} className="w-full rounded-lg border border-grafite-elevado py-2 text-sm text-nevoa hover:text-branco-cru disabled:opacity-50">
          {tasks.isFetching ? 'Carregando…' : `Ver mais antigas (${total - rows.length} restantes)`}
        </button>
      )}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
