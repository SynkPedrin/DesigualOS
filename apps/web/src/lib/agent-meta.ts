import type { AgentName } from '@desigual-os/types';
import type { AgentSelection } from '@/lib/api/contracts';

interface AgentMeta {
  label: string;
  initial: string;
  role: string;
  textClass: string;
  bgClass: string;
  bgSoftClass: string;
  borderClass: string;
  ringClass: string;
  colorVar: string;
  /** Persona photo, 300x300 source. Studio has no persona portrait, so it uses the OS brand
   * mark instead of the initial-in-circle fallback. */
  photoSrc?: string;
}

/** Tailwind class names are spelled out literally (not interpolated) so the v4 scanner picks them up. */
export const AGENT_META: Record<AgentName, AgentMeta> = {
  bento: {
    label: 'Bento',
    initial: 'B',
    role: 'Institucional',
    textClass: 'text-agent-bento',
    bgClass: 'bg-agent-bento',
    bgSoftClass: 'bg-agent-bento/15',
    borderClass: 'border-agent-bento',
    ringClass: 'ring-agent-bento',
    colorVar: '--color-agent-bento',
    photoSrc: '/agents/bento.png',
  },
  jarbas: {
    label: 'Jarbas',
    initial: 'J',
    role: 'Tráfego',
    textClass: 'text-agent-jarbas',
    bgClass: 'bg-agent-jarbas',
    bgSoftClass: 'bg-agent-jarbas/15',
    borderClass: 'border-agent-jarbas',
    ringClass: 'ring-agent-jarbas',
    colorVar: '--color-agent-jarbas',
    photoSrc: '/agents/jarbas.png',
  },
  suzy: {
    label: 'Suzy',
    initial: 'Su',
    role: 'Social Selling',
    textClass: 'text-agent-suzy',
    bgClass: 'bg-agent-suzy',
    bgSoftClass: 'bg-agent-suzy/15',
    borderClass: 'border-agent-suzy',
    ringClass: 'ring-agent-suzy',
    colorVar: '--color-agent-suzy',
    photoSrc: '/agents/suzy.png',
  },
  studio: {
    label: 'Studio',
    initial: 'St',
    role: 'Criação Multimídia',
    textClass: 'text-agent-studio',
    bgClass: 'bg-agent-studio',
    bgSoftClass: 'bg-agent-studio/15',
    borderClass: 'border-agent-studio',
    ringClass: 'ring-agent-studio',
    colorVar: '--color-agent-studio',
    photoSrc: '/brand/os-mark.png',
  },
};

export const AUTO_META = {
  label: 'AUTO',
  role: 'Roteador inteligente',
};

/** Os 3 agentes de conversa (Studio é geração de mídia, não QA por chat) — mesmo trio
 * fixado no topo de /messages e destacado na tela vazia de /chat. */
export const FEATURED_AGENTS = ['bento', 'jarbas', 'suzy'] as const satisfies readonly AgentName[];

export function agentSelectionLabel(selection: AgentSelection): string {
  return selection === 'auto' ? AUTO_META.label : AGENT_META[selection].label;
}
