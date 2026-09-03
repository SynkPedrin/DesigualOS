import { AgentAvatar } from '@/components/ui/agent-avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { Surface } from '@/components/ui/surface';
import { MetricBar } from './metric-bar';
import { AGENT_META } from '@/lib/agent-meta';
import { NODE_STATUS_META } from '@/lib/status-meta';
import { formatRelativeTime } from '@/lib/format';
import type { NodeSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const LIVE_STATUSES = new Set(['online', 'busy', 'rendering', 'warning']);

export function NodeCard({ node }: { node: NodeSummary }) {
  const meta = AGENT_META[node.agent];
  const statusMeta = NODE_STATUS_META[node.status];
  const isLive = LIVE_STATUSES.has(node.status);

  return (
    <Surface level="grafite" className={cn('p-4', node.status === 'offline' && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={node.agent} />
          <div>
            <p className="font-heading text-sm font-semibold text-branco-cru">{meta.label}</p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-nevoa">
              {node.nodeId} · {node.type === 'gpu_server' ? 'GPU Server' : 'Mac Mini'}
            </p>
          </div>
        </div>
        <StatusBadge
          label={statusMeta.label}
          dotClass={statusMeta.dotClass}
          textClass={statusMeta.textClass}
          pulse={node.status === 'busy' || node.status === 'rendering'}
        />
      </div>

      <div className="mt-4 space-y-2.5 border-t border-grafite-elevado pt-3">
        <MetricBar label="CPU" value={node.cpuPercent} />
        <MetricBar label="RAM" value={node.ramPercent} />
        <MetricBar label="Disco" value={node.diskPercent} />
        {node.gpuPercent !== null && <MetricBar label="GPU" value={node.gpuPercent} />}
        {node.vramPercent !== null && <MetricBar label="VRAM" value={node.vramPercent} />}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-grafite-elevado pt-3 font-mono text-[11px] text-nevoa">
        <span>Latência {node.latencyMs}ms</span>
        {node.temperatureCelsius !== null && <span>{node.temperatureCelsius}°C</span>}
        {node.queueDepth !== null && <span>Fila: {node.queueDepth}</span>}
        <span className="flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            {isLive && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sucesso opacity-75" />
            )}
            <span
              className={cn('relative inline-flex size-1.5 rounded-full', isLive ? 'bg-sucesso' : 'bg-erro')}
            />
          </span>
          {formatRelativeTime(node.lastHeartbeatAt)}
        </span>
      </div>
    </Surface>
  );
}
