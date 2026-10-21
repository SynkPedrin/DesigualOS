'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { cn } from '@/lib/utils';

/** Só o que EXISTE é link; o resto aparece apagado, com a etapa do roadmap — nada de aba que leva a tela vazia. */
const ABAS: Array<{ href: string; label: string; pronta: boolean }> = [
  { href: '/daily-tasks', label: 'Todas as Tarefas', pronta: true },
  { href: '/daily-tasks/meu-trabalho', label: 'Meu Trabalho', pronta: false },
  { href: '/daily-tasks/caixa-de-entrada', label: 'Caixa de Entrada', pronta: false },
  { href: '/daily-tasks/calendario', label: 'Calendário', pronta: false },
  { href: '/daily-tasks/automacoes', label: 'Automações', pronta: false },
  { href: '/daily-tasks/relatorios', label: 'Relatórios', pronta: false },
  { href: '/daily-tasks/modelos', label: 'Modelos', pronta: false },
  { href: '/daily-tasks/configuracoes', label: 'Configurações', pronta: false },
];

export default function DailyTasksLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, isPending } = useDailyTasksAccess();

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (data?.allowed !== true) {
    // O servidor recusa de qualquer jeito (403); aqui só evitamos uma tela quebrada para quem digitou o endereço.
    return (
      <EmptyState
        icon={Lock}
        title="Daily Tasks está em beta fechado"
        description="Este recurso ainda não foi liberado para a sua empresa ou para o seu perfil. Peça a um administrador da plataforma."
      />
    );
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Daily Tasks" className="flex flex-wrap gap-1 border-b border-grafite-elevado">
        {ABAS.map((a) =>
          a.pronta ? (
            <Link
              key={a.href}
              href={a.href}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                pathname === a.href ? 'border-sinal text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru',
              )}
            >
              {a.label}
            </Link>
          ) : (
            <span key={a.href} title="Ainda não disponível nesta versão beta" className="cursor-not-allowed px-3 py-2 text-sm text-nevoa/40">
              {a.label}
            </span>
          ),
        )}
      </nav>
      {children}
    </div>
  );
}
