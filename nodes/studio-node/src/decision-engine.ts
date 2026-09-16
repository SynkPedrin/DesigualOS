import type { CriticProblem, CriticRegion, CriticResult } from './visual-critic';
import type { QualityProfile } from './quality-profiles';

/**
 * Decision Engine — converte os scores do crítico numa AÇÃO, por regra
 * determinística.
 *
 * Por que o veredito do modelo não decide: medido em 16/09/2026 que
 * `qwen3.6:35b-a3b` e `qwen3.5:9b` produziram scores IDÊNTICOS pra mesma
 * imagem (overall 7, hands 4, artifact 3, ...) e ainda assim discordaram no
 * campo de recomendação — um pediu `requires_regeneration`, o outro
 * `requires_local_edit`. Se o gate seguisse o campo do modelo, o
 * comportamento do Studio dependeria de qual modelo estava carregado. Sobre
 * os NÚMEROS os dois concordam; é sobre eles que se decide.
 *
 * Thresholds ficam aqui, num lugar só, versionados junto do código — não em
 * env var. Mudar um número destes muda o que a casa considera entregável, e
 * isso tem que aparecer em diff e code review, não num `.env` de uma
 * máquina.
 */

export type QualityAction =
  /** Passou no gate: segue pro finish/upscale. */
  | 'approve'
  /** Defeito localizado (mão/rosto/fundo): vale corrigir a região, não refazer tudo. */
  | 'local_edit'
  /** Defeito global (composição/aderência/artefato generalizado): refaz com seed nova. */
  | 'regenerate'
  /** Acabaram as tentativas: entrega o melhor candidato com o laudo junto. */
  | 'accept_best';

export interface QualityThresholds {
  overall: number;
  artifact: number;
  promptAlignment: number;
  composition: number;
  /** Só aplicado quando o job declara identidade como crítica. */
  identity: number;
  /** Só aplicado quando o job declara produto como crítico. */
  product: number;
  /** Abaixo disto, anatomia/mão/rosto contam como defeito localizado. */
  region: number;
}

/**
 * `draft` é explicitamente permissivo: é o preset pra explorar seed e
 * enquadramento, e travar exploração num gate de qualidade comercial só
 * gasta GPU. `master` é o que vai pro cliente.
 */
export const THRESHOLDS_BY_PROFILE: Record<QualityProfile, QualityThresholds> = {
  draft: { overall: 5.0, artifact: 3.0, promptAlignment: 5.0, composition: 4.0, identity: 5.0, product: 5.0, region: 3.0 },
  standard: { overall: 7.0, artifact: 5.0, promptAlignment: 7.0, composition: 6.0, identity: 7.0, product: 7.0, region: 5.0 },
  master: { overall: 8.0, artifact: 6.5, promptAlignment: 8.0, composition: 7.0, identity: 8.0, product: 8.0, region: 6.5 },
};

/** Regiões que um inpaint/refino localizado sabe atacar hoje. */
const LOCALLY_FIXABLE: readonly CriticRegion[] = ['face', 'hands', 'background', 'product'];

export interface DecisionContext {
  critic: CriticResult;
  profile: QualityProfile;
  attempt: number;
  maxAttempts: number;
  identityCritical: boolean;
  productCritical: boolean;
}

export interface QualityDecision {
  action: QualityAction;
  /** Frase curta, em português, pro log e pro laudo do job. */
  reason: string;
  /** Dimensões que ficaram abaixo do threshold - vira instrução de correção. */
  failedDimensions: string[];
  /** Regiões a atacar quando action='local_edit'. */
  targetRegions: CriticRegion[];
  thresholds: QualityThresholds;
}

function failedDimensions(critic: CriticResult, t: QualityThresholds, ctx: DecisionContext): string[] {
  const failed: string[] = [];
  if (critic.overall_score < t.overall) failed.push('overall');
  if (critic.artifact_score < t.artifact) failed.push('artifact');
  if (critic.prompt_alignment < t.promptAlignment) failed.push('prompt_alignment');
  if (critic.composition < t.composition) failed.push('composition');
  if (critic.anatomy < t.region) failed.push('anatomy');
  if (critic.hands < t.region) failed.push('hands');
  if (critic.face < t.region) failed.push('face');
  // Identidade/produto só entram quando o job disse que importam: cobrar
  // fidelidade de produto numa paisagem reprova imagem boa à toa.
  if (ctx.identityCritical && critic.face < t.identity) failed.push('identity');
  if (ctx.productCritical && critic.commercial_quality < t.product) failed.push('product');
  // text_integrity NÃO entra no gate de propósito: medido que os três
  // modelos locais testados erram essa dimensão com confiança alta (o 9B
  // declarou "perfectly legible" uma placa visivelmente truncada). Texto
  // real é responsabilidade do compositing (text-overlay.ts).
  return failed;
}

/**
 * Problemas `high` em região localizável mandam mais que a média: uma mão
 * destruída num retrato reprova a peça mesmo com overall alto, porque é
 * exatamente o defeito que o olho do cliente encontra primeiro.
 */
function severeLocalRegions(problems: CriticProblem[]): CriticRegion[] {
  const regions = problems
    .filter((problem) => problem.severity === 'high' && LOCALLY_FIXABLE.includes(problem.region))
    .map((problem) => problem.region);
  return [...new Set(regions)];
}

export function decideQuality(ctx: DecisionContext): QualityDecision {
  const thresholds = THRESHOLDS_BY_PROFILE[ctx.profile];
  const failed = failedDimensions(ctx.critic, thresholds, ctx);
  const severeRegions = severeLocalRegions(ctx.critic.problems);

  if (failed.length === 0 && severeRegions.length === 0) {
    return { action: 'approve', reason: `Aprovado no perfil ${ctx.profile} (overall ${ctx.critic.overall_score}).`, failedDimensions: [], targetRegions: [], thresholds };
  }

  // Última tentativa: não adianta pedir correção que não vai rodar. Entrega
  // o melhor candidato COM o laudo, nunca finge que passou.
  if (ctx.attempt >= ctx.maxAttempts) {
    return {
      action: 'accept_best',
      reason: `Limite de ${ctx.maxAttempts} tentativas atingido sem passar no gate (falhou: ${failed.join(', ') || 'defeito localizado grave'}). Entregando o melhor candidato com laudo.`,
      failedDimensions: failed,
      targetRegions: severeRegions,
      thresholds,
    };
  }

  // Falha ESTRUTURAL: composição errada, briefing não atendido ou artefato
  // generalizado não se conserta com inpaint - a imagem está errada desde a
  // origem. Refazer é mais barato que refinar o que não serve.
  const structural = failed.filter((dimension) => ['composition', 'prompt_alignment', 'artifact', 'overall'].includes(dimension));
  const onlyLocal = structural.length === 0 && (severeRegions.length > 0 || failed.every((d) => ['hands', 'face', 'anatomy', 'identity'].includes(d)));

  if (onlyLocal) {
    const regions = severeRegions.length > 0 ? severeRegions : regionsFromDimensions(failed);
    return {
      action: 'local_edit',
      reason: `Composição e aderência OK; defeito localizado em ${regions.join(', ')}. Correção dirigida em vez de refazer.`,
      failedDimensions: failed,
      targetRegions: regions,
      thresholds,
    };
  }

  return {
    action: 'regenerate',
    reason: `Falha estrutural (${structural.join(', ') || failed.join(', ')}) - refazendo com seed nova.`,
    failedDimensions: failed,
    targetRegions: [],
    thresholds,
  };
}

function regionsFromDimensions(failed: string[]): CriticRegion[] {
  const regions: CriticRegion[] = [];
  if (failed.includes('hands')) regions.push('hands');
  if (failed.includes('face') || failed.includes('identity')) regions.push('face');
  if (failed.includes('anatomy') && !regions.includes('hands')) regions.push('body');
  return regions.length > 0 ? regions : ['global'];
}

/**
 * Melhor candidato entre as tentativas (seção 14 do plano). Critério
 * primário é `overall_score`; empate desempata por `artifact_score` (uma
 * peça com o mesmo overall mas menos artefato é sempre a entregável) e
 * depois pela tentativa mais NOVA, que já incorpora as correções.
 */
export interface Candidate<T> {
  attempt: number;
  critic: CriticResult;
  payload: T;
}

export function selectBestCandidate<T>(candidates: Candidate<T>[]): Candidate<T> {
  if (candidates.length === 0) throw new Error('selectBestCandidate: nenhuma tentativa registrada');
  return candidates.reduce((best, candidate) => {
    if (candidate.critic.overall_score !== best.critic.overall_score) {
      return candidate.critic.overall_score > best.critic.overall_score ? candidate : best;
    }
    if (candidate.critic.artifact_score !== best.critic.artifact_score) {
      return candidate.critic.artifact_score > best.critic.artifact_score ? candidate : best;
    }
    return candidate.attempt > best.attempt ? candidate : best;
  });
}

/**
 * Instrução de correção acrescentada ao prompt da PRÓXIMA tentativa.
 * Deliberadamente curta e imperativa: prompt de correção longo dilui o
 * prompt original e o FLUX.2 passa a perseguir o texto da crítica em vez da
 * peça pedida.
 */
export function buildCorrectionDirective(decision: QualityDecision, critic: CriticResult): string {
  const severe = critic.problems
    .filter((problem) => problem.severity === 'high')
    .slice(0, 3)
    .map((problem) => problem.description.replace(/\s+/g, ' ').trim().slice(0, 140));

  const focus: string[] = [];
  if (decision.targetRegions.includes('hands')) focus.push('anatomically correct hands with five clearly separated fingers');
  if (decision.targetRegions.includes('face')) focus.push('a sharp, natural, symmetric face with realistic skin texture');
  if (decision.failedDimensions.includes('composition')) focus.push('a cleaner, more deliberate commercial composition');
  if (decision.failedDimensions.includes('prompt_alignment')) focus.push('strict adherence to the original briefing');

  const parts = [focus.length > 0 ? `Render ${focus.join(', ')}.` : '', severe.length > 0 ? `Avoid: ${severe.join('; ')}.` : ''];
  return parts.filter(Boolean).join(' ');
}
