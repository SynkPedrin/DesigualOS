'use client';

import { UserRound } from 'lucide-react';
import { useModoEu } from '@/hooks/use-modo-eu';
import { cn } from '@/lib/utils';

/** Interruptor do modo eu. Ligado: roxo cheio e o texto diz o que está valendo, para ninguém achar que a equipe sumiu. */
export function BotaoModoEu({ className }: { className?: string }) {
  const [ligado, definir] = useModoEu();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => definir(!ligado)}
      title={ligado ? 'Mostrando só as tarefas atribuídas a você. Clique para ver as da equipe.' : 'Mostrar só as tarefas atribuídas a você'}
      className={cn(
        'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors',
        ligado ? 'border-roxo-eletrico bg-roxo-eletrico text-white shadow-glow' : 'border-grafite-elevado text-nevoa hover:border-roxo-eletrico/60 hover:text-branco-cru',
        className,
      )}
    >
      <span className={cn('flex size-6 items-center justify-center rounded-full', ligado ? 'bg-white/20' : 'bg-grafite-elevado')}><UserRound size={14} /></span>
      Modo eu
      <span aria-hidden className={cn('relative h-4 w-7 rounded-full transition-colors', ligado ? 'bg-sucesso' : 'bg-grafite-elevado')}>
        <span className={cn('absolute left-0 top-0.5 size-3 rounded-full bg-white transition-transform', ligado ? 'translate-x-3.5' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}
