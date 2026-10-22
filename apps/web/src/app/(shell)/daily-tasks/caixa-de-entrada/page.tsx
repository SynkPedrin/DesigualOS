'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Bell, Inbox, ListChecks, MessagesSquare } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/daily-tasks/primitivas';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { useInbox, useMarkInboxRead, type InboxEntry } from '@/hooks/use-work-extra';
import { cn } from '@/lib/utils';

type Filtro = 'tudo' | 'task' | 'communication' | 'mention' | 'system';

function quando(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const ICONE = { task: ListChecks, communication: MessagesSquare, system: Bell } as const;
const ROTULO = { task: 'Tarefa', communication: 'Comunicação', system: 'Sistema' } as const;

export default function CaixaDeEntradaPage() {
  const { data, isPending } = useInbox();
  const lido = useMarkInboxRead();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>('tudo');
  const [aberta, setAberta] = useState<string | null>(null);
  if (isPending) return <Skeleton className="h-64 w-full" />;
  const todos = data?.items ?? [];
  const lista = todos.filter((i) => (filtro === 'tudo' ? true : filtro === 'mention' ? i.mention : i.kind === filtro));
  const abas: Array<{ id: Filtro; rotulo: string; n: number; naoLidas: number }> = [
    { id: 'tudo', rotulo: 'Tudo', n: todos.length, naoLidas: data?.unread ?? 0 },
    { id: 'task', rotulo: 'Tarefas', n: todos.filter((i) => i.kind === 'task').length, naoLidas: data?.unreadByKind.task ?? 0 },
    { id: 'communication', rotulo: 'Comunicação', n: todos.filter((i) => i.kind === 'communication').length, naoLidas: data?.unreadByKind.communication ?? 0 },
    { id: 'mention', rotulo: 'Menções', n: todos.filter((i) => i.mention).length, naoLidas: todos.filter((i) => i.mention && i.unread).length },
    { id: 'system', rotulo: 'Sistema', n: todos.filter((i) => i.kind === 'system').length, naoLidas: data?.unreadByKind.system ?? 0 },
  ];
  const abrir = (i: InboxEntry) => { if (i.kind === 'task' && i.taskId) setAberta(i.taskId); else router.push(i.link); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filtro da caixa" className="flex flex-wrap gap-1">
          {abas.map((a) => (
            <button key={a.id} role="tab" aria-selected={filtro === a.id} type="button" onClick={() => setFiltro(a.id)} className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs', filtro === a.id ? 'bg-sinal text-grafite' : 'bg-grafite-elevado text-nevoa hover:text-branco-cru')}>
              {a.id === 'mention' && <AtSign size={11} />}{a.rotulo}
              {a.naoLidas > 0 && <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', filtro === a.id ? 'bg-grafite text-sinal' : 'bg-sinal text-grafite')}>{a.naoLidas}</span>}
            </button>
          ))}
        </div>
        <button type="button" disabled={(data?.unreadByKind.task ?? 0) + (data?.unreadByKind.system ?? 0) === 0 || lido.isPending} onClick={() => lido.mutate()} className="ml-auto rounded border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru disabled:opacity-40" title="Marca como lidos os avisos de tarefas e do sistema. Mensagens são lidas na própria Comunicação.">Marcar avisos como lidos</button>
      </div>
      {lista.length === 0 ? (
        <EmptyState icon={Inbox} title={filtro === 'tudo' ? 'Caixa de entrada vazia' : 'Nada neste filtro'} description="Aqui chegam mudanças nas suas tarefas, mensagens da Comunicação que você ainda não leu, menções e avisos do sistema." />
      ) : (
        <ul className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
          {lista.map((i) => {
            const Icone = ICONE[i.kind];
            return (
              <li key={i.id}>
                <button type="button" onClick={() => abrir(i)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-grafite-elevado/40', i.unread && 'bg-sinal/5')}>
                  {i.kind === 'system' ? <span className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-grafite-elevado text-nevoa"><Icone size={14} /></span> : <Avatar nome={i.actorName} url={i.actorAvatar} size={28} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-branco-cru"><strong>{i.kind === 'system' ? '' : i.actorName}</strong>{i.verb ? ` ${i.verb} ` : ''}<span className={i.kind === 'system' ? '' : 'font-medium'}>{i.subject}</span></span>
                    {i.snippet && <span className="mt-0.5 block truncate text-xs text-nevoa">“{i.snippet}”</span>}
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-nevoa/70"><Icone size={11} />{ROTULO[i.kind]}{i.mention && <span className="rounded bg-sinal/15 px-1 text-sinal">menção</span>}</span>
                  </span>
                  <span className="shrink-0 text-xs text-nevoa">{quando(i.createdAt)}</span>
                  {i.unread && <span aria-label="Não lida" className="mt-1.5 size-2 shrink-0 rounded-full bg-sinal" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {aberta && <TaskDrawer taskId={aberta} onClose={() => setAberta(null)} onOpen={setAberta} />}
    </div>
  );
}
