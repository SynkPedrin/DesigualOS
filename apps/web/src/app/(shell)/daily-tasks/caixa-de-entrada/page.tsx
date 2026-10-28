'use client';

import { Prazo } from '@/components/ui/prazo';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Bell, Inbox, ListChecks, MessagesSquare, UserCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/daily-tasks/primitivas';
import { EmblemaDePrioridade, prazoRelativo, StatCard } from '@/components/daily-tasks/ui';
import { TaskDrawer } from '@/components/daily-tasks/task-drawer';
import { useInbox, useMarkInboxRead, type InboxEntry } from '@/hooks/use-work-extra';
import { cn } from '@/lib/utils';

type Filtro = 'tudo' | 'assigned' | 'task' | 'communication' | 'mention' | 'system';

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
  const atribuidas = data?.assigned ?? [];
  const lista = todos.filter((i) => (filtro === 'tudo' ? true : filtro === 'mention' ? i.mention : i.kind === filtro));
  const abas: Array<{ id: Filtro; rotulo: string; n: number; naoLidas: number }> = [
    { id: 'tudo', rotulo: 'Tudo', n: todos.length, naoLidas: data?.unread ?? 0 },
    { id: 'assigned', rotulo: 'Atribuídas a mim', n: atribuidas.length, naoLidas: atribuidas.filter((a) => a.dueAt && new Date(a.dueAt) < new Date()).length },
    { id: 'task', rotulo: 'Atividade', n: todos.filter((i) => i.kind === 'task').length, naoLidas: data?.unreadByKind.task ?? 0 },
    { id: 'communication', rotulo: 'Comunicação', n: todos.filter((i) => i.kind === 'communication').length, naoLidas: data?.unreadByKind.communication ?? 0 },
    { id: 'mention', rotulo: 'Menções', n: todos.filter((i) => i.mention).length, naoLidas: todos.filter((i) => i.mention && i.unread).length },
    { id: 'system', rotulo: 'Sistema', n: todos.filter((i) => i.kind === 'system').length, naoLidas: data?.unreadByKind.system ?? 0 },
  ];
  const abrir = (i: InboxEntry) => { if (i.kind === 'task' && i.taskId) setAberta(i.taskId); else router.push(i.link); };
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-semibold text-branco-cru">Caixa de Entrada</h1>
          <p className="text-sm text-nevoa">Tudo que chegou para você: tarefas, mensagens da Comunicação, menções e avisos do sistema.</p>
        </div>
        <button type="button" disabled={(data?.unreadByKind.task ?? 0) + (data?.unreadByKind.system ?? 0) === 0 || lido.isPending} onClick={() => lido.mutate()} className="rounded-lg bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" title="Marca como lidos os avisos de tarefas e do sistema. Mensagens são lidas na própria Comunicação.">Marcar avisos como lidos</button>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {abas.filter((a) => a.id !== 'tudo').map((a) => (
          <StatCard key={a.id} icone={a.id === 'assigned' ? UserCheck : a.id === 'task' ? ListChecks : a.id === 'communication' ? MessagesSquare : a.id === 'mention' ? AtSign : Bell} rotulo={a.rotulo} valor={a.naoLidas} detalhe={a.id === 'assigned' ? `${a.n} abertas · ${a.naoLidas} atrasadas` : `${a.n} no total · clique para filtrar`} tom={a.id === 'assigned' ? (a.naoLidas > 0 ? 'vermelho' : 'verde') : a.id === 'mention' ? 'roxo' : a.id === 'task' ? 'verde' : a.id === 'communication' ? 'amarelo' : 'neutro'} onClick={() => setFiltro(filtro === a.id ? 'tudo' : a.id)} ativo={filtro === a.id} />
        ))}
      </div>
      <div role="tablist" aria-label="Filtro da caixa" className="flex flex-wrap gap-1">
        {abas.map((a) => (
          <button key={a.id} role="tab" aria-selected={filtro === a.id} type="button" onClick={() => setFiltro(a.id)} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm', filtro === a.id ? 'bg-roxo-eletrico font-medium text-white' : 'bg-grafite-elevado text-nevoa hover:text-branco-cru')}>
            {a.rotulo}{a.naoLidas > 0 && <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', filtro === a.id ? 'bg-grafite text-lilas' : 'bg-roxo-eletrico text-white')}>{a.naoLidas}</span>}
          </button>
        ))}
      </div>
      {filtro === 'assigned' ? (
        atribuidas.length === 0 ? (
          <EmptyState icon={UserCheck} title="Nada atribuído a você" description="Quando alguém colocar você como responsável por uma tarefa, ela aparece aqui até ser concluída." />
        ) : (
          <ul className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
            {atribuidas.map((a) => {
              const prazo = prazoRelativo(a.dueAt, false);
              return (
                <li key={a.taskId}>
                  <button type="button" onClick={() => setAberta(a.taskId)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-grafite-elevado/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-branco-cru">{a.title}</span>
                      <span className="block truncate text-xs text-nevoa">{[a.key, a.clientName].filter(Boolean).join(' · ')}</span>
                    </span>
                    {a.priority > 0 && <EmblemaDePrioridade valor={a.priority} />}
                    <span className="rounded bg-grafite-elevado px-2 py-0.5 text-[11px] font-semibold uppercase text-branco-cru">{a.statusName}</span>
                    <span className="flex w-28 shrink-0 flex-col items-end gap-0.5 text-right text-xs">{prazo ? <><span className="text-nevoa">{prazo.data}</span><Prazo prazo={a.dueAt} /></> : <span className="text-nevoa">sem prazo</span>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : lista.length === 0 ? (
        <EmptyState icon={Inbox} title={filtro === 'tudo' ? 'Caixa de entrada vazia' : 'Nada neste filtro'} description="Aqui chegam mudanças nas suas tarefas, mensagens da Comunicação que você ainda não leu, menções e avisos do sistema." />
      ) : (
        <ul className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
          {lista.map((i) => {
            const Icone = ICONE[i.kind];
            return (
              <li key={i.id}>
                <button type="button" onClick={() => abrir(i)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-grafite-elevado/40', i.unread && 'bg-roxo-eletrico/5')}>
                  {i.kind === 'system' ? <span className="mt-0.5 flex size-7 items-center justify-center rounded-full bg-grafite-elevado text-nevoa"><Icone size={14} /></span> : <Avatar nome={i.actorName} url={i.actorAvatar} size={28} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-branco-cru"><strong>{i.kind === 'system' ? '' : i.actorName}</strong>{i.verb ? ` ${i.verb} ` : ''}<span className={i.kind === 'system' ? '' : 'font-medium'}>{i.subject}</span></span>
                    {i.snippet && <span className="mt-0.5 block truncate text-xs text-nevoa">“{i.snippet}”</span>}
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-nevoa/70"><Icone size={11} />{ROTULO[i.kind]}{i.mention && <span className="rounded bg-roxo-eletrico/15 px-1 text-lilas">menção</span>}</span>
                  </span>
                  <span className="shrink-0 text-xs text-nevoa">{quando(i.createdAt)}</span>
                  {i.unread && <span aria-label="Não lida" className="mt-1.5 size-2 shrink-0 rounded-full bg-roxo-eletrico" />}
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
