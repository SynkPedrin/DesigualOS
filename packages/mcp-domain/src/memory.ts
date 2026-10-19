/**
 * memory.ts — a memória tem PROCEDÊNCIA, e nada que o Claude escreveu nasce
 * como fato (§11).
 *
 * A tabela `memories` já carrega `source_type`, `confidence`, `status`,
 * `superseded_by` e `environment`, e a supersessão já funciona com teste. O que
 * falta é o CICLO DE VIDA que a missão pede: hoje `status` só assume `active` e
 * `superseded`, então não há como distinguir "o Claude observou isso numa
 * conversa" de "um humano aprovou isso como política da agência".
 *
 * Essa distinção é a diferença entre memória institucional e boato com banco de
 * dados.
 */

export const MEMORY_STATUSES = [
  /** Alguém disse, está registrado, ninguém confirmou. Default de tudo que vem do chat. */
  'OBSERVED',
  /** O sistema deduziu a partir de outros dados. Nunca vira fato sozinho. */
  'INFERRED',
  /** Outra fonte independente bate com esta. */
  'CONFIRMED',
  /** Um humano com papel suficiente aprovou. É o único nível que vira política. */
  'APPROVED',
  /** Um humano disse que está errado. Fica no banco — errar é informação. */
  'REJECTED',
  /** Uma versão mais nova substituiu esta. */
  'SUPERSEDED',
] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export function isMemoryStatus(value: string): value is MemoryStatus {
  return (MEMORY_STATUSES as readonly string[]).includes(value);
}

/**
 * De onde a memória veio. `agent` e `claude` são separados de propósito: o
 * primeiro é um agente da casa (Bento, Otto), o segundo é o Claude de um
 * funcionário. Saber qual dos dois falou muda o quanto se confia.
 */
export const MEMORY_SOURCES = ['human', 'claude', 'agent', 'clickup', 'vault', 'meta_ads', 'system'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export interface MemoryRecord {
  id: string;
  kind: string;
  content: string;
  status: MemoryStatus;
  source: MemorySource;
  /** 0..1. Nunca 1 para nada que veio de `claude` sem confirmação — ver `confiancaInicial`. */
  confidence: number;
  author: string;
  clientId: string | null;
  createdAt: Date;
  supersededBy?: string | null;
}

/**
 * Confiança com que uma memória NASCE, pela fonte.
 *
 * O número não é decorativo: é o que impede o texto gerado por um modelo de
 * chegar ao próximo funcionário com o mesmo peso de uma decisão de cliente.
 */
export function confiancaInicial(source: MemorySource): number {
  switch (source) {
    case 'human': return 0.9;
    case 'clickup': return 0.95;
    case 'meta_ads': return 0.95;
    case 'vault': return 0.7;
    case 'agent': return 0.6;
    /**
     * O Claude é a fonte MENOS confiável por construção, e isso não é desdém
     * pelo modelo: é que ele está relatando o que ouviu numa conversa, sem
     * checar nada. O §11 diz isso com todas as letras — nunca aceitar texto
     * gerado como fato definitivo automaticamente.
     */
    case 'claude': return 0.5;
    case 'system': return 0.8;
    default: return 0.5;
  }
}

/** Status com que uma memória nasce, pela fonte. Nada nasce APPROVED. */
export function statusInicial(source: MemorySource): MemoryStatus {
  return source === 'system' ? 'INFERRED' : 'OBSERVED';
}

/**
 * Transições permitidas. O grafo é a política, e ele é estreito de propósito:
 * não existe caminho de OBSERVED direto para APPROVED sem passar por um humano
 * (quem chama `aprovar` precisa de papel; ver `podeAprovar`).
 */
const TRANSICOES: Record<MemoryStatus, readonly MemoryStatus[]> = {
  OBSERVED: ['CONFIRMED', 'APPROVED', 'REJECTED', 'SUPERSEDED'],
  INFERRED: ['OBSERVED', 'CONFIRMED', 'APPROVED', 'REJECTED', 'SUPERSEDED'],
  CONFIRMED: ['APPROVED', 'REJECTED', 'SUPERSEDED'],
  APPROVED: ['REJECTED', 'SUPERSEDED'],
  /** Fim de linha: memória rejeitada não volta. Registre uma nova. */
  REJECTED: [],
  /** Fim de linha: quem foi substituído não ressuscita. */
  SUPERSEDED: [],
};

export function podeTransicionar(de: MemoryStatus, para: MemoryStatus): boolean {
  return (TRANSICOES[de] ?? []).includes(para);
}

/**
 * Só estes papéis transformam observação em política da agência. Um criativo
 * registra o que o cliente disse; ele não decide que aquilo passa a reger o
 * trabalho de todo mundo.
 */
const PAPEIS_QUE_APROVAM = new Set(['SUPER_ADMIN', 'MANAGER']);
export function podeAprovar(role: string): boolean {
  return PAPEIS_QUE_APROVAM.has(role);
}

/**
 * A memória sustenta uma afirmação para o próximo funcionário?
 *
 * `REJECTED` e `SUPERSEDED` ficam de fora. `OBSERVED` entra, mas quem a exibe
 * precisa dizer que é relato não confirmado — daí o segundo campo.
 */
export function ehCitavel(m: Pick<MemoryRecord, 'status'>): { citavel: boolean; ressalva: string | null } {
  switch (m.status) {
    case 'APPROVED':
      return { citavel: true, ressalva: null };
    case 'CONFIRMED':
      return { citavel: true, ressalva: 'confirmado por mais de uma fonte, sem aprovação formal' };
    case 'OBSERVED':
      return { citavel: true, ressalva: 'relato não confirmado — verifique antes de tratar como regra' };
    case 'INFERRED':
      return { citavel: true, ressalva: 'deduzido pelo sistema, não afirmado por ninguém' };
    default:
      return { citavel: false, ressalva: null };
  }
}
