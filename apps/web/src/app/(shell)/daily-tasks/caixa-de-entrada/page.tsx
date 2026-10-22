'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/daily-tasks/primitivas';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { useInbox, useMarkInboxRead, type InboxItem } from '@/hooks/use-work-extra';
import { cn } from '@/lib/utils';

function frase(i: InboxItem): string {
  switch (i.action) {
    case 'mentioned': return 'mencionou você em';
    case 'commented': return 'comentou em';
    case 'status_changed': return 'mudou o status de';
    case 'assigned': return 'atribuiu uma pessoa em';
    default: return 'atualizou';
  }
}

export default function CaixaDeEntradaPage() {
  const { data, isPending } = useInbox();
  const lido = useMarkInboxRead();
  const [aberta, setAberta] = useState<string | null>(null);
  if (isPending) return <Skeleton className="h-64 w-full" />;
  const itens = data?.items ?? [];
  if (itens.length === 0) return <EmptyState icon={Inbox} title="Caixa de entrada vazia" description="Menções e mudanças nas suas tarefas feitas por outras pessoas aparecem aqui." />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-nevoa">{data!.unread} não lida(s)</p>
        <button type="button" disabled={data!.unread === 0 || lido.isPending} onClick={() => lido.mutate()} className="rounded border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru disabled:opacity-40">Marcar tudo como lido</button>
      </div>
      <ul className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
        {itens.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => i.taskId && setAberta(i.taskId)} className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-grafite-elevado/40', i.unread && 'bg-sinal/5')}>
              <Avatar nome={i.actorName} url={i.actorAvatar} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm text-branco-cru"><strong>{i.actorName}</strong> {frase(i)} <span className="font-mono text-[11px] text-nevoa">{i.taskKey}</span> {i.taskTitle}</span>
              <span className="shrink-0 text-xs text-nevoa">{new Date(i.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              {i.unread && <span aria-label="Não lida" className="size-2 shrink-0 rounded-full bg-sinal" />}
            </button>
          </li>
        ))}
      </ul>
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
