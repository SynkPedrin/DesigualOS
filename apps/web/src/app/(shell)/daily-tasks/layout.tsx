'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, Settings, Square } from 'lucide-react';
import { Popover } from '@/components/daily-tasks/primitivas';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { useInbox, useTimer, useTimerActions } from '@/hooks/use-work-extra';
import { cn } from '@/lib/utils';
import { TempoCorrendo } from '@/components/daily-tasks/tempo';
import { BotaoModoEu } from '@/components/daily-tasks/modo-eu';

const ABAS: Array<{ href: string; label: string }> = [
  { href: '/daily-tasks', label: 'Tarefas' },
  { href: '/daily-tasks/calendario', label: 'Calendário' },
  { href: '/daily-tasks/meu-trabalho', label: 'Meu Trabalho' },
  { href: '/daily-tasks/caixa-de-entrada', label: 'Caixa de Entrada' },
  { href: '/daily-tasks/relatorios', label: 'Relatórios' },
];
/** Telas em que o modo eu vale. Meu Trabalho já é só seu; Caixa de Entrada e Relatórios têm recorte próprio. */
const COM_MODO_EU = new Set(['/daily-tasks', '/daily-tasks/calendario']);
const GERENCIAMENTO: Array<{ href: string; label: string }> = [
  { href: '/daily-tasks/modelos', label: 'Modelos' },
  { href: '/daily-tasks/automacoes', label: 'Automações' },
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
    return <EmptyState icon={Lock} title="Daily Tasks ainda não foi liberado" description="Este recurso ainda não foi liberado para a sua empresa ou para o seu perfil. Peça a um administrador da plataforma." />;
  }
  const naoLidas = inbox.data?.unread ?? 0;
  const rodando = timer.data?.running ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <nav aria-label="Daily Tasks" className="flex flex-wrap items-center gap-1 border-b border-grafite-elevado">
        {ABAS.map((a) => (
          <Link key={a.href} href={a.href} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', pathname === a.href ? 'border-roxo-eletrico text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru')}>
            {a.label}
            {a.href.endsWith('caixa-de-entrada') && naoLidas > 0 && <span className="rounded-full bg-roxo-eletrico px-1.5 text-[10px] font-semibold text-white">{naoLidas > 99 ? '99+' : naoLidas}</span>}
          </Link>
        ))}
        <span className="ml-auto" />
        {COM_MODO_EU.has(pathname) && <BotaoModoEu className="mb-1.5 mr-1" />}
        <Popover label="Gerenciar" align="right" trigger={<span className={cn('flex items-center gap-1.5 px-2 py-2 text-sm', GERENCIAMENTO.some((g) => g.href === pathname) ? 'font-medium text-branco-cru' : 'text-nevoa')}><Settings size={15} /> Gerenciar</span>}>
          {(fechar) => (
            <nav aria-label="Gerenciamento" className="w-52 p-1">
              {GERENCIAMENTO.map((a) => <Link key={a.href} href={a.href} onClick={fechar} className={cn('block rounded px-3 py-2 text-sm hover:bg-grafite-elevado', pathname === a.href ? 'font-medium text-branco-cru' : 'text-nevoa')}>{a.label}</Link>)}
            </nav>
          )}
        </Popover>
        {rodando && (
          <div className="flex items-center gap-2 rounded-md bg-grafite px-2 py-1 text-xs text-branco-cru" role="status" aria-label="Cronômetro em andamento">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            <span className="max-w-48 truncate" title={rodando.taskTitle}>{rodando.taskKey} · {rodando.taskTitle}</span>
            <TempoCorrendo desde={rodando.startedAt} />
            <button type="button" aria-label="Parar cronômetro" onClick={() => parar.mutate()} className="rounded p-0.5 hover:bg-grafite-elevado"><Square size={12} /></button>
          </div>
        )}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto">{children}</div>
    </div>
  );
}
