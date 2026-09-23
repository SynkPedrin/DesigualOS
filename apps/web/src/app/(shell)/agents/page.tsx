'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentDetailModal } from '@/components/agents/agent-detail-modal';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useAgentStats, agentStatsOrDefault } from '@/hooks/use-agent-stats';
import { useExecutions } from '@/hooks/use-executions';

export default function AgentsPage() {
  const { isMaster } = useIsMaster();
  // `nodes:read` (saúde/infra) é master-only no backend - a query fica `enabled: false`
  // pro colaborador e nunca sai de `isPending`. Os cards de agente usam `executions:read`
  // (permitido pro colaborador), então usam seu próprio pending - senão os cards ficavam
  // presos em skeleton pra sempre pro colaborador, esperando uma query que nunca dispara.
  const { data: health, isPending, isError: healthError } = useInfrastructureHealth(isMaster);
  const { isPending: statsPending, isError: statsError, refetch: refetchStats } = useExecutions();
  const stats = useAgentStats();
  // Card clicado abre o modal de detalhes (telemetria do node + atividade real),
  // em vez de ir direto pro chat - o chat virou uma das ações dentro do modal.
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Time de IA"
        title="Agentes"
        description="Os agentes especializados da Desigual, coordenados pelo Orchestrator. Clique em um agente para ver telemetria em tempo real e atividade recente."
      />

      {isMaster && (
        <Surface level="grafite" className="mb-8 p-5">
          {healthError ? (
            <p className="font-mono text-xs text-erro">Não consegui carregar a saúde da infraestrutura.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-nevoa">Saúde geral</p>
                <p className="font-display text-3xl font-black text-sinal">
                  {isPending ? '-' : `${health?.overallHealthPercent}%`}
                </p>
              </div>
              <div className="flex gap-6 font-mono text-xs text-nevoa">
                <div>
                  <p className="uppercase tracking-wider">Agentes conectados</p>
                  <p className="mt-1 text-sm text-branco-cru">
                    {isPending ? '-' : `${health?.agentsConnected.online}/${health?.agentsConnected.total}`}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-wider">Total de nós</p>
                  <p className="mt-1 text-sm text-branco-cru">{isPending ? '-' : health?.totalNodes}</p>
                </div>
              </div>
            </div>
          )}
        </Surface>
      )}

      {statsError ? (
        <div className="space-y-4">
          <EmptyState
            icon={Bot}
            title="Não conseguimos carregar os agentes."
            description="Verifique sua conexão e tente novamente."
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => refetchStats()}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {statsPending
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[172px]" />)
            : AGENT_NAMES.map((agent, i) => (
                <motion.div
                  key={agent}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.08, ease: 'easeOut' }}
                >
                  <AgentCard
                    agent={agent}
                    status={health?.nodes.find((n) => n.agent === agent)?.status}
                    stats={agentStatsOrDefault(stats, agent)}
                    onSelect={() => setSelectedAgent(agent)}
                  />
                </motion.div>
              ))}
        </div>
      )}

      <AgentDetailModal
        agent={selectedAgent}
        node={health?.nodes.find((n) => n.agent === selectedAgent)}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
