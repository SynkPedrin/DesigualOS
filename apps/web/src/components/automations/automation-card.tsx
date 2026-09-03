'use client';

import { History, Trash2 } from 'lucide-react';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { AGENT_META } from '@/lib/agent-meta';
import { useDeleteAutomation, useToggleAutomation } from '@/hooks/use-automations';
import { formatRelativeTime } from '@/lib/format';
import type { Automation } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

export function AutomationCard({ automation, onViewHistory }: { automation: Automation; onViewHistory: () => void }) {
  const meta = AGENT_META[automation.agent];
  const toggle = useToggleAutomation();
  const deleteAutomation = useDeleteAutomation();

  function handleDelete() {
    if (!window.confirm(`Excluir a automação "${automation.name}"? Ela para de disparar imediatamente.`)) return;
    deleteAutomation.mutate(automation.id);
  }

  return (
    <div className="flex items-start gap-4 rounded-lg border border-grafite-elevado bg-grafite p-4">
      <AgentAvatar agent={automation.agent} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-heading text-sm font-semibold text-branco-cru">{automation.name}</p>
          <span className={cn('font-mono text-[10px] uppercase tracking-wider', meta.textClass)}>{meta.label}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-nevoa">{automation.prompt}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-nevoa">
          <span>{automation.scheduleLabel}</span>
          <span>
            {automation.lastRunAt ? `Último disparo: ${formatRelativeTime(automation.lastRunAt)}` : 'Ainda não disparou'}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onViewHistory}
          aria-label="Ver histórico"
          title="Ver histórico"
          className="rounded-md p-2 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
        >
          <History size={15} />
        </button>
        <button
          type="button"
          onClick={() => toggle.mutate({ id: automation.id, enabled: !automation.enabled })}
          disabled={toggle.isPending}
          aria-label={automation.enabled ? 'Desativar automação' : 'Ativar automação'}
          title={automation.enabled ? 'Ativa — clique para pausar' : 'Pausada — clique para ativar'}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50',
            automation.enabled ? 'border-sinal bg-sinal/20' : 'border-grafite-elevado bg-carbono',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-4 rounded-full transition-transform',
              automation.enabled ? 'translate-x-[22px] bg-sinal' : 'translate-x-0.5 bg-nevoa',
            )}
          />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteAutomation.isPending}
          aria-label="Excluir automação"
          title="Excluir automação"
          className="rounded-md p-2 text-nevoa transition-colors hover:bg-erro/10 hover:text-erro disabled:opacity-50"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
