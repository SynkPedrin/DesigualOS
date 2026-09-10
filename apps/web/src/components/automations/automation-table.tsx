'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AgentName, NodeStatus } from '@desigual-os/types';
import { Surface } from '@/components/ui/surface';
import { AutomationMobileCard, AutomationRow, type AutomationRunSummary } from './automation-row';
import type { Automation } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const COLUMNS = ['Automação', 'Agente', 'Projeto', 'Agenda', 'Última execução', 'Status', 'Ações'];

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

export function AutomationTable({
  toolbar,
  automations,
  totalFiltered,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  runSummaries,
  runningIds,
  clientNameFor,
  agentStatusFor,
  onEdit,
  onViewHistory,
  onRunNow,
}: {
  toolbar: React.ReactNode;
  automations: Automation[];
  totalFiltered: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  runSummaries: Record<string, AutomationRunSummary>;
  runningIds: ReadonlySet<string>;
  clientNameFor: (clientId: string | null) => string | null;
  agentStatusFor: (agent: AgentName) => NodeStatus | undefined;
  onEdit: (automation: Automation) => void;
  onViewHistory: (automation: Automation) => void;
  onRunNow: (automation: Automation) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const from = totalFiltered === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalFiltered, page * pageSize);

  const rowProps = (automation: Automation) => ({
    clientName: clientNameFor(automation.clientId),
    agentStatus: agentStatusFor(automation.agent),
    runSummary: runSummaries[automation.id],
    isRunning: runningIds.has(automation.id),
    onEdit: () => onEdit(automation),
    onViewHistory: () => onViewHistory(automation),
    onRunNow: () => onRunNow(automation),
  });

  return (
    <Surface level="grafite" className="overflow-hidden">
      <div className="border-b border-grafite-elevado/60 p-3">{toolbar}</div>

      {/* Desktop: tabela com min-width pra telas médias rolarem horizontalmente. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-b border-grafite-elevado/60">
              {COLUMNS.map((column, i) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    'px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-nevoa',
                    i === COLUMNS.length - 1 && 'text-right',
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-grafite-elevado/60">
            {automations.map((automation, i) => (
              <AutomationRow key={automation.id} automation={automation} index={i} {...rowProps(automation)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: mesma informação em cards empilhados. */}
      <div className="divide-y divide-grafite-elevado/60 md:hidden">
        {automations.map((automation, i) => (
          <AutomationMobileCard key={automation.id} automation={automation} index={i} {...rowProps(automation)} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-grafite-elevado/60 px-4 py-3">
        <p className="text-xs text-nevoa">
          Mostrando {from} a {to} de {totalFiltered} automações
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Página anterior"
            className="rounded-md p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              aria-label={`Página ${pageNumber}`}
              aria-current={pageNumber === page ? 'page' : undefined}
              className={cn(
                'min-w-7 rounded-md px-2 py-1 text-xs transition-colors',
                pageNumber === page
                  ? 'bg-roxo-eletrico font-medium text-branco-cru'
                  : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
              )}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Próxima página"
            className="rounded-md p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-nevoa">
          <span className="relative flex items-center">
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="appearance-none rounded-md border border-grafite-elevado bg-carbono py-1 pl-2 pr-6 text-xs text-branco-cru transition-colors focus:border-roxo-eletrico/60 focus:outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-1.5 text-nevoa" />
          </span>
          por página
        </label>
      </div>
    </Surface>
  );
}
