'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, History, X, XCircle } from 'lucide-react';
import { useAutomationRuns } from '@/hooks/use-automations';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/format';
import type { Automation } from '@/lib/api/contracts';

export function AutomationHistoryModal({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { data: runs, isPending } = useAutomationRuns(automation.id);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">
              Histórico
            </h2>
            <p className="mt-0.5 text-xs text-nevoa">{automation.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {isPending ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)
          ) : !runs || runs.length === 0 ? (
            <EmptyState icon={History} title="Ainda não disparou" description="O histórico aparece aqui depois do primeiro disparo." />
          ) : (
            runs.map((run) => (
              <div key={run.id} className="flex items-start gap-2.5 rounded-md border border-grafite-elevado bg-carbono p-3">
                {run.status === 'failed' ? (
                  <XCircle size={16} className="mt-0.5 shrink-0 text-erro" />
                ) : (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-sinal" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-branco-cru">
                    {run.status === 'failed' ? 'Falhou ao disparar' : 'Disparou com sucesso'}
                  </p>
                  {run.error && <p className="mt-0.5 text-xs text-erro">{run.error}</p>}
                  <p className="mt-0.5 font-mono text-[10px] text-nevoa">{formatRelativeTime(run.startedAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
