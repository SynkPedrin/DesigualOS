'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Plus, SearchX, Zap } from 'lucide-react';
import { AGENT_NAMES, type AgentName, type NodeStatus } from '@desigual-os/types';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { AutomationMetrics } from '@/components/automations/automation-metrics';
import {
  AutomationToolbar,
  DEFAULT_FILTERS,
  type AutomationFilters,
  type AutomationSort,
} from '@/components/automations/automation-toolbar';
import { AutomationTable, PAGE_SIZE_OPTIONS } from '@/components/automations/automation-table';
import type { AutomationRunSummary } from '@/components/automations/automation-row';
import { CreateAutomationModal } from '@/components/automations/create-automation-modal';
import { EditAutomationModal } from '@/components/automations/edit-automation-modal';
import { AutomationHistoryModal } from '@/components/automations/automation-history-modal';
import { useAutomations, useRunAutomationNow } from '@/hooks/use-automations';
import { useClients } from '@/hooks/use-clients';
import { useIsMaster } from '@/hooks/use-is-master';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { apiFetch } from '@/lib/api/client';
import {
  mapAutomationRun,
  type Automation,
  type AutomationRunWire,
} from '@/lib/api/contracts';

/** A listagem não expõe o status do último run, então a página busca os runs de
 * cada automação (useQueries, cacheado, sem polling) pra alimentar a coluna
 * "Última execução", o filtro "Com erro" e as ordenações por execuções/erros.
 * O teto evita fan-out de requests em contas com muitas automações. */
const RUN_SUMMARY_LIMIT = 50;

/** O useQueries dispara todos os queryFns de uma vez: sem este semáforo, uma
 * conta com 50 automações abria 50 GET /automations/:id/runs em paralelo no
 * load. 6 por vez mantém os dados (filtros e ordenações usam os resumos de
 * TODAS as linhas, não só da página atual) sem mudar a UI. */
const MAX_CONCURRENT_RUN_FETCHES = 6;
let activeRunFetches = 0;
const runFetchQueue: Array<() => void> = [];

function acquireRunFetchSlot(): Promise<void> {
  if (activeRunFetches < MAX_CONCURRENT_RUN_FETCHES) {
    activeRunFetches += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => runFetchQueue.push(resolve));
}

function releaseRunFetchSlot() {
  const next = runFetchQueue.shift();
  if (next) next();
  else activeRunFetches -= 1;
}

async function fetchAutomationRuns(automationId: string) {
  await acquireRunFetchSlot();
  try {
    const wire = await apiFetch<{ runs: AutomationRunWire[] }>(`/automations/${automationId}/runs`);
    return wire.runs.map(mapAutomationRun);
  } finally {
    releaseRunFetchSlot();
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function lastRunWithin(lastRunAt: string | null, period: AutomationFilters['lastRunPeriod']): boolean {
  if (period === 'any') return true;
  if (period === 'never') return lastRunAt === null;
  if (!lastRunAt) return false;
  const elapsed = Date.now() - new Date(lastRunAt).getTime();
  if (period === 'today') return elapsed < DAY_MS && new Date(lastRunAt).getDate() === new Date().getDate();
  if (period === '7d') return elapsed < 7 * DAY_MS;
  return elapsed < 30 * DAY_MS;
}

export default function WorkflowsPage() {
  const queryClient = useQueryClient();
  const { data: automations, isPending, isError, refetch } = useAutomations();
  const { data: clients } = useClients();
  const { isMaster } = useIsMaster();
  // Master-only no backend (nodes:read): pro colaborador a query nem dispara e
  // o dot online simplesmente não aparece. Mesmo padrão da tela Agentes.
  const { data: health } = useInfrastructureHealth(isMaster);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [historyFor, setHistoryFor] = useState<Automation | null>(null);

  const [filters, setFilters] = useState<AutomationFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<AutomationSort>('recent');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  // O run é assíncrono (202 queued): o id fica marcado como "Executando..." por
  // ~4s e aí as queries são invalidadas pra coluna refletir o resultado real.
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const runNow = useRunAutomationNow();

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const summarized = useMemo(() => (automations ?? []).slice(0, RUN_SUMMARY_LIMIT), [automations]);

  const runQueries = useQueries({
    queries: summarized.map((automation) => ({
      queryKey: ['automations', automation.id, 'runs'],
      queryFn: () => fetchAutomationRuns(automation.id),
      staleTime: 30_000,
    })),
  });

  const runSummaries = useMemo(() => {
    const map: Record<string, AutomationRunSummary> = {};
    summarized.forEach((automation, i) => {
      const runs = runQueries[i]?.data;
      if (runs) {
        map[automation.id] = { lastStatus: runs[0]?.status ?? null, runCount: runs.length };
      }
    });
    return map;
  }, [summarized, runQueries]);

  const agentOptions = useMemo<AgentName[]>(() => {
    const present = new Set(automations?.map((automation) => automation.agent));
    return AGENT_NAMES.filter((agent) => present.has(agent));
  }, [automations]);

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return (automations ?? []).filter((automation) => {
      if (query && !`${automation.name} ${automation.prompt}`.toLowerCase().includes(query)) return false;
      if (filters.status === 'active' && !automation.enabled) return false;
      if (filters.status === 'paused' && automation.enabled) return false;
      if (filters.status === 'error' && runSummaries[automation.id]?.lastStatus !== 'failed') return false;
      if (filters.agent !== 'all' && automation.agent !== filters.agent) return false;
      if (filters.project === 'none' && automation.clientId !== null) return false;
      if (filters.project !== 'all' && filters.project !== 'none' && automation.clientId !== filters.project) return false;
      if (!lastRunWithin(automation.lastRunAt, filters.lastRunPeriod)) return false;
      if (filters.lastResult === 'success' && (!runSummaries[automation.id]?.lastStatus || runSummaries[automation.id]?.lastStatus === 'failed')) return false;
      if (filters.lastResult === 'error' && runSummaries[automation.id]?.lastStatus !== 'failed') return false;
      return true;
    });
  }, [automations, filters, runSummaries]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const byCreated = (a: Automation, b: Automation) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    switch (sort) {
      case 'recent':
        return list.sort(byCreated);
      case 'oldest':
        return list.sort((a, b) => -byCreated(a, b));
      case 'name-asc':
        return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      case 'name-desc':
        return list.sort((a, b) => b.name.localeCompare(a.name, 'pt-BR'));
      case 'last-run':
        return list.sort((a, b) => {
          if (!a.lastRunAt && !b.lastRunAt) return byCreated(a, b);
          if (!a.lastRunAt) return 1;
          if (!b.lastRunAt) return -1;
          return new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime();
        });
      case 'most-runs':
        // Sem resumo carregado, cai pro createdAt como ordenação de desempate.
        return list.sort((a, b) => (runSummaries[b.id]?.runCount ?? 0) - (runSummaries[a.id]?.runCount ?? 0) || byCreated(a, b));
      case 'errors':
        return list.sort((a, b) => {
          const aFailed = runSummaries[a.id]?.lastStatus === 'failed' ? 0 : 1;
          const bFailed = runSummaries[b.id]?.lastStatus === 'failed' ? 0 : 1;
          return aFailed - bFailed || byCreated(a, b);
        });
    }
  }, [filtered, sort, runSummaries]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clientNameById = useMemo(() => new Map(clients?.map((client) => [client.id, client.name])), [clients]);

  function patchFilters(patch: Partial<AutomationFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function handleRunNow(automation: Automation) {
    setRunningIds((current) => new Set(current).add(automation.id));
    runNow.mutate(automation.id, {
      onSuccess: () => setNotice(`"${automation.name}" entrou na fila de execução.`),
      onError: () => {
        setRunningIds((current) => {
          const next = new Set(current);
          next.delete(automation.id);
          return next;
        });
        setNotice(`Não foi possível executar "${automation.name}" agora.`);
      },
    });
    setTimeout(() => {
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(automation.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      queryClient.invalidateQueries({ queryKey: ['automations', automation.id, 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['automations', 'metrics'] });
    }, 4000);
  }

  const newAutomationButton = (
    <button
      type="button"
      onClick={() => setCreating(true)}
      className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
    >
      <Plus size={15} />
      Nova automação
    </button>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Automação"
        title="Automações"
        description="Crie e gerencie automações inteligentes para otimizar processos, integrar com o ClickUp e aumentar sua produtividade."
        actions={newAutomationButton}
      />

      <div className="mb-6">
        <AutomationMetrics />
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru">
          {notice}
        </p>
      )}

      {isPending ? (
        <Surface level="grafite" className="space-y-3 p-4">
          <Skeleton className="h-9" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </Surface>
      ) : isError ? (
        <div className="space-y-4">
          <EmptyState
            icon={Zap}
            title="Não conseguimos carregar suas automações."
            description="Verifique sua conexão e tente novamente."
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : !automations || automations.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            icon={Zap}
            title="Nenhuma automação criada"
            description="Crie a primeira - ex: todo dia às 8h o Bento resume o que precisa ser feito no ClickUp."
          />
          <div className="flex justify-center">{newAutomationButton}</div>
        </div>
      ) : sorted.length === 0 ? (
        <Surface level="grafite" className="overflow-hidden">
          <div className="border-b border-grafite-elevado/60 p-3">
            <AutomationToolbar
              filters={filters}
              onChange={patchFilters}
              sort={sort}
              onSortChange={(value) => {
                setSort(value);
                setPage(1);
              }}
              agentOptions={agentOptions}
              onClear={clearFilters}
            />
          </div>
          <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
            <SearchX size={24} className="text-nevoa" />
            <p className="font-heading text-base font-semibold text-branco-cru">Nenhuma automação encontrada</p>
            <p className="text-sm text-nevoa">Nenhum resultado para os filtros aplicados.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-1 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
            >
              Limpar filtros
            </button>
          </div>
        </Surface>
      ) : (
        <AutomationTable
          toolbar={
            <AutomationToolbar
              filters={filters}
              onChange={patchFilters}
              sort={sort}
              onSortChange={(value) => {
                setSort(value);
                setPage(1);
              }}
              agentOptions={agentOptions}
              onClear={clearFilters}
            />
          }
          automations={pageItems}
          totalFiltered={sorted.length}
          page={currentPage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          runSummaries={runSummaries}
          runningIds={runningIds}
          clientNameFor={(clientId) => (clientId ? (clientNameById.get(clientId) ?? null) : null)}
          agentStatusFor={(agent: AgentName): NodeStatus | undefined =>
            health?.nodes.find((node) => node.agent === agent)?.status
          }
          onEdit={setEditing}
          onViewHistory={setHistoryFor}
          onRunNow={handleRunNow}
        />
      )}

      <AnimatePresence>{creating && <CreateAutomationModal onClose={() => setCreating(false)} />}</AnimatePresence>
      <AnimatePresence>
        {editing && <EditAutomationModal automation={editing} onClose={() => setEditing(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {historyFor && <AutomationHistoryModal automation={historyFor} onClose={() => setHistoryFor(null)} />}
      </AnimatePresence>
    </div>
  );
}
