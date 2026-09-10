/**
 * Pipeline de aprendizado do Otto. Puro, sem DB: a persistência acontece na
 * tabela `memories` existente (packages/database/src/schema/knowledge.ts),
 * com kind prefixado `otto.*` e o estágio/confiança em metadata. Aqui ficam
 * os tipos e as regras de transição, pra que a política de "quando uma
 * observação vira verdade operacional" seja testável e auditável.
 *
 * Estágios (funil de confiança):
 *   observation  -> algo que vimos uma vez (ex: cliente rejeitou gradiente)
 *   experimental -> hipótese que estamos testando ativamente
 *   validated    -> confirmada por evidência humana recorrente
 *   trusted      -> confiável o bastante pra influenciar planos por default
 *   core         -> parte da identidade criativa do cliente; só o diretor promove
 */

export const OTTO_LEARNING_STAGES = [
  'observation',
  'experimental',
  'validated',
  'trusted',
  'core',
] as const;

export type OttoLearningStage = (typeof OTTO_LEARNING_STAGES)[number];

/**
 * Kinds de memória do Otto na tabela memories. Prefixo `otto.` pra separar
 * o namespace do agente dos demais (studio, sdr, etc.) no mesmo campo kind.
 */
export const OTTO_LEARNING_KINDS = [
  'otto.observation',
  'otto.preference',
  'otto.pattern',
  'otto.rejection_reason',
  'otto.approval_reason',
  'otto.brand_rule',
] as const;

export type OttoLearningKind = (typeof OTTO_LEARNING_KINDS)[number];

/** Origem da evidência: de onde veio o dado que sustenta o aprendizado. */
export type OttoEvidenceOrigin =
  | 'human_feedback' // aprovação/rejeição explícita de alguém da agência ou do cliente
  | 'director' // decisão do diretor criativo (a mais forte: é quem assina)
  | 'auto_eval' // QC estruturado do próprio Otto (creative/quality.ts)
  | 'metric'; // performance medida (saves, follows, CTR)

export interface OttoEvidence {
  origin: OttoEvidenceOrigin;
  /** true: evidência a favor do aprendizado; false: contra (contraexemplo). */
  positive: boolean;
  /** Peso extra opcional (ex: feedback do cliente final pesa mais). */
  weight?: number;
}

export interface OttoLearning {
  kind: OttoLearningKind;
  stage: OttoLearningStage;
  /** 0..1, derivado das evidências (ver recordEvidence). */
  confidence: number;
  evidences: OttoEvidence[];
  /** Texto do aprendizado (vai em memories.content na persistência). */
  content: string;
  clientId?: string;
}

/** Peso por origem: diretor assina, humano valida, métrica informa, auto-avaliação só sugere. */
const ORIGIN_WEIGHT: Record<OttoEvidenceOrigin, number> = {
  director: 3,
  human_feedback: 2,
  metric: 1.5,
  auto_eval: 0.5,
};

/**
 * Regras de promoção. evidenceCount mínimo e confidence mínima por estágio,
 * mais origem obrigatória: validated pra cima exige evidência HUMANA (o Otto
 * não pode se auto-validar via QC próprio - isso seria viés de confirmação
 * institucionalizado), e core exige o diretor.
 */
interface PromotionRule {
  minEvidences: number;
  minConfidence: number;
  requiredOrigin?: OttoEvidenceOrigin;
}

const PROMOTION_RULES: Record<Exclude<OttoLearningStage, 'observation'>, PromotionRule> = {
  experimental: { minEvidences: 1, minConfidence: 0.3 },
  validated: { minEvidences: 3, minConfidence: 0.6, requiredOrigin: 'human_feedback' },
  trusted: { minEvidences: 8, minConfidence: 0.8, requiredOrigin: 'human_feedback' },
  core: { minEvidences: 20, minConfidence: 0.9, requiredOrigin: 'director' },
};

export function createLearning(params: {
  kind: OttoLearningKind;
  content: string;
  clientId?: string;
}): OttoLearning {
  return {
    kind: params.kind,
    content: params.content,
    stage: 'observation',
    // Prior neutro: 0.5, "não sei ainda". As evidências movem daqui.
    confidence: 0.5,
    evidences: [],
    ...(params.clientId ? { clientId: params.clientId } : {}),
  };
}

/**
 * Registra evidência e recalcula a confiança. Modelo deliberadamente simples
 * e explicável: confiança = (peso positivo + prior) / (peso total + 2*prior),
 * uma média beta com prior 1:1 em 0.5. Evidência negativa derruba a
 * confiança - contraexemplo vale tanto quanto exemplo.
 */
export function recordEvidence(learning: OttoLearning, evidence: OttoEvidence): OttoLearning {
  const evidences = [...learning.evidences, evidence];
  let positiveWeight = 0;
  let totalWeight = 0;
  for (const item of evidences) {
    const weight = ORIGIN_WEIGHT[item.origin] * (item.weight ?? 1);
    totalWeight += weight;
    if (item.positive) positiveWeight += weight;
  }
  const confidence = (positiveWeight + 1) / (totalWeight + 2);
  return { ...learning, evidences, confidence };
}

export interface PromotionCheck {
  allowed: boolean;
  /** Razões legíveis do bloqueio, pra log/UI ("falta evidência humana"). */
  blockers: string[];
  targetStage: OttoLearningStage;
}

function stageIndex(stage: OttoLearningStage): number {
  return OTTO_LEARNING_STAGES.indexOf(stage);
}

export function canPromote(learning: OttoLearning, targetStage: OttoLearningStage): PromotionCheck {
  const blockers: string[] = [];

  if (stageIndex(targetStage) <= stageIndex(learning.stage)) {
    blockers.push(`target stage "${targetStage}" is not ahead of current "${learning.stage}"`);
    return { allowed: false, blockers, targetStage };
  }

  // Promoção é de um degrau por vez: pular estágio esconde o momento em
  // que a evidência deveria ter sido questionada.
  if (stageIndex(targetStage) > stageIndex(learning.stage) + 1) {
    blockers.push(`cannot skip stages (current "${learning.stage}", target "${targetStage}")`);
    return { allowed: false, blockers, targetStage };
  }

  const rule = PROMOTION_RULES[targetStage as Exclude<OttoLearningStage, 'observation'>];
  if (!rule) {
    blockers.push('observation has no promotion rule (it is the entry stage)');
    return { allowed: false, blockers, targetStage };
  }

  if (learning.evidences.length < rule.minEvidences) {
    blockers.push(
      `needs ${rule.minEvidences} evidences, has ${learning.evidences.length}`,
    );
  }
  if (learning.confidence < rule.minConfidence) {
    blockers.push(
      `needs confidence >= ${rule.minConfidence}, has ${learning.confidence.toFixed(2)}`,
    );
  }
  if (
    rule.requiredOrigin &&
    !learning.evidences.some(
      (evidence) => evidence.origin === rule.requiredOrigin && evidence.positive,
    )
  ) {
    blockers.push(`requires positive evidence from origin "${rule.requiredOrigin}"`);
  }

  return { allowed: blockers.length === 0, blockers, targetStage };
}

/** Próximo estágio do funil, ou null se já está em core. */
export function nextStage(stage: OttoLearningStage): OttoLearningStage | null {
  const index = stageIndex(stage);
  return index < OTTO_LEARNING_STAGES.length - 1
    ? (OTTO_LEARNING_STAGES[index + 1] ?? null)
    : null;
}

/**
 * Tenta promover um degrau. Retorna o learning promovido, ou o mesmo objeto
 * inalterado com os blockers preenchidos - nunca lança, porque "não promoveu"
 * é um estado normal do funil, não um erro.
 */
export function promoteLearning(
  learning: OttoLearning,
): { learning: OttoLearning; promoted: boolean; blockers: string[] } {
  const target = nextStage(learning.stage);
  if (!target) {
    return { learning, promoted: false, blockers: ['already at core stage'] };
  }
  const check = canPromote(learning, target);
  if (!check.allowed) {
    return { learning, promoted: false, blockers: check.blockers };
  }
  return { learning: { ...learning, stage: target }, promoted: true, blockers: [] };
}
