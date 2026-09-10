import type { AgentName } from '@desigual-os/types';
import type { AgentSelection } from '@/lib/api/contracts';

interface AgentMeta {
  label: string;
  initial: string;
  role: string;
  /** Uma linha sobre o que o agente faz - exibida no modal de detalhes do /agents. */
  description: string;
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
    description:
      'Responde perguntas sobre a agência, processos e clientes, com memória própria e acesso ao vault de conhecimento institucional.',
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
    description:
      'Cuida de tráfego pago e performance: campanhas, contas Meta Ads, otimização e leitura de resultados.',
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
    description:
      'Social selling e relacionamento: Instagram, WhatsApp, prospecção e conversas que viram oportunidade.',
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
    description:
      'Produção visual na GPU dedicada: imagens, carrosséis, vídeos e upscales via ComfyUI a partir das especificações do Otto.',
    textClass: 'text-agent-studio',
    bgClass: 'bg-agent-studio',
    bgSoftClass: 'bg-agent-studio/15',
    borderClass: 'border-agent-studio',
    ringClass: 'ring-agent-studio',
    colorVar: '--color-agent-studio',
    photoSrc: '/brand/os-mark.png',
  },
  otto: {
    label: 'Otto',
    initial: 'Ot',
    role: 'Direção Criativa',
    description:
      'Diretor criativo do sistema: estratégia, conceitos, copy, direção de arte e prompts. Roda com Mistral local e aprende com o Brain de marketing.',
    textClass: 'text-agent-otto',
    bgClass: 'bg-agent-otto',
    bgSoftClass: 'bg-agent-otto/15',
    borderClass: 'border-agent-otto',
    ringClass: 'ring-agent-otto',
    colorVar: '--color-agent-otto',
    photoSrc: '/agents/otto.png',
  },
};

export const AUTO_META = {
  label: 'AUTO',
  role: 'Roteador inteligente',
};

/** Os 4 agentes de conversa (Studio é geração de mídia, não QA por chat) - mesmo grupo
 * fixado no topo de /messages e destacado na tela vazia de /chat. */
export const FEATURED_AGENTS = ['bento', 'jarbas', 'suzy', 'otto'] as const satisfies readonly AgentName[];

export function agentSelectionLabel(selection: AgentSelection): string {
  return selection === 'auto' ? AUTO_META.label : AGENT_META[selection].label;
}
