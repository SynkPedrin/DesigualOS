'use client';

import { useMemo, useRef, useState } from 'react';
import { CalendarView, gradeDoMes } from '@/components/daily-tasks/calendar-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useModoEu } from '@/hooks/use-modo-eu';
import { useCreateTask, useUpdateTask, useWorkMembers, useWorkTasks, useWorkTree, type WorkTaskWire } from '@/hooks/use-work';
import { useClients } from '@/hooks/use-clients';
import { ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';

const campo = 'max-w-56 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru outline-none focus:border-roxo-eletrico/60';

/**
 * Calendário de TODAS as tarefas da empresa pelos prazos (ou só as suas, com o modo eu da barra do Daily).
 * Busca só a grade visível (6 semanas), então nada fica de fora por limite; as atrasadas vêm numa busca à parte,
 * de qualquer mês, para o painel de hoje. Arrastar reagenda; o painel do dia cria tarefa naquela data.
 */
export default function CalendarioPage() {
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const [modoEu] = useModoEu();
  const [cliente, setCliente] = useState<string | null>(null);
  const [listaNova, setListaNova] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [mes, setMes] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const clientes = useClients().data ?? [];
  const membros = useWorkMembers().data?.members ?? [];
  const arvore = useWorkTree().data?.spaces ?? [];
  const criar = useCreateTask();
  const atualizar = useUpdateTask();
  const janela = useMemo(() => { const g = gradeDoMes(mes); return { de: g.inicio.toISOString(), ate: g.fim.toISOString() }; }, [mes]);
  const pronto = !modoEu || Boolean(eu);
  const quem = modoEu ? eu : null;
  const tasks = useWorkTasks({ dueFrom: janela.de, dueTo: janela.ate, assigneeId: quem, clientId: cliente, includeSubtasks: true, sort: 'due', enabled: pronto });
  const inicioDeHoje = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);
  const atrasadas = useWorkTasks({ dueTo: inicioDeHoje, completed: false, assigneeId: quem, clientId: cliente, includeSubtasks: true, sort: 'due', limit: 500, enabled: pronto });
  // Ao trocar de mês, o mês anterior continua na tela até o novo chegar (sem piscar o esqueleto).
  const ultimas = useRef<WorkTaskWire[]>([]);
  if (tasks.data) ultimas.current = tasks.data.rows;
  const listas = arvore.flatMap((s) => s.lists.filter((l) => !l.archived).map((l) => ({ id: l.id, rotulo: `${s.name} › ${l.name}` })));
  const lista = listaNova || listas[0]?.id || '';
  const erro = (e: unknown) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível concluir.', 'error');
  const truncado = tasks.data && tasks.data.total > tasks.data.rows.length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-nevoa">
        <span className={modoEu ? 'font-medium text-lilas' : ''}>{modoEu ? 'Só as tarefas atribuídas a você' : 'Tarefas de toda a equipe'}</span>
        <select aria-label="Cliente" value={cliente ?? ''} onChange={(e) => setCliente(e.target.value || null)} className={campo}><option value="">Todos os clientes</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="ml-auto flex items-center gap-2">Novas tarefas em <select aria-label="Lista das novas tarefas" value={lista} onChange={(e) => setListaNova(e.target.value)} className={campo}>{listas.map((l) => <option key={l.id} value={l.id}>{l.rotulo}</option>)}</select></label>
      </div>
      {tasks.isPending && ultimas.current.length === 0 ? <Skeleton className="h-96 w-full" /> : (
        <CalendarView
          tarefas={tasks.data?.rows ?? ultimas.current}
          atrasadas={atrasadas.data?.rows}
          membros={membros}
          mes={mes}
          onMes={setMes}
          actions={{ abrir: (t) => setAberta(t.id), atualizar: (t, patch) => atualizar.mutate({ id: t.id, expectedVersion: t.version, ...patch }, { onError: erro }), criar: () => undefined }}
          onCriar={lista ? (dia, titulo) => { const d = new Date(dia); d.setHours(12, 0, 0, 0); criar.mutate({ listId: lista, title: titulo, dueAt: d.toISOString(), ...(eu && modoEu ? { assigneeIds: [eu] } : {}) }, { onSuccess: () => toast('Tarefa criada.', 'success'), onError: erro }); } : undefined}
        />
      )}
      {truncado && <p className="text-xs text-aviso">Mostrando {tasks.data!.rows.length} de {tasks.data!.total} tarefas deste mês. Filtre por cliente para ver todas.</p>}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
