'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/** Confirmação destrutiva genérica: foco inicial no "Cancelar" pra ninguém
 * apagar nada com um Enter distraído; Esc fecha. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Excluir',
  isPending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-carbono/80 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-sm rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">{title}</h2>
        <p className="mt-2 text-sm text-nevoa">{description}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-erro/90 px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:bg-erro disabled:opacity-50"
          >
            {isPending ? 'Excluindo...' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
