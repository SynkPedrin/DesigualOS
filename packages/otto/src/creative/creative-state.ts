import type { BrandKit, CreativeDNA } from './dna.js';

/**
 * creative-state.ts — o estado consolidado de inteligência criativa do Otto
 * (§52). Não é dado novo: é a LEITURA unificada do que o Otto já sabe sobre um
 * cliente/campanha (marca, DNA aprendido, histórico, restrições) mais o que
 * FALTA saber antes de criar (§54). A regra é a mesma do resto do sistema: o
 * que não existe não é inventado — vira lacuna explícita, que decide se é
 * preciso pesquisar. Puro e determinístico, testável sem rede.
 */

export interface CreativeReference {
  id: string;
  summary: string;
  verdict?: 'approved' | 'rejected';
}

export interface CreativeStateInput {
  clientId: string;
  objective: string;
  platform?: string | null;
  brand?: BrandKit | null;
  dna?: CreativeDNA | null;
  offer?: string | null;
  audience?: string | null;
  positioning?: string | null;
  campaign?: string | null;
  approvedCreatives?: CreativeReference[];
  rejectedCreatives?: CreativeReference[];
  memories?: string[];
  constraints?: string[];
}

export interface CreativeState {
  clientId: string;
  objective: string;
  platform: string | null;
  brand: BrandKit | null;
  dna: CreativeDNA | null;
  offer: string | null;
  audience: string | null;
  positioning: string | null;
  campaign: string | null;
  approvedCreatives: CreativeReference[];
  rejectedCreatives: CreativeReference[];
  memories: string[];
  constraints: string[];
}

export type CreativeGap =
  | 'brand_context'
  | 'offer'
  | 'audience'
  | 'objective'
  | 'creative_history'
  | 'positioning';

export interface CreativeReadiness {
  state: CreativeState;
  /** O que falta pra criar com fundamento (§54). Vazio = pronto pra gerar. */
  gaps: CreativeGap[];
  /** Uma lacuna que só dado ATUAL de mercado resolve → pesquisa externa (§55, §67). */
  requiresResearch: boolean;
  /** Motivo legível por lacuna, pro trace e pro pedido de contexto. */
  notes: string[];
}

function hasBrandContext(brand: BrandKit | null, dna: CreativeDNA | null): boolean {
  if (dna && (dna.toneOfVoice?.trim() || dna.palette.length > 0 || dna.aestheticDirection?.trim())) return true;
  if (brand && (brand.toneOfVoice?.trim() || (brand.palette?.length ?? 0) > 0)) return true;
  return false;
}

/** Monta o CreativeState a partir do que existe. Não inventa: campo ausente fica null. */
export function assembleCreativeState(input: CreativeStateInput): CreativeState {
  return {
    clientId: input.clientId,
    objective: input.objective.trim(),
    platform: input.platform ?? null,
    brand: input.brand ?? null,
    dna: input.dna ?? null,
    offer: input.offer ?? null,
    audience: input.audience ?? null,
    positioning: input.positioning ?? null,
    campaign: input.campaign ?? null,
    approvedCreatives: input.approvedCreatives ?? [],
    rejectedCreatives: input.rejectedCreatives ?? [],
    memories: input.memories ?? [],
    constraints: input.constraints ?? [],
  };
}

/**
 * KNOWLEDGE-GAP DETECTION (§54): antes de gerar, o Otto declara o que não
 * sabe. Lacuna de mercado (nada de histórico + objetivo que pede referência
 * atual) sinaliza pesquisa externa. Determinístico.
 */
export function assessCreativeReadiness(state: CreativeState): CreativeReadiness {
  const gaps: CreativeGap[] = [];
  const notes: string[] = [];

  if (!hasBrandContext(state.brand, state.dna)) {
    gaps.push('brand_context');
    notes.push('sem tom de voz/paleta/DNA da marca: recuperar brand kit ou consolidar DNA antes de criar');
  }
  if (!state.offer) {
    gaps.push('offer');
    notes.push('oferta não informada: confirmar o que está sendo comunicado');
  }
  if (!state.audience) {
    gaps.push('audience');
    notes.push('público-alvo não informado: confirmar para quem falamos');
  }
  if (!state.objective) {
    gaps.push('objective');
    notes.push('objetivo vazio: sem meta não há como avaliar o criativo');
  }
  if (state.approvedCreatives.length === 0 && state.rejectedCreatives.length === 0 && (!state.dna || state.dna.feedbackCount === 0)) {
    gaps.push('creative_history');
    notes.push('sem histórico criativo nem feedback: primeira leva para este cliente');
  }
  if (!state.positioning) {
    gaps.push('positioning');
  }

  // Pesquisa externa (§55): o objetivo pede dado ATUAL (tendência, concorrente,
  // referência do momento) e não temos isso no estado.
  const objectiveNeedsCurrent = /(tend[eê]ncia|atual|agora|202\d|concorr|mercado|refer[eê]ncia|viral|novidade|lan[çc]amento)/i.test(
    state.objective.normalize('NFD').replace(/[̀-ͯ]/g, ''),
  );
  const requiresResearch = objectiveNeedsCurrent && state.memories.length === 0;
  if (requiresResearch) notes.push('objetivo depende de dado atual de mercado e não há referência no estado: pesquisar');

  return { state, gaps, requiresResearch, notes };
}
