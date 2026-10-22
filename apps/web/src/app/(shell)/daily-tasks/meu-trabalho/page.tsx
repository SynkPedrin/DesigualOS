'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DuePicker, PriorityPicker } from '@/components/daily-tasks/pickers';
import { LogoDoCliente, nomeLimpo, useListIndex } from '@/components/daily-tasks/cliente';
import { StatusPill } from '@/components/daily-tasks/primitivas';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { Avatar } from '@/components/daily-tasks/primitivas';
import { useUpdateTask, useWorkMembers, useWorkTasks, type WorkTaskWire } from '@/hooks/use-work';

const GRUPOS = [
  { id: 'atrasadas', titulo: 'Atrasadas', cor: 'text-red-400' },
  { id: 'hoje', titulo: 'Hoje', cor: 'text-aviso' },
  { id: 'semana', titulo: 'Próximos 7 dias', cor: 'text-branco-cru' },
  { id: 'depois', titulo: 'Depois', cor: 'text-nevoa' },
  { id: 'sem', titulo: 'Sem data', cor: 'text-nevoa' },
] as const;

function grupoDa(t: WorkTaskWire, agora: Date): (typeof GRUPOS)[number]['id'] {
  if (!t.dueAt) return 'sem';
  const d = new Date(t.dueAt);
  const fimHoje = new Date(agora); fimHoje.setHours(23, 59, 59, 999);
  const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0);
  if (d < inicioHoje) return 'atrasadas';
  if (d <= fimHoje) return 'hoje';
  if (d.getTime() <= fimHoje.getTime() + 7 * 86_400_000) return 'semana';
  return 'depois';
}

export default function MeuTrabalhoPage() {
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const membros = useWorkMembers().data?.members ?? [];
  const [pessoa, setPessoa] = useState<string | null>(null);
  const [concluidas, setConcluidas] = useState(false);
  const alvo = pessoa ?? eu;
  const quem = membros.find((m) => m.id === alvo);
  const tasks = useWorkTasks({ assigneeId: alvo, completed: concluidas ? undefined : false, includeSubtasks: true, sort: 'due', enabled: Boolean(alvo) });
  const atualizar = useUpdateTask();
  const listas = useListIndex();
  const [aberta, setAberta] = useState<string | null>(null);
  const grupos = useMemo(() => {
    const agora = new Date();
    return GRUPOS.map((g) => ({ ...g, itens: (tasks.data?.rows ?? []).filter((t) => grupoDa(t, agora) === g.id) }));
  }, [tasks.data]);

  if (!eu || tasks.isPending) return <Skeleton className="h-64 w-full" />;
  const cabecalho = (
    <div className="flex flex-wrap items-center gap-3">
      {quem && <Avatar nome={quem.name} url={quem.avatarUrl} size={32} />}
      <label className="flex items-center gap-2 text-xs text-nevoa">Tarefas de
        <select aria-label="Pessoa" value={alvo ?? ''} onChange={(e) => setPessoa(e.target.value === eu ? null : e.target.value)} className="rounded border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru">
          {membros.map((m) => <option key={m.id} value={m.id}>{m.id === eu ? `${m.name} (eu)` : m.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-nevoa"><input type="checkbox" checked={concluidas} onChange={(e) => setConcluidas(e.target.checked)} /> Incluir concluídas</label>
      <span className="ml-auto text-xs text-nevoa">{tasks.data?.total ?? 0} tarefa(s)</span>
    </div>
  );
  if ((tasks.data?.rows.length ?? 0) === 0) return <div className="space-y-4">{cabecalho}<EmptyState icon={CheckCircle2} title={alvo === eu ? 'Nada pendente para você' : `Nada pendente para ${quem?.name ?? 'esta pessoa'}`} description="Quando uma tarefa for atribuída, ela aparece aqui, agrupada por prazo. Use o seletor para ver o trabalho de outra pessoa." /></div>;
  return (
    <div className="space-y-6">
      {cabecalho}
      {grupos.filter((g) => g.itens.length > 0).map((g) => (
        <section key={g.id} aria-label={g.titulo}>
          <h2 className={`mb-1 text-sm font-semibold ${g.cor}`}>{g.titulo} <span className="font-normal text-nevoa">{g.itens.length}</span></h2>
          <div className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
            {g.itens.map((t) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,160px)_auto_110px_130px] items-center gap-3 px-3 py-2 hover:bg-grafite-elevado/40">
                <button type="button" onClick={() => setAberta(t.id)} className="min-w-0 truncate text-left text-sm text-branco-cru hover:underline" title={t.title}>
                  <span className="mr-2 font-mono text-[11px] text-nevoa">{t.key}</span>{t.title}
                </button>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-nevoa"><LogoDoCliente nome={nomeLimpo(listas.get(t.listId)?.nome ?? '')} /><span className="truncate">{listas.get(t.listId)?.nome ?? ''}</span></span>
                {t.status ? <StatusPill nome={t.status.name} cor={t.status.color} categoria={t.status.category} tamanho="sm" /> : <span />}
                <DuePicker tarefa={t} onChange={(iso) => atualizar.mutate({ id: t.id, expectedVersion: t.version, dueAt: iso })} />
                <PriorityPicker tarefa={t} onChange={(p) => atualizar.mutate({ id: t.id, expectedVersion: t.version, priority: p })} />
              </div>
            ))}
          </div>
        </section>
      ))}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
