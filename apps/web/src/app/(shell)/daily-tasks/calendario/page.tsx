'use client';

import { useMemo, useState } from 'react';
import { CalendarView } from '@/components/daily-tasks/calendar-view';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useWorkTasks } from '@/hooks/use-work';

/** Calendário de toda a empresa (ou só das minhas tarefas) pelas datas de vencimento, numa janela de 2 meses atrás a 4 à frente. */
export default function CalendarioPage() {
  const eu = useDailyTasksAccess().data?.userId ?? null;
  const [soMinhas, setSoMinhas] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);
  const janela = useMemo(() => {
    const de = new Date(); de.setMonth(de.getMonth() - 2, 1); de.setHours(0, 0, 0, 0);
    const ate = new Date(); ate.setMonth(ate.getMonth() + 4, 1);
    return { de: de.toISOString(), ate: ate.toISOString() };
  }, []);
  const tasks = useWorkTasks({ dueFrom: janela.de, dueTo: janela.ate, assigneeId: soMinhas ? eu : null, includeSubtasks: true, sort: 'due', enabled: !soMinhas || Boolean(eu) });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-nevoa"><input type="checkbox" checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} /> Só as minhas tarefas</label>
      {tasks.isPending ? <Skeleton className="h-96 w-full" /> : <CalendarView tarefas={tasks.data?.rows ?? []} actions={{ abrir: (t) => setAberta(t.id), atualizar: () => undefined, criar: () => undefined }} />}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
