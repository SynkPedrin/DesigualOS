'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { AgentName, NodeStatus } from '@desigual-os/types';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { MetricValue } from '@/components/ui/metric-value';
import { Surface } from '@/components/ui/surface';
import { AGENT_META } from '@/lib/agent-meta';
import { NODE_STATUS_META } from '@/lib/status-meta';
import type { AgentStats } from '@/hooks/use-agent-stats';
import { useHoverSound } from '@/hooks/use-hover-sound';
import { cn } from '@/lib/utils';

function formatResponseTime(seconds: number | null) {
  if (seconds === null) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}min`;
}

export function AgentCard({
  agent,
  status,
  stats,
  compact = false,
  href,
  onSelect,
  className,
}: {
  agent: AgentName;
  status: NodeStatus | undefined;
  stats: AgentStats;
  compact?: boolean;
  href?: string;
  /** Quando presente, o card vira botão e abre o detalhe do agente em vez de navegar. */
  onSelect?: () => void;
  className?: string;
}) {
  const meta = AGENT_META[agent];
  const statusMeta = status ? NODE_STATUS_META[status] : null;
  const playHoverSound = useHoverSound();

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={agent} size={compact ? 'sm' : 'md'} />
          <div>
            <p className="font-heading text-sm font-semibold text-branco-cru">{meta.label}</p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-nevoa">{meta.role}</p>
          </div>
        </div>
        {statusMeta && (
          <StatusBadge
            label={statusMeta.label}
            dotClass={statusMeta.dotClass}
            textClass={statusMeta.textClass}
            pulse={status === 'busy' || status === 'rendering'}
          />
        )}
      </div>

      {!compact && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-grafite-elevado pt-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Conversas ativas</p>
            <MetricValue className="text-lg text-branco-cru">{stats.activeConversations}</MetricValue>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Performance</p>
            <MetricValue className={cn('text-lg', meta.textClass)}>
              {stats.performancePercent === null ? '-' : `${stats.performancePercent}%`}
            </MetricValue>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Resposta média</p>
            <MetricValue className="text-lg text-branco-cru">
              {formatResponseTime(stats.averageResponseSeconds)}
            </MetricValue>
          </div>
        </div>
      )}

      {(href || onSelect) && (
        <div className={cn('mt-3 flex items-center gap-1 font-mono text-[11px]', meta.textClass)}>
          {onSelect ? 'Ver detalhes do agente' : 'Ver histórico de conversas'}
          <ArrowRight size={11} />
        </div>
      )}
    </>
  );

  if (onSelect) {
    return (
      <Surface
        level="grafite"
        onMouseEnter={playHoverSound}
        className={cn(
          'group transition-[transform,border-color,box-shadow] hover:scale-[1.015] hover:border-roxo-eletrico/50 hover:shadow-glow active:scale-[0.99]',
          className,
        )}
      >
        <button type="button" onClick={onSelect} className="block w-full p-4 text-left">
          {content}
        </button>
      </Surface>
    );
  }

  if (href) {
    return (
      <Surface
        level="grafite"
        onMouseEnter={playHoverSound}
        className={cn(
          'group p-4 transition-[transform,border-color,box-shadow] hover:scale-[1.015] hover:border-roxo-eletrico/50 hover:shadow-glow active:scale-[0.99]',
          className,
        )}
      >
        <Link href={href} className="block">
          {content}
        </Link>
      </Surface>
    );
  }

  return (
    <Surface level="grafite" className={cn('p-4', className)}>
      {content}
    </Surface>
  );
}
