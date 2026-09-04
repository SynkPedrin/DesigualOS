'use client';

import Image from 'next/image';
import { motion, useReducedMotion, useTransform, type MotionValue } from 'framer-motion';
import type { AgentName, NodeStatus } from '@desigual-os/types';
import { AGENT_META, AUTO_META, type FEATURED_AGENTS } from '@/lib/agent-meta';
import type { AgentSelection } from '@/lib/api/contracts';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useHoverSound } from '@/hooks/use-hover-sound';
import { cn } from '@/lib/utils';

/** Spring dos elementos que viajam entre os estados (cards e composer): rápido, sem quique. */
export const TRAVEL_SPRING = { type: 'spring', stiffness: 190, damping: 26 } as const;

/** layoutId estável por seleção — o MESMO id no card (tela vazia) e no chip (topo da thread)
 * é o que faz o framer tratar os dois como um elemento só que se move. */
export function agentCardLayoutId(selection: AgentSelection) {
  return `agent-card-${selection}`;
}

/**
 * Status REAL dos nós por agente (GET /health/infrastructure, poll de 15s).
 * O endpoint é master-only no backend (colaborador leva 403 — vide
 * use-infrastructure-health.ts): sem permissão ou sem dados o mapa fica null
 * e NENHUM dot é renderizado. Nada de "Online" fingido.
 */
export function useAgentNodeStatuses(): Partial<Record<AgentName, NodeStatus>> | null {
  const { isMaster } = useIsMaster();
  const { data } = useInfrastructureHealth(isMaster);
  if (!data) return null;
  const map: Partial<Record<AgentName, NodeStatus>> = {};
  for (const node of data.nodes) {
    map[node.agent] ??= node.status;
  }
  return map;
}

const STATUS_PRESENTATION: Record<NodeStatus, { dotClass: string; label: string }> = {
  online: { dotClass: 'bg-sucesso', label: 'Online' },
  busy: { dotClass: 'bg-info', label: 'Em atividade' },
  rendering: { dotClass: 'bg-info', label: 'Renderizando' },
  warning: { dotClass: 'bg-aviso', label: 'Atenção' },
  degraded: { dotClass: 'bg-aviso', label: 'Degradado' },
  offline: { dotClass: 'bg-erro', label: 'Offline' },
  maintenance: { dotClass: 'bg-nevoa', label: 'Manutenção' },
};

/* Profundidade do microparallax por posição (px no extremo do cursor) — o card
 * do meio "flutua" mais, reforçando a elevação dele na composição. */
const PARALLAX_DEPTH_X = [10, 16, 10];
const PARALLAX_DEPTH_Y = [6, 10, 6];

/**
 * Card grande da tela vazia. Camadas de transform separadas de propósito:
 * botão (layoutId → viagem pro chip) > parallax (style) > flutuação idle
 * (animate y) > conteúdo (scale de hover/seleção via CSS `scale`, que compõe
 * com o `transform` que o framer escreve inline).
 */
export function AgentCard({
  agent,
  index,
  selected,
  status,
  parallaxX,
  parallaxY,
  onSelect,
}: {
  agent: (typeof FEATURED_AGENTS)[number];
  index: number;
  selected: boolean;
  status: NodeStatus | null;
  parallaxX: MotionValue<number>;
  parallaxY: MotionValue<number>;
  onSelect: (agent: AgentName) => void;
}) {
  const meta = AGENT_META[agent];
  const reduceMotion = useReducedMotion();
  const playHoverSound = useHoverSound();
  const x = useTransform(parallaxX, (v) => v * (PARALLAX_DEPTH_X[index] ?? 10));
  const y = useTransform(parallaxY, (v) => v * (PARALLAX_DEPTH_Y[index] ?? 6));
  const statusPresentation = status ? STATUS_PRESENTATION[status] : null;

  return (
    <motion.button
      layoutId={agentCardLayoutId(agent)}
      type="button"
      onClick={() => onSelect(agent)}
      onMouseEnter={playHoverSound}
      aria-pressed={selected}
      transition={{ ...TRAVEL_SPRING, delay: index * 0.05 }}
      className={cn(
        'group relative flex w-32 flex-col items-center rounded-xl border p-5 backdrop-blur-md transition-[border-color,box-shadow,background-color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-roxo-eletrico/70 sm:w-36',
        index === 1 && 'sm:mb-8',
        selected
          ? 'border-roxo-eletrico/80 bg-roxo-eletrico/10 shadow-glow'
          : 'border-white/10 bg-white/[0.04] shadow-card hover:border-roxo-eletrico/50 hover:shadow-glow',
      )}
    >
      <motion.div style={{ x, y }} className="flex flex-col items-center gap-3">
        <motion.div
          {...(reduceMotion ? {} : { animate: { y: [0, -6, 0] } })}
          transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: index * 0.8 }}
          data-selected={selected}
          className="flex flex-col items-center gap-3 transition-transform duration-300 group-hover:scale-[1.04] group-active:scale-[0.97] data-[selected=true]:scale-[1.03]"
        >
          <span
            className={cn(
              'relative block size-16 overflow-hidden rounded-full ring-1',
              selected ? 'ring-roxo-eletrico/70' : 'ring-white/15',
            )}
          >
            <Image src={meta.photoSrc!} alt="" fill sizes="64px" className="object-cover" />
          </span>
          <span className="block text-center">
            <span className="block text-sm font-semibold text-branco-cru">{meta.label}</span>
            <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-nevoa">
              {meta.role}
            </span>
          </span>
          {statusPresentation && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">
              <span className={cn('size-1.5 rounded-full', statusPresentation.dotClass)} />
              {statusPresentation.label}
            </span>
          )}
        </motion.div>
      </motion.div>
    </motion.button>
  );
}

/**
 * Chip compacto do topo da thread. Divide o layoutId com o AgentCard da tela
 * vazia: na primeira mensagem o card "encolhe e doca" aqui. AUTO existe só
 * neste estado (na tela vazia quem roteia é o placeholder do composer).
 */
export function AgentChip({
  selection,
  selected,
  processing,
  onSelect,
}: {
  selection: AgentSelection;
  selected: boolean;
  processing: boolean;
  onSelect: (agent: AgentSelection) => void;
}) {
  const reduceMotion = useReducedMotion();
  const playHoverSound = useHoverSound();
  const label = selection === 'auto' ? AUTO_META.label : AGENT_META[selection].label;

  return (
    <motion.button
      layoutId={agentCardLayoutId(selection)}
      type="button"
      onClick={() => onSelect(selection)}
      onMouseEnter={playHoverSound}
      aria-pressed={selected}
      transition={TRAVEL_SPRING}
      className={cn(
        'flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm font-medium backdrop-blur-md transition-[border-color,box-shadow,color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-roxo-eletrico/70',
        selected
          ? 'border-roxo-eletrico/70 bg-roxo-eletrico/10 text-branco-cru shadow-glow'
          : 'border-white/10 bg-white/[0.04] text-nevoa hover:border-roxo-eletrico/40 hover:text-branco-cru',
      )}
    >
      <AgentAvatar agent={selection} size="sm" />
      <span>{label}</span>
      {processing && (
        <>
          <motion.span
            aria-hidden
            className="size-1.5 rounded-full bg-sinal"
            {...(reduceMotion ? {} : { animate: { opacity: [0.3, 1, 0.3] } })}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="sr-only">pensando…</span>
        </>
      )}
    </motion.button>
  );
}
