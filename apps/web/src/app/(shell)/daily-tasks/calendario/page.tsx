'use client';

import { useMemo, useState } from 'react';
import { CalendarView } from '@/components/daily-tasks/calendar-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useCreateTask, useUpdateTask, useWorkMembers, useWorkTasks, useWorkTree } from '@/hooks/use-work';
import { useClients } from '@/hooks/use-clients';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';

/** Calendário da empresa (ou só das minhas) pelos prazos: janela de 2 meses atrás a 4 à frente. Arrastar reagenda; o painel do dia cria tarefa. */
export default function CalendarioPage() {
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const [soMinhas, setSoMinhas] = useState(true);
  const [cliente, setCliente] = useState<string | null>(null);
  const [listaNova, setListaNova] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const clientes = useClients().data ?? [];
  const membros = useWorkMembers().data?.members ?? [];
  const arvore = useWorkTree().data?.spaces ?? [];
  const criar = useCreateTask();
  const atualizar = useUpdateTask();
  const janela = useMemo(() => {
    const de = new Date(); de.setMonth(de.getMonth() - 2, 1); de.setHours(0, 0, 0, 0);
    const ate = new Date(); ate.setMonth(ate.getMonth() + 4, 1);
    return { de: de.toISOString(), ate: ate.toISOString() };
  }, []);
  const tasks = useWorkTasks({ dueFrom: janela.de, dueTo: janela.ate, assigneeId: soMinhas ? eu : null, clientId: cliente, includeSubtasks: true, sort: 'due', enabled: !soMinhas || Boolean(eu) });
  const listas = arvore.flatMap((s) => s.lists.filter((l) => !l.archived).map((l) => ({ id: l.id, rotulo: `${s.name} › ${l.name}` })));
  const lista = listaNova || listas[0]?.id || '';
  const erro = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível concluir.', 'error');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-nevoa">
        <label className="flex items-center gap-2"><input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} /> Só as minhas tarefas</label>
        <select aria-label="Cliente" value={cliente ?? ''} onChange={(e) => setCliente(e.target.value || null)} className="max-w-48 rounded border border-grafite-elevado bg-carbono px-2 py-1"><option value="">Todos os clientes</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="flex items-center gap-2">Criar novas tarefas em <select aria-label="Lista das novas tarefas" value={lista} onChange={(e) => setListaNova(e.target.value)} className="max-w-64 rounded border border-grafite-elevado bg-carbono px-2 py-1">{listas.map((l) => <option key={l.id} value={l.id}>{l.rotulo}</option>)}</select></label>
      </div>
      {tasks.isPending ? <Skeleton className="h-96 w-full" /> : (
        <CalendarView
          tarefas={tasks.data?.rows ?? []}
          membros={membros}
          actions={{ abrir: (t) => setAberta(t.id), atualizar: (t, patch) => atualizar.mutate({ id: t.id, expectedVersion: t.version, ...patch }, { onError: erro }), criar: () => undefined }}
          onCriar={lista ? (dia, titulo) => { const d = new Date(dia); d.setHours(18, 0, 0, 0); criar.mutate({ listId: lista, title: titulo, dueAt: d.toISOString(), ...(eu && soMinhas ? { assigneeIds: [eu] } : {}) }, { onSuccess: () => toast('Tarefa criada.', 'success'), onError: erro }); } : undefined}
        />
      )}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
