'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ListFilter, Search, X } from 'lucide-react';
import type { AgentName } from '@desigual-os/types';
import { AGENT_META } from '@/lib/agent-meta';
import { useClients } from '@/hooks/use-clients';
import { cn } from '@/lib/utils';

export type StatusFilter = 'all' | 'active' | 'paused' | 'error';
export type LastRunPeriod = 'any' | 'today' | '7d' | '30d' | 'never';
export type LastResult = 'any' | 'success' | 'error';
export type AutomationSort =
  | 'recent'
  | 'oldest'
  | 'name-asc'
  | 'name-desc'
  | 'last-run'
  | 'most-runs'
  | 'errors';

export interface AutomationFilters {
  query: string;
  status: StatusFilter;
  agent: 'all' | AgentName;
  project: 'all' | 'none' | string;
  lastRunPeriod: LastRunPeriod;
  lastResult: LastResult;
}

export const DEFAULT_FILTERS: AutomationFilters = {
  query: '',
  status: 'all',
  agent: 'all',
  project: 'all',
  lastRunPeriod: 'any',
  lastResult: 'any',
};

export const SORT_OPTIONS: Array<{ value: AutomationSort; label: string }> = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigas' },
  { value: 'name-asc', label: 'Nome A-Z' },
  { value: 'name-desc', label: 'Nome Z-A' },
  { value: 'last-run', label: 'Última execução' },
  { value: 'most-runs', label: 'Mais executadas' },
  { value: 'errors', label: 'Com erro' },
];

const selectClass =
  'appearance-none rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-2 pr-7 text-sm text-branco-cru transition-colors focus:border-roxo-eletrico/60 focus:outline-none';

function ToolbarSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">
      {label}:
      <span className="relative flex items-center">
        <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
          {children}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-2 text-nevoa" />
      </span>
    </label>
  );
}

export function AutomationToolbar({
  filters,
  onChange,
  sort,
  onSortChange,
  agentOptions,
  onClear,
}: {
  filters: AutomationFilters;
  onChange: (patch: Partial<AutomationFilters>) => void;
  sort: AutomationSort;
  onSortChange: (sort: AutomationSort) => void;
  agentOptions: AgentName[];
  onClear: () => void;
}) {
  const { data: clients } = useClients();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const extraFiltersActive = filters.lastRunPeriod !== 'any' || filters.lastResult !== 'any';
  const hasActiveFilters =
    filters.query.trim() !== '' ||
    filters.status !== 'all' ||
    filters.agent !== 'all' ||
    filters.project !== 'all' ||
    extraFiltersActive;

  useEffect(() => {
    if (!moreOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex min-w-44 flex-1 items-center">
        <Search size={14} className="pointer-events-none absolute left-3 text-nevoa" />
        <input
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Buscar automações..."
          aria-label="Buscar automações"
          className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-9 pr-3 text-sm text-branco-cru placeholder:text-nevoa transition-colors focus:border-roxo-eletrico/60 focus:outline-none"
        />
      </div>

      <ToolbarSelect label="Status" value={filters.status} onChange={(status) => onChange({ status: status as StatusFilter })}>
        <option value="all">Todas</option>
        <option value="active">Ativas</option>
        <option value="paused">Pausadas</option>
        <option value="error">Com erro</option>
      </ToolbarSelect>

      <ToolbarSelect label="Agente" value={filters.agent} onChange={(agent) => onChange({ agent: agent as AutomationFilters['agent'] })}>
        <option value="all">Todos</option>
        {agentOptions.map((agent) => (
          <option key={agent} value={agent}>
            {AGENT_META[agent].label}
          </option>
        ))}
      </ToolbarSelect>

      <ToolbarSelect label="Projeto" value={filters.project} onChange={(project) => onChange({ project })}>
        <option value="all">Todos</option>
        <option value="none">Sem cliente</option>
        {clients?.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </ToolbarSelect>

      <div ref={moreRef} className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
            extraFiltersActive
              ? 'border-roxo-eletrico/60 bg-roxo-eletrico/10 text-branco-cru'
              : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
          )}
        >
          <ListFilter size={14} />
          Mais filtros
          {extraFiltersActive && <span className="size-1.5 rounded-full bg-sinal" />}
        </button>

        {moreOpen && (
          <div className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-grafite-elevado bg-grafite p-3 shadow-elevated">
            <div className="space-y-3">
              <div>
                <label htmlFor="filter-period" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  Última execução
                </label>
                <select
                  id="filter-period"
                  value={filters.lastRunPeriod}
                  onChange={(event) => onChange({ lastRunPeriod: event.target.value as LastRunPeriod })}
                  className={cn(selectClass, 'w-full')}
                >
                  <option value="any">Qualquer período</option>
                  <option value="today">Hoje</option>
                  <option value="7d">Últimos 7 dias</option>
                  <option value="30d">Últimos 30 dias</option>
                  <option value="never">Nunca executada</option>
                </select>
              </div>
              <div>
                <label htmlFor="filter-result" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  Último resultado
                </label>
                <select
                  id="filter-result"
                  value={filters.lastResult}
                  onChange={(event) => onChange({ lastResult: event.target.value as LastResult })}
                  className={cn(selectClass, 'w-full')}
                >
                  <option value="any">Qualquer</option>
                  <option value="success">Sucesso</option>
                  <option value="error">Erro</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-nevoa transition-colors hover:text-branco-cru"
        >
          <X size={13} />
          Limpar filtros
        </button>
      )}

      <div className="ml-auto">
        <ToolbarSelect label="Ordenar por" value={sort} onChange={(value) => onSortChange(value as AutomationSort)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </ToolbarSelect>
      </div>
    </div>
  );
}
