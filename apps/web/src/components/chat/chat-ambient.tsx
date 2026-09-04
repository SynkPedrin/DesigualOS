'use client';

import { motion } from 'framer-motion';

/**
 * Camada ambiente da home do chat: brilho roxo atrás da fileira de cards e
 * atrás do composer, um acento lime quase imperceptível e vinheta suave sobre
 * a base carbono. Persiste no estado de conversa, só que esmaecida — o fade
 * é só opacity, nada de layout.
 */
export function ChatAmbient({ dimmed }: { dimmed: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      initial={false}
      animate={{ opacity: dimmed ? 0.35 : 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_32%_at_50%_16%,rgba(147,51,234,0.20),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_42%_at_50%_88%,rgba(107,33,168,0.24),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_18%_at_80%_26%,rgba(225,249,0,0.05),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_125%_110%_at_50%_50%,transparent_55%,rgba(15,15,15,0.75)_100%)]" />
    </motion.div>
  );
}
