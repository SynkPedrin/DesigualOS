'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './sidebar';
import { useUiStore } from '@/stores/ui-store';

/**
 * Abaixo do breakpoint md a Sidebar de largura fixa (ver sidebar.tsx) fica escondida e essa
 * gaveta assume: overlay + painel deslizando da esquerda, com o mesmo conteúdo da sidebar
 * (reaproveitado via variant="drawer", nunca duplicado). Aberta pelo botão hamburger no
 * Topbar, fecha sozinha ao navegar, clicar fora, ou Esc.
 */
export function MobileNavDrawer() {
  const open = useUiStore((state) => state.mobileNavOpen);
  const close = useUiStore((state) => state.setMobileNavOpen);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[130] md:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 bg-carbono/80 backdrop-blur-sm"
            onClick={() => close(false)}
            aria-hidden="true"
          />
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative h-full w-64 shadow-elevated"
            role="dialog"
            aria-modal="true"
            aria-label="Navegação principal"
          >
            <Sidebar variant="drawer" onNavigate={() => close(false)} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
