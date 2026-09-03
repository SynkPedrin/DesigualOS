import { AGENT_NAMES } from '@desigual-os/types';
import { AGENT_META } from '@/lib/agent-meta';
import { NODE_STATUS_META } from '@/lib/status-meta';
import type { NodeSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const OFFLINE_LIKE = new Set(['offline', 'maintenance']);
const CENTER = { x: 220, y: 220 };
const RADIUS = 150;

function positionFor(index: number, total: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CENTER.x + RADIUS * Math.cos(angle),
    y: CENTER.y + RADIUS * Math.sin(angle),
  };
}

export function TopologyGraph({ nodes }: { nodes: NodeSummary[] }) {
  return (
    <svg viewBox="0 0 440 440" className="w-full" role="img" aria-label="Topologia do sistema">
      {AGENT_NAMES.map((agent, index) => {
        const node = nodes.find((n) => n.agent === agent);
        const pos = positionFor(index, AGENT_NAMES.length);
        const isOffline = !node || OFFLINE_LIKE.has(node.status);
        const meta = AGENT_META[agent];
        const statusMeta = node ? NODE_STATUS_META[node.status] : null;

        return (
          <g key={agent}>
            <line
              x1={CENTER.x}
              y1={CENTER.y}
              x2={pos.x}
              y2={pos.y}
              strokeWidth={2}
              className={cn(
                isOffline ? 'stroke-grafite-elevado' : 'topology-line-active',
              )}
              stroke={isOffline ? undefined : 'currentColor'}
              style={!isOffline ? { color: `var(--color-agent-${agent})` } : undefined}
              opacity={isOffline ? 0.4 : 0.8}
            />
            <circle
              cx={pos.x}
              cy={pos.y}
              r={30}
              className={cn(meta.bgSoftClass)}
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: `var(--color-agent-${agent})` }}
              fill="var(--color-grafite)"
            />
            <text
              x={pos.x}
              y={pos.y - 4}
              textAnchor="middle"
              className="font-mono text-[10px] uppercase"
              fill="var(--color-branco-cru)"
            >
              {meta.label}
            </text>
            <text
              x={pos.x}
              y={pos.y + 10}
              textAnchor="middle"
              className="font-mono text-[8px] uppercase tracking-wider"
              fill={statusMeta ? undefined : 'var(--color-nevoa)'}
              style={statusMeta ? { fill: `var(--color-${node!.status === 'online' ? 'sucesso' : node!.status === 'offline' ? 'erro' : 'aviso'})` } : undefined}
            >
              {statusMeta?.label ?? 'Sem dados'}
            </text>
          </g>
        );
      })}

      <circle cx={CENTER.x} cy={CENTER.y} r={44} fill="var(--color-grafite-elevado)" stroke="var(--color-roxo-eletrico)" strokeWidth={2} />
      <text
        x={CENTER.x}
        y={CENTER.y - 4}
        textAnchor="middle"
        className="font-heading text-[11px] font-bold"
        fill="var(--color-branco-cru)"
      >
        Orchestrator
      </text>
      <text
        x={CENTER.x}
        y={CENTER.y + 12}
        textAnchor="middle"
        className="font-mono text-[8px] uppercase tracking-wider"
        fill="var(--color-sinal)"
      >
        {nodes.filter((n) => !OFFLINE_LIKE.has(n.status)).length}/{nodes.length} ativos
      </text>
    </svg>
  );
}
