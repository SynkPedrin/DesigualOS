'use client';

import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { AutomationForm, type AutomationFormValues } from './automation-form';
import { useCreateAutomation } from '@/hooks/use-automations';

export function CreateAutomationModal({ onClose }: { onClose: () => void }) {
  const createAutomation = useCreateAutomation();

  function handleSubmit(values: AutomationFormValues) {
    createAutomation.mutate(
      {
        name: values.name,
        agent: values.agent,
        prompt: values.prompt,
        client_id: values.clientId,
        schedule: values.schedule,
        schedule_label: values.scheduleLabel,
        estimated_minutes_saved: values.estimatedMinutesSaved,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">
            Nova automação
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        <AutomationForm
          isPending={createAutomation.isPending}
          error={createAutomation.isError ? createAutomation.error : null}
          submitLabel="Criar automação"
          pendingLabel="Criando..."
          onSubmit={handleSubmit}
          onCancel={onClose}
        />
      </motion.div>
    </div>
  );
}
