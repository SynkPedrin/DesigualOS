import { Surface } from '@/components/ui/surface';
import { MetricBar } from '@/components/monitoring/metric-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { NODE_STATUS_META } from '@/lib/status-meta';
import type { NodeSummary } from '@/lib/api/contracts';

export function GpuPanel({ node }: { node: NodeSummary | undefined }) {
  if (!node) return null;
  const statusMeta = NODE_STATUS_META[node.status];

  return (
    <Surface level="grafite" className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          RTX 5090
        </h2>
        <StatusBadge
          label={statusMeta.label}
          dotClass={statusMeta.dotClass}
          textClass={statusMeta.textClass}
          pulse={node.status === 'rendering'}
        />
      </div>
      <div className="space-y-2.5">
        {node.gpuPercent !== null && <MetricBar label="Utilização GPU" value={node.gpuPercent} />}
        {node.vramPercent !== null && <MetricBar label="VRAM" value={node.vramPercent} />}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-grafite-elevado pt-3 font-mono text-[11px] text-nevoa">
        {node.temperatureCelsius !== null && <span>{node.temperatureCelsius}°C</span>}
        {node.queueDepth !== null && <span>Fila: {node.queueDepth}</span>}
      </div>
    </Surface>
  );
}
