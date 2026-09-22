import { z } from 'zod';
import type { QualityDimension, Rubric } from './rubric';

/**
 * PairwiseComparator + RegressionGuard.
 *
 * Esta é a peça que faz valer o princípio da fase: NENHUMA CORREÇÃO
 * AUTOMÁTICA PODE PIORAR A IMAGEM ENTREGUE.
 *
 * Por que comparar A e B lado a lado, e não comparar dois scores
 * absolutos: medido na fase 2 que a nota do crítico é instável ENTRE
 * imagens diferentes (três tentativas distintas receberam `overall 7,5`
 * apesar de uma delas ter mãos destruídas e outra não). Score absoluto não
 * discrimina; comparação direta, com as duas imagens no mesmo contexto,
 * pergunta exatamente o que importa: "esta ficou melhor que aquela?".
 *
 * O veredito do modelo (`winner`) também NÃO decide sozinho - ele alimenta
 * `applyRegressionGuard`, que é determinístico. Modelo opina; regra decide.
 */

export const REGRESSION_SEVERITY = ['none', 'minor', 'moderate', 'critical'] as const;

const pairwiseSchema = z.object({
  winner: z.enum(['A', 'B', 'tie']),
  confidence: z.number().min(0).max(1),
  target_issue_fixed: z.boolean(),
  target_issue_improvement: z.number().min(0).max(1),
  regressions: z.array(
    z.object({
      dimension: z.string(),
      severity: z.enum(REGRESSION_SEVERITY),
      note: z.string(),
    }),
  ),
  reason: z.string(),
});

export type PairwiseResult = z.infer<typeof pairwiseSchema> & { model: string; latencyMs: number };

export const PAIRWISE_FORMAT = {
  type: 'object',
  properties: {
    winner: { type: 'string', enum: ['A', 'B', 'tie'] },
    confidence: { type: 'number' },
    target_issue_fixed: { type: 'boolean' },
    target_issue_improvement: { type: 'number' },
    regressions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dimension: { type: 'string' },
          severity: { type: 'string', enum: [...REGRESSION_SEVERITY] },
          note: { type: 'string' },
        },
        required: ['dimension', 'severity', 'note'],
      },
    },
    reason: { type: 'string' },
  },
  required: ['winner', 'confidence', 'target_issue_fixed', 'target_issue_improvement', 'regressions', 'reason'],
} as const;

export const PAIRWISE_SYSTEM_PROMPT = [
  'You compare two versions of the SAME AI-generated commercial image.',
  'The FIRST image is A (the original). The SECOND image is B (after a targeted correction).',
  'Your job is NOT to find the prettier picture: it is to decide whether B is safe to ship INSTEAD of A.',
  'Report every dimension where B is WORSE than A, however small, in "regressions".',
  'Severity "critical" means a client would reject B for that reason alone.',
  'target_issue_improvement: 0 = the reported issue is unchanged or worse in B, 1 = fully resolved in B.',
  'If B changed a person\'s identity, distorted a logo, or broke product geometry, that is always critical.',
].join(' ');

export function buildPairwisePrompt(params: { briefing: string; targetIssue: string; rubric: Rubric }): string {
  return [
    `Original briefing: "${params.briefing}"`,
    `The correction attempted in B targeted this specific issue: "${params.targetIssue}"`,
    params.rubric.critical.length > 0
      ? `These dimensions are CRITICAL and must not degrade: ${params.rubric.critical.join(', ')}.`
      : '',
    'Did B fix the issue without making anything else worse?',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parsePairwise(raw: unknown, model: string, latencyMs: number): PairwiseResult {
  return { ...pairwiseSchema.parse(raw), model, latencyMs };
}

export interface GuardDecision {
  /** true = B substitui A. false = rollback, A permanece. */
  acceptB: boolean;
  reason: string;
  criticalRegressions: string[];
}

/** Confiança mínima do comparador para autorizar a troca. */
export const MIN_PAIRWISE_CONFIDENCE = 0.6;

/**
 * RegressionGuard — determinístico, e deliberadamente assimétrico:
 * aceitar B exige evidência positiva; rejeitar B não exige nada além da
 * dúvida. Na prática, empate, baixa confiança ou qualquer regressão
 * crítica mantêm A.
 *
 * "Não regredir" vale mais que "nota maior": uma peça com a mão consertada
 * e o rosto trocado é pior que a peça original, por mais que o overall suba.
 */
export function applyRegressionGuard(params: {
  pairwise: PairwiseResult;
  rubric: Rubric;
}): GuardDecision {
  const { pairwise, rubric } = params;

  const criticas = pairwise.regressions.filter((r) => r.severity === 'critical').map((r) => r.dimension);

  // Regressão numa dimensão declarada crítica pela rubrica conta como
  // crítica mesmo que o modelo tenha classificado como "moderate": quem
  // define o que é intocável nesta peça é a rubrica, não o modelo.
  const criticasPorRubrica = pairwise.regressions
    .filter((r) => r.severity === 'moderate' && rubric.critical.includes(r.dimension as QualityDimension))
    .map((r) => r.dimension);

  const bloqueantes = [...new Set([...criticas, ...criticasPorRubrica])];

  if (bloqueantes.length > 0) {
    return {
      acceptB: false,
      reason: `Rollback: a correção regrediu ${bloqueantes.join(', ')}. Preservar a original vale mais que corrigir o defeito alvo.`,
      criticalRegressions: bloqueantes,
    };
  }
  if (!pairwise.target_issue_fixed) {
    return { acceptB: false, reason: 'Rollback: a correção não resolveu o defeito alvo.', criticalRegressions: [] };
  }
  if (pairwise.winner === 'A') {
    return { acceptB: false, reason: 'Rollback: a comparação apontou a original como melhor.', criticalRegressions: [] };
  }
  if (pairwise.winner === 'tie') {
    // Empate mantém A de propósito: trocar sem ganho gasta GPU e adiciona
    // risco sem contrapartida.
    return { acceptB: false, reason: 'Rollback: empate - sem ganho que justifique substituir a original.', criticalRegressions: [] };
  }
  if (pairwise.confidence < MIN_PAIRWISE_CONFIDENCE) {
    return {
      acceptB: false,
      reason: `Rollback: confiança ${pairwise.confidence.toFixed(2)} abaixo do mínimo ${MIN_PAIRWISE_CONFIDENCE}.`,
      criticalRegressions: [],
    };
  }

  return {
    acceptB: true,
    reason: `Aceita: defeito alvo corrigido (melhora ${pairwise.target_issue_improvement.toFixed(2)}), sem regressão crítica.`,
    criticalRegressions: [],
  };
}
