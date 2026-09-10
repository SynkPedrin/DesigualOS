'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, MessageSquare, X } from 'lucide-react';
import type { AgentName } from '@desigual-os/types';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { MetricValue } from '@/components/ui/metric-value';
import { Surface } from '@/components/ui/surface';
import { AGENT_META } from '@/lib/agent-meta';
import { EXECUTION_STATUS_META, NODE_STATUS_META } from '@/lib/status-meta';
import { intentLabel } from '@/lib/intent-meta';
import { formatDuration, formatRelativeTime, formatTokens } from '@/lib/format';
import { useExecutions } from '@/hooks/use-executions';
import { useCostsByAgent } from '@/hooks/use-costs';
import { useIsMaster } from '@/hooks/use-is-master';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { cn } from '@/lib/utils';
import type { NodeSummary } from '@/lib/api/contracts';

function TelemetryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{label}</p>
      <MetricValue className="text-lg text-branco-cru">{value}</MetricValue>
    </div>
  );
}

/** Modal de detalhes do agente no /agents: telemetria do node em tempo real (15s via
 * useInfrastructureHealth na página), atividade derivada das execuções reais (10s) e
 * custo 30d. Telemetria e custo são master-only no backend (`nodes:read`/`costs:read`),
 * então pro colaborador as seções somem em vez de estourar 403. */
export function AgentDetailModal({
  agent,
  node,
  onClose,
}: {
  agent: AgentName | null;
  node: NodeSummary | undefined;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isMaster } = useIsMaster();
  const { data: executions } = useExecutions();
  const { data: costsByAgent } = useCostsByAgent('30d', isMaster && agent !== null);

  useFocusTrap(containerRef, agent !== null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const activity = useMemo(() => {
    if (!agent || !executions) return null;
    const forAgent = executions.filter((e) => e.agent === agent);
    const active = forAgent.filter((e) => e.status === 'queued' || e.status === 'running').length;
    const settled = forAgent.filter((e) => e.status === 'completed' || e.status === 'failed');
    const completed = settled.filter((e) => e.status === 'completed');
    const tokensIn = forAgent.reduce((sum, e) => sum + e.tokensInput, 0);
    const tokensOut = forAgent.reduce((sum, e) => sum + e.tokensOutput, 0);
    return {
      total: forAgent.length,
      active,
      performancePercent: settled.length > 0 ? Math.round((completed.length / settled.length) * 100) : 100,
      tokensIn,
      tokensOut,
      recent: [...forAgent]
        .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())
        .slice(0, 5),
    };
  }, [agent, executions]);

  const meta = agent ? AGENT_META[agent] : null;
  const statusMeta = node ? NODE_STATUS_META[node.status] : null;
  const cost = costsByAgent?.find((row) => row.agent === agent);
  const hasGpuTelemetry =
    node && (node.vramPercent !== null || node.temperatureCelsius !== null || node.queueDepth !== null);

  return (
    <AnimatePresence>
      {agent && meta && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-carbono/80 p-3 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Detalhes do agente ${meta.label}`}
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-grafite-elevado bg-carbono shadow-elevated"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar detalhes"
              className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
            >
              <X size={18} />
            </button>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Identidade */}
              <div className="flex items-start gap-4">
                <AgentAvatar agent={agent} size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-display text-2xl font-black text-branco-cru">{meta.label}</h2>
                    {statusMeta && (
                      <StatusBadge
                        label={statusMeta.label}
                        dotClass={statusMeta.dotClass}
                        textClass={statusMeta.textClass}
                        pulse={node?.status === 'busy' || node?.status === 'rendering'}
                      />
                    )}
                  </div>
                  <p className={cn('font-mono text-[11px] uppercase tracking-wider', meta.textClass)}>
                    {meta.role}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-nevoa">{meta.description}</p>
                  {node && (
                    <p className="mt-2 font-mono text-[11px] text-nevoa">
                      {node.nodeId} · visto {formatRelativeTime(node.lastHeartbeatAt)}
                    </p>
                  )}
                </div>
              </div>

              {/* Telemetria do node em tempo real (master-only) */}
              {isMaster && node && (
                <Surface level="grafite" className="mt-6 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">
                    Telemetria em tempo real
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <TelemetryItem label="CPU" value={node.cpuPercent !== null ? `${Math.round(node.cpuPercent)}%` : '-'} />
                    <TelemetryItem label="RAM" value={node.ramPercent !== null ? `${Math.round(node.ramPercent)}%` : '-'} />
                    <TelemetryItem label="Disco" value={node.diskPercent !== null ? `${Math.round(node.diskPercent)}%` : '-'} />
                    <TelemetryItem label="Latência" value={`${Math.round(node.latencyMs)}ms`} />
                  </div>
                  {hasGpuTelemetry && (
                    <div className="mt-4 grid grid-cols-2 gap-4 border-t border-grafite-elevado pt-4 sm:grid-cols-4">
                      {node.vramPercent !== null && (
                        <TelemetryItem label="VRAM" value={`${Math.round(node.vramPercent)}%`} />
                      )}
                      {node.temperatureCelsius !== null && (
                        <TelemetryItem label="GPU" value={`${Math.round(node.temperatureCelsius)}°C`} />
                      )}
                      {node.queueDepth !== null && (
                        <TelemetryItem label="Fila de render" value={String(node.queueDepth)} />
                      )}
                    </div>
                  )}
                </Surface>
              )}

              {/* Atividade derivada das execuções reais */}
              <Surface level="grafite" className="mt-4 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Atividade</p>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <TelemetryItem label="Execuções" value={activity ? String(activity.total) : '-'} />
                  <TelemetryItem label="Ativas agora" value={activity ? String(activity.active) : '-'} />
                  <TelemetryItem
                    label="Performance"
                    value={activity ? `${activity.performancePercent}%` : '-'}
                  />
                  <TelemetryItem
                    label="Tokens"
                    value={activity ? `${formatTokens(activity.tokensIn)} / ${formatTokens(activity.tokensOut)}` : '-'}
                  />
                </div>
                {isMaster && cost && (
                  <p className="mt-3 border-t border-grafite-elevado pt-3 font-mono text-[11px] text-nevoa">
                    Custo 30d: <span className="text-branco-cru">${cost.totalCostUsd.toFixed(2)}</span>
                    {' · '}
                    {cost.events} eventos
                  </p>
                )}
              </Surface>

              {/* Execuções recentes */}
              {activity && activity.recent.length > 0 && (
                <div className="mt-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">
                    Execuções recentes
                  </p>
                  <div className="mt-2 divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
                    {activity.recent.map((execution) => {
                      const execStatus = EXECUTION_STATUS_META[execution.status];
                      return (
                        <div
                          key={execution.executionId}
                          className="flex items-center justify-between gap-3 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm text-branco-cru">
                              {intentLabel(execution.intent)}
                            </p>
                            <p className="font-mono text-[10px] text-nevoa">
                              {execution.executionId} ·{' '}
                              {execution.startedAt ? formatRelativeTime(execution.startedAt) : 'na fila'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <MetricValue className="text-xs text-nevoa">
                              {execution.startedAt ? formatDuration(execution.startedAt, execution.completedAt) : '-'}
                            </MetricValue>
                            <StatusBadge
                              label={execStatus.label}
                              dotClass={execStatus.dotClass}
                              textClass={execStatus.textClass}
                              pulse={execution.status === 'running'}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Ações */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href={agent === 'studio' ? '/studio' : `/chat?agent=${agent}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-4 py-2 font-heading text-sm font-semibold text-carbono transition-opacity hover:opacity-90',
                    meta.bgClass,
                  )}
                >
                  <MessageSquare size={15} />
                  {agent === 'studio' ? 'Abrir o Studio' : `Conversar com o ${meta.label}`}
                </Link>
                <Link
                  href="/history"
                  className="flex items-center gap-1 font-mono text-xs text-nevoa transition-colors hover:text-branco-cru"
                >
                  Ver histórico completo
                  <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
