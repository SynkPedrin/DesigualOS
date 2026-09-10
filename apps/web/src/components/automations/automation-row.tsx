'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AtSign,
  CalendarClock,
  CheckSquare,
  Clock,
  LineChart,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { NodeStatus } from '@desigual-os/types';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { AutomationActionsMenu } from './automation-actions-menu';
import { AGENT_META } from '@/lib/agent-meta';
import { ToggleAutomationError, useToggleAutomation } from '@/hooks/use-automations';
import { formatRelativeTime } from '@/lib/format';
import type { Automation } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/** Resumo dos runs de uma automação, montado pela página via useQueries
 * (1 fetch por automação visível na página, cacheado, sem polling). */
export interface AutomationRunSummary {
  lastStatus: string | null;
  runCount: number;
}

export function automationIcon(automation: Automation): LucideIcon {
  const text = `${automation.name} ${automation.prompt}`.toLowerCase();
  if (text.includes('clickup')) return CheckSquare;
  if (/tráfego|trafego|relatório|relatorio|report/.test(text)) return LineChart;
  if (text.includes('menç') || text.includes('menc')) return AtSign;
  if (text.includes('briefing') || text.includes('resumo')) return CalendarClock;
  if (text.includes('cliente')) return Users;
  return Zap;
}

function AutomationToggle({ automation, disabled }: { automation: Automation; disabled: boolean }) {
  const toggle = useToggleAutomation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMessage) return;
    const timeout = setTimeout(() => setErrorMessage(null), 5000);
    return () => clearTimeout(timeout);
  }, [errorMessage]);

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={automation.enabled}
        onClick={() =>
          toggle.mutate(
            { id: automation.id, enabled: !automation.enabled },
            {
              onError: (error) => {
                if (error instanceof ToggleAutomationError) setErrorMessage(error.message);
              },
            },
          )
        }
        disabled={disabled || toggle.isPending}
        aria-label={automation.enabled ? `Pausar automação ${automation.name}` : `Ativar automação ${automation.name}`}
        title={automation.enabled ? 'Ativa - clique para pausar' : 'Pausada - clique para ativar'}
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
      {errorMessage && (
        <p role="alert" className="mt-1 max-w-36 text-[11px] leading-tight text-erro">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function LastRunCell({
  automation,
  summary,
  isRunning,
}: {
  automation: Automation;
  summary: AutomationRunSummary | undefined;
  isRunning: boolean;
}) {
  if (isRunning) {
    return (
      <span className="inline-flex animate-pulse items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-aviso">
        <span className="size-1.5 rounded-full bg-aviso" />
        Executando...
      </span>
    );
  }
  if (!automation.lastRunAt) {
    return <span className="text-xs text-nevoa">Nunca executada</span>;
  }
  return (
    <div>
      <p className="text-xs text-branco-cru">{formatRelativeTime(automation.lastRunAt)}</p>
      {summary?.lastStatus && (
        <p
          className={cn(
            'mt-0.5 font-mono text-[10px] uppercase tracking-wider',
            summary.lastStatus === 'failed' ? 'text-erro' : 'text-sucesso',
          )}
        >
          {summary.lastStatus === 'failed' ? 'Erro' : 'Sucesso'}
        </p>
      )}
    </div>
  );
}

interface AutomationRowProps {
  automation: Automation;
  index: number;
  clientName: string | null;
  agentStatus: NodeStatus | undefined;
  runSummary: AutomationRunSummary | undefined;
  isRunning: boolean;
  onEdit: () => void;
  onViewHistory: () => void;
  onRunNow: () => void;
}

const rowTransition = (index: number) => ({ duration: 0.25, delay: index * 0.04, ease: 'easeOut' as const });

function AgentCell({ automation, agentStatus }: { automation: Automation; agentStatus: NodeStatus | undefined }) {
  const meta = AGENT_META[automation.agent];
  return (
    <div className="flex items-center gap-2.5">
      <AgentAvatar agent={automation.agent} size="sm" />
      <div>
        <p className="text-sm text-branco-cru">{meta.label}</p>
        <p className="flex items-center gap-1.5 text-xs text-nevoa">
          {agentStatus === 'online' && <span className="size-1.5 rounded-full bg-sinal" title="Online" />}
          {meta.role}
        </p>
      </div>
    </div>
  );
}

function ProjectBadge({ clientName }: { clientName: string | null }) {
  return (
    <span className="inline-flex max-w-44 truncate rounded-full bg-roxo-eletrico/10 px-2.5 py-1 text-xs text-ametista">
      {clientName ?? 'Sem cliente'}
    </span>
  );
}

function ScheduleCell({ automation }: { automation: Automation }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-nevoa">
      <Clock size={13} className="shrink-0" />
      {automation.scheduleLabel || 'Manual'}
    </span>
  );
}

function NameCell({ automation }: { automation: Automation }) {
  const Icon = automationIcon(automation);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico/10 text-ametista">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate font-heading text-sm font-semibold text-branco-cru">{automation.name}</p>
        <p className="line-clamp-1 text-xs text-nevoa">{automation.prompt}</p>
      </div>
    </div>
  );
}

export function AutomationRow({ automation, index, clientName, agentStatus, runSummary, isRunning, onEdit, onViewHistory, onRunNow }: AutomationRowProps) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={rowTransition(index)}
      className={cn('transition-colors hover:bg-grafite-elevado/40', isRunning && 'opacity-90')}
    >
      <td className="px-4 py-3">
        <NameCell automation={automation} />
      </td>
      <td className="px-4 py-3">
        <AgentCell automation={automation} agentStatus={agentStatus} />
      </td>
      <td className="px-4 py-3">
        <ProjectBadge clientName={clientName} />
      </td>
      <td className="px-4 py-3">
        <ScheduleCell automation={automation} />
      </td>
      <td className="px-4 py-3">
        <LastRunCell automation={automation} summary={runSummary} isRunning={isRunning} />
      </td>
      <td className="px-4 py-3">
        <AutomationToggle automation={automation} disabled={isRunning} />
      </td>
      <td className="px-4 py-3 text-right">
        <AutomationActionsMenu
          automation={automation}
          disabled={isRunning}
          onRunNow={onRunNow}
          onEdit={onEdit}
          onViewHistory={onViewHistory}
        />
      </td>
    </motion.tr>
  );
}

/** Versão card empilhada da linha, usada abaixo de `md` onde a tabela não cabe. */
export function AutomationMobileCard({ automation, index, clientName, agentStatus, runSummary, isRunning, onEdit, onViewHistory, onRunNow }: AutomationRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={rowTransition(index)}
      className="space-y-3 px-4 py-4"
    >
      <div className="flex items-start justify-between gap-3">
        <NameCell automation={automation} />
        <AutomationActionsMenu
          automation={automation}
          disabled={isRunning}
          onRunNow={onRunNow}
          onEdit={onEdit}
          onViewHistory={onViewHistory}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AgentCell automation={automation} agentStatus={agentStatus} />
        <ProjectBadge clientName={clientName} />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-grafite-elevado/60 pt-3">
        <div className="space-y-1">
          <ScheduleCell automation={automation} />
          <LastRunCell automation={automation} summary={runSummary} isRunning={isRunning} />
        </div>
        <AutomationToggle automation={automation} disabled={isRunning} />
      </div>
    </motion.div>
  );
}
