'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, Square } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useInbox, useTimer, useTimerActions } from '@/hooks/use-work-extra';
import { cn } from '@/lib/utils';
import { TempoCorrendo } from '@/components/daily-tasks/tempo';

const ABAS: Array<{ href: string; label: string }> = [
  { href: '/daily-tasks', label: 'Todas as Tarefas' },
  { href: '/daily-tasks/meu-trabalho', label: 'Meu Trabalho' },
  { href: '/daily-tasks/caixa-de-entrada', label: 'Caixa de Entrada' },
  { href: '/daily-tasks/calendario', label: 'Calendário' },
  { href: '/daily-tasks/automacoes', label: 'Automações' },
  { href: '/daily-tasks/relatorios', label: 'Relatórios' },
  { href: '/daily-tasks/modelos', label: 'Modelos' },
  { href: '/daily-tasks/configuracoes', label: 'Configurações' },
];

export default function DailyTasksLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, isPending } = useDailyTasksAccess();
  const liberado = data?.allowed === true;
  const inbox = useInbox();
  const timer = useTimer();
  const { parar } = useTimerActions();

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (!liberado) {
    // O servidor recusa de qualquer jeito (403); aqui só evitamos uma tela quebrada para quem digitou o endereço.
    return <EmptyState icon={Lock} title="Daily Tasks está em beta fechado" description="Este recurso ainda não foi liberado para a sua empresa ou para o seu perfil. Peça a um administrador da plataforma." />;
  }
  const naoLidas = inbox.data?.unread ?? 0;
  const rodando = timer.data?.running ?? null;
  return (
    <div className="space-y-4">
      <nav aria-label="Daily Tasks" className="flex flex-wrap items-center gap-1 border-b border-grafite-elevado">
        {ABAS.map((a) => (
          <Link key={a.href} href={a.href} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', pathname === a.href ? 'border-sinal text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru')}>
            {a.label}
            {a.href.endsWith('caixa-de-entrada') && naoLidas > 0 && <span className="rounded-full bg-sinal px-1.5 text-[10px] font-semibold text-grafite">{naoLidas > 99 ? '99+' : naoLidas}</span>}
          </Link>
        ))}
        {rodando && (
          <div className="ml-auto flex items-center gap-2 rounded-md bg-grafite px-2 py-1 text-xs text-branco-cru" role="status" aria-label="Cronômetro em andamento">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            <span className="max-w-48 truncate" title={rodando.taskTitle}>{rodando.taskKey} · {rodando.taskTitle}</span>
            <TempoCorrendo desde={rodando.startedAt} />
            <button type="button" aria-label="Parar cronômetro" onClick={() => parar.mutate()} className="rounded p-0.5 hover:bg-grafite-elevado"><Square size={12} /></button>
          </div>
        )}
      </nav>
      {children}
    </div>
  );
}
