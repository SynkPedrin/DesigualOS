'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ItemDoMenu {
  rotulo: string;
  icone?: ReactNode;
  /** Link (WhatsApp, telefone) abre fora; ação roda aqui. Um dos dois. */
  href?: string;
  acao?: () => void;
  desabilitado?: boolean;
}

/** Menu dos botões do cabeçalho da conversa. Fecha ao escolher, ao clicar fora e com Esc. */
export function MenuDoCabecalho({ rotulo, icone, itens, className }: { rotulo: string; icone: ReactNode; itens: ItemDoMenu[]; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function fora(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setAberto(false);
    }
    function esc(event: KeyboardEvent) {
      if (event.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const classeDoItem = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-branco-cru transition-colors hover:bg-carbono disabled:pointer-events-none disabled:opacity-40';

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        title={rotulo}
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={cn('flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru', aberto && 'bg-grafite-elevado text-branco-cru')}
      >
        {icone}
      </button>
      {aberto && (
        <div role="menu" aria-label={rotulo} className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-grafite-elevado bg-grafite-elevado p-1 shadow-elevated">
          {itens.map((item) =>
            item.href && !item.desabilitado ? (
              <a key={item.rotulo} role="menuitem" href={item.href} target={item.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" onClick={() => setAberto(false)} className={classeDoItem}>
                {item.icone}{item.rotulo}
              </a>
            ) : (
              <button key={item.rotulo} type="button" role="menuitem" disabled={item.desabilitado} onClick={() => { setAberto(false); item.acao?.(); }} className={classeDoItem}>
                {item.icone}{item.rotulo}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
