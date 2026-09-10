'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { useBrandAssets } from '@/hooks/use-brand-assets';
import { StudioContent } from './studio-content';

const INTRO_DURATION_MS = 1100;

/** Studio opens as a popup instead of a page navigation, with a brief entrance animation
 * (no video asset exists yet, so this is built in CSS/Framer Motion) before the real tool. */
export function StudioModal() {
  const open = useUiStore((state) => state.studioModalOpen);
  const setOpen = useUiStore((state) => state.setStudioModalOpen);
  const { wallpaperSrc } = useBrandAssets();
  const [phase, setPhase] = useState<'intro' | 'content'>('intro');

  useEffect(() => {
    if (!open) return;
    setPhase('intro');
    const timer = setTimeout(() => setPhase('content'), INTRO_DURATION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-carbono/80 p-3 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => phase === 'content' && setOpen(false)}
        >
          <motion.div
            className="relative flex h-full max-h-[1400px] w-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-grafite-elevado bg-carbono shadow-elevated"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar Studio"
              className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
            >
              <X size={18} />
            </button>

            <AnimatePresence mode="wait">
              {phase === 'intro' ? (
                <motion.div
                  key="intro"
                  className="relative flex flex-1 items-center justify-center overflow-hidden"
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Image src={wallpaperSrc} alt="" fill sizes="100vw" className="object-cover opacity-40" />
                  <div className="absolute inset-0 bg-gradient-to-b from-carbono/60 via-carbono/80 to-carbono" />
                  <div className="relative z-10 flex flex-col items-center gap-4">
                    <motion.div
                      className="relative flex size-20 items-center justify-center rounded-full bg-agent-studio text-carbono"
                      animate={{
                        boxShadow: [
                          '0 0 0px rgba(225,249,0,0)',
                          '0 0 40px rgba(225,249,0,0.6)',
                          '0 0 0px rgba(225,249,0,0)',
                        ],
                      }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <Sparkles size={32} />
                    </motion.div>
                    <motion.p
                      className="font-display text-xl font-black uppercase tracking-tight text-branco-cru"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                    >
                      Abrindo o Studio
                    </motion.p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="content"
                  className="flex-1 overflow-hidden p-8"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* boundedHeight: dentro do modal nada rola exceto a coluna
                   * do formulário "Novo projeto" (pedido do usuário,
                   * 2026-09-05) - a galeria agora é paginada, não cresce
                   * mais sem limite, então o resto não precisa de scroll. */}
                  <StudioContent boundedHeight />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
