'use client';

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, Zap } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { AutomationCard } from '@/components/automations/automation-card';
import { CreateAutomationModal } from '@/components/automations/create-automation-modal';
import { AutomationHistoryModal } from '@/components/automations/automation-history-modal';
import { useAutomations } from '@/hooks/use-automations';
import type { Automation } from '@/lib/api/contracts';

export default function WorkflowsPage() {
  const { data: automations, isPending } = useAutomations();
  const [creating, setCreating] = useState(false);
  const [historyFor, setHistoryFor] = useState<Automation | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Automação"
        title="Automações"
        description="Blocos simples: um agente, um pedido, um horário. Ex: todo dia às 8h o Bento resume o que precisa ser feito no ClickUp."
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
          >
            <Plus size={15} />
            Nova automação
          </button>
        }
      />

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !automations || automations.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Nenhuma automação ainda"
          description="Clique em Nova automação para criar a primeira — ex: um resumo diário do ClickUp."
        />
      ) : (
        <div className="space-y-3">
          {automations.map((automation) => (
            <AutomationCard key={automation.id} automation={automation} onViewHistory={() => setHistoryFor(automation)} />
          ))}
        </div>
      )}

      <AnimatePresence>{creating && <CreateAutomationModal onClose={() => setCreating(false)} />}</AnimatePresence>
      <AnimatePresence>
        {historyFor && <AutomationHistoryModal automation={historyFor} onClose={() => setHistoryFor(null)} />}
      </AnimatePresence>
    </div>
  );
}
