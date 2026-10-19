import { TECHNICAL_SCORE_FLOOR, type MotionQualityScore } from '../types.js';

/**
 * §24 — leitura do veredito visual que o agente escreveu em QA.md.
 *
 * O formato é pedido explicitamente no prompt (VEREDITO/PROBLEMAS/SCORES). O
 * parser é tolerante de propósito: modelo bom erra pontuação, e travar o
 * pipeline por causa de um dois-pontos seria trocar um defeito visual por um
 * defeito de integração.
 *
 * Na dúvida, o default é REQUIRES_FIX. Um veredito ilegível tratado como
 * aprovação publicaria peça sem revisão nenhuma; tratado como reprovação, o
 * custo é uma passada a mais.
 */
export type VisualVerdict = 'QUALITY_PASS' | 'REQUIRES_FIX';

export interface VisualQaReport {
  verdict: VisualVerdict;
  problems: string[];
  scores: Omit<MotionQualityScore, 'technical'>;
  /** O texto cru, guardado no workspace pra auditoria. */
  raw: string;
}

const DEFAULT_SCORES: Omit<MotionQualityScore, 'technical'> = {
  visual: 0,
  brand: 0,
  legibility: 0,
  composition: 0,
};

export function parseVisualQa(raw: string): VisualQaReport {
  const text = raw.trim();

  const passed = /VEREDITO\s*:?\s*QUALITY[_ ]?PASS/i.test(text);
  const failed = /VEREDITO\s*:?\s*REQUIRES[_ ]?FIX/i.test(text);
  // Ambos presentes (o agente citou os dois ao explicar o formato) ou nenhum:
  // reprova. Ver comentário do cabeçalho.
  const verdict: VisualVerdict = passed && !failed ? 'QUALITY_PASS' : 'REQUIRES_FIX';

  const problems: string[] = [];
  const problemsBlock = /PROBLEMAS\s*:?\s*\n([\s\S]*?)(?=\n\s*SCORES|\n\s*#|$)/i.exec(text)?.[1] ?? '';
  for (const line of problemsBlock.split('\n')) {
    const value = /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim();
    if (value && value.length > 3) problems.push(value);
  }

  const scores = { ...DEFAULT_SCORES };
  for (const key of ['visual', 'brand', 'legibility', 'composition'] as const) {
    const match = new RegExp(`\\b${key}\\s*:?\\s*(\\d{1,3})`, 'i').exec(text);
    const value = match?.[1] ? Number.parseInt(match[1], 10) : undefined;
    if (value !== undefined && value >= 0 && value <= 100) scores[key] = value;
  }

  return { verdict, problems, scores, raw: text };
}

/**
 * §44 — o portão final.
 *
 * `technical` é medição e tem piso duro. Os quatro visuais são heurística de
 * revisor: servem pra decidir se vale mais uma passada, não pra virar número
 * de relatório. Por isso o piso deles é baixo e o que realmente barra é o
 * veredito somado a problema de LEGIBILIDADE — texto ilegível é o defeito
 * que mais aparece e o único dos quatro que é praticamente objetivo.
 */
export function shouldBlockDelivery(params: {
  technicalScore: number;
  visual: VisualQaReport | null;
}): { blocked: boolean; reason: string | null } {
  if (params.technicalScore < TECHNICAL_SCORE_FLOOR) {
    return { blocked: true, reason: `QA técnico em ${params.technicalScore}/100 (piso ${TECHNICAL_SCORE_FLOOR})` };
  }
  if (params.visual?.verdict === 'REQUIRES_FIX' && params.visual.problems.length > 0) {
    return { blocked: true, reason: `revisão visual apontou ${params.visual.problems.length} problema(s)` };
  }
  if (params.visual && params.visual.scores.legibility > 0 && params.visual.scores.legibility < 60) {
    return { blocked: true, reason: `legibilidade em ${params.visual.scores.legibility}/100` };
  }
  return { blocked: false, reason: null };
}

export function buildQualityScore(technicalScore: number, visual: VisualQaReport | null): MotionQualityScore {
  return {
    technical: technicalScore,
    visual: visual?.scores.visual ?? 0,
    brand: visual?.scores.brand ?? 0,
    legibility: visual?.scores.legibility ?? 0,
    composition: visual?.scores.composition ?? 0,
  };
}
