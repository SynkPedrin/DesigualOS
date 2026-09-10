'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const VARIANT_STYLE = {
  success: { icon: CheckCircle2, className: 'border-sinal/40 text-sinal' },
  error: { icon: AlertTriangle, className: 'border-erro/40 text-erro' },
  info: { icon: Info, className: 'border-roxo-eletrico/40 text-branco-cru' },
} as const;

/** Pilha de feedback flutuante (canto inferior direito). Montada por tela que usa toast():
 * Studio e workspace do cliente, hoje. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((item) => {
          const style = VARIANT_STYLE[item.variant];
          const Icon = style.icon;
          return (
            <motion.div
              key={item.id}
              role="status"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-grafite px-3.5 py-3 shadow-elevated',
                style.className,
              )}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <p className="flex-1 text-sm text-branco-cru">{item.message}</p>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Fechar notificação"
                className="shrink-0 text-nevoa transition-colors hover:text-branco-cru"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
