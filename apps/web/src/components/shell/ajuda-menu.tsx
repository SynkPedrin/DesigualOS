'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { GraduationCap, HelpCircle, Search, Sparkles } from 'lucide-react';
import { Surface } from '@/components/ui/surface';

const ATALHOS: Array<[string, string]> = [
  ['⌘/Ctrl K', 'Buscar cliente, tarefa, conversa'],
  ['⌘/Ctrl B', 'Recolher ou abrir o menu lateral'],
];

/**
 * O "?" da barra do topo. No celular, Tutorial e Perguntar ao Bento não cabem na barra e ficam escondidos: este menu
 * é o caminho até eles em qualquer tela.
 */
export function AjudaMenu({ onTutorial, onBuscar }: { onTutorial: () => void; onBuscar: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const item = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-branco-cru transition-colors hover:bg-carbono';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Ajuda"
        title="Ajuda"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
      >
        <HelpCircle size={18} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-[80] mt-2 w-72"
          >
            <Surface level="elevado" glow className="p-2">
              <p className="px-2 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-nevoa">Ajuda</p>
              <div role="menu" aria-label="Ajuda" className="space-y-0.5">
                <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onTutorial(); }}>
                  <GraduationCap size={16} className="shrink-0 text-nevoa" />
                  Tutorial do Desigual OS
                </button>
                <Link href="/chat" role="menuitem" className={item} onClick={() => setOpen(false)}>
                  <Sparkles size={16} className="shrink-0 text-roxo-eletrico" />
                  Perguntar ao Bento
                </Link>
                <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onBuscar(); }}>
                  <Search size={16} className="shrink-0 text-nevoa" />
                  Buscar em tudo
                </button>
              </div>
              <div className="mt-2 space-y-1.5 border-t border-grafite px-3 pb-1 pt-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa/70">Atalhos</p>
                {ATALHOS.map(([tecla, faz]) => (
                  <p key={tecla} className="flex items-center justify-between gap-3 text-xs text-nevoa">
                    <span>{faz}</span>
                    <kbd className="shrink-0 rounded border border-grafite bg-carbono px-1.5 py-0.5 font-mono text-[10px]">{tecla}</kbd>
                  </p>
                ))}
              </div>
            </Surface>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
