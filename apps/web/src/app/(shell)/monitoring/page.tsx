'use client';

import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricValue } from '@/components/ui/metric-value';
import { NodeCard } from '@/components/monitoring/node-card';
import { TopologyGraph } from '@/components/monitoring/topology-graph';
import { EventTimeline } from '@/components/monitoring/event-timeline';
import { SyncPanel } from '@/components/monitoring/sync-panel';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { mockSystemEvents } from '@/lib/monitoring/system-events';

export default function MonitoringPage() {
  const { isMaster, isPending: rolePending } = useIsMaster();
  const { data: health, isPending } = useInfrastructureHealth(isMaster);

  if (!rolePending && !isMaster) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Monitoramento de infraestrutura é visível só para o papel Administrador Master."
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Infraestrutura ao vivo"
        title="Monitoramento"
        description="Os 3 Mac Minis e a máquina com RTX que rodam os agentes. Use Sincronizar para medir ao vivo."
      />

      <SyncPanel />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Saúde geral', value: isPending ? '—' : `${health?.overallHealthPercent}%`, accent: true },
          { label: 'Nós totais', value: isPending ? '—' : health?.totalNodes },
          {
            label: 'Agentes conectados',
            value: isPending ? '—' : `${health?.agentsConnected.online}/${health?.agentsConnected.total}`,
          },
          { label: 'Último backup', value: isPending ? '—' : health?.lastBackupAt ?? 'Sem registro' },
        ].map((stat) => (
          <Surface key={stat.label} level="grafite" className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{stat.label}</p>
            <MetricValue className={`text-2xl ${stat.accent ? 'text-sinal' : 'text-branco-cru'}`}>
              {stat.value}
            </MetricValue>
          </Surface>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Surface level="grafite" className="flex items-center justify-center p-4">
          {isPending ? (
            <Skeleton className="aspect-square w-full" />
          ) : (
            <TopologyGraph nodes={health?.nodes ?? []} />
          )}
        </Surface>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isPending
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[260px]" />)
            : health?.nodes.map((node, i) => (
                <motion.div
                  key={node.nodeId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.06, ease: 'easeOut' }}
                >
                  <NodeCard node={node} />
                </motion.div>
              ))}
        </div>
      </div>

      <Surface level="grafite" className="p-4">
        <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Linha do tempo de eventos
        </h2>
        <EventTimeline events={mockSystemEvents} />
      </Surface>
    </div>
  );
}
