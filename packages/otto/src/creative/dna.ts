import type { CreativeFeedback } from './schemas.js';

/**
 * DNA criativo do cliente: a consolidação do que a agência aprendeu sobre
 * "o que passa" e "o que morre" na mesa do cliente. Entra como contexto do
 * planner pra que o 10º plano pro mesmo cliente seja melhor que o 1º -
 * não por sorte de prompt, mas por memória estruturada.
 */

export interface BrandKit {
  clientId: string;
  palette?: string[];
  typography?: string[];
  toneOfVoice?: string;
  referenceImages?: string[];
  restrictions?: string[];
}

export interface CreativeDNA {
  clientId: string;
  palette: string[];
  typography: string[];
  toneOfVoice: string;
  /** Padrões observados nos assets APROVADOS (o que repetir). */
  approvedPatterns: string[];
  /** Padrões observados nos assets REJEITADOS (o que evitar). */
  rejectedPatterns: string[];
  aestheticDirection: string;
  /**
   * 0..1: sobe com a quantidade de feedback consolidado. DNA com 1 feedback
   * é hipótese; DNA com 20 é convicção. O planner usa isso pra decidir
   * quanto peso dar ao DNA vs. ao briefing novo.
   */
  confidence: number;
  feedbackCount: number;
}

/**
 * Extrai padrões de uma lista de feedbacks. Heurística deliberadamente
 * simples e auditável: as razões recorrentes (mesmo motivo citado mais de
 * uma vez) viram padrão; razão única é ruído e não entra no DNA.
 */
function extractPatterns(reasons: string[]): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    const key = reason.trim().toLowerCase();
    if (key.length === 0) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([reason]) => reason);
}

export function deriveCreativeDNA(
  brandKit: BrandKit,
  feedbacks: CreativeFeedback[],
): CreativeDNA {
  const approved = feedbacks.filter((feedback) => feedback.verdict === 'approved');
  const rejected = feedbacks.filter((feedback) => feedback.verdict === 'rejected');
  const iterations = feedbacks.filter((feedback) => feedback.verdict === 'needs_iteration');

  // Rejeição e "needs_iteration" ensinam o que evitar; a razão da iteração
  // é tão instrutiva quanto a da rejeição, então entra no mesmo balaio.
  const rejectedPatterns = extractPatterns([
    ...rejected.map((feedback) => feedback.reason),
    ...iterations.map((feedback) => feedback.reason),
  ]);
  // Aprovado raramente vem com razão elaborada; quando vem, vira padrão
  // positivo só se recorrente (mesma regra anti-ruído).
  const approvedPatterns = extractPatterns(approved.map((feedback) => feedback.reason));

  // Confiança: aprovação conta 1, iteração conta 0.7, rejeição conta 0.8
  // (rejeição ensina menos que iteração porque costuma vir com menos contexto
  // acionável). Saturação em 20 pontos de evidência: acima disso o DNA é
  // considerado maduro e o planner pode pesá-lo à vontade.
  const evidencePoints =
    approved.length * 1 + iterations.length * 0.7 + rejected.length * 0.8;
  const confidence = Math.min(1, evidencePoints / 20);

  const aestheticDirection = [
    brandKit.toneOfVoice ? `Tom: ${brandKit.toneOfVoice}` : null,
    brandKit.restrictions?.length
      ? `Restrições: ${brandKit.restrictions.join('; ')}`
      : null,
    approvedPatterns.length ? `Repetir: ${approvedPatterns.join('; ')}` : null,
    rejectedPatterns.length ? `Evitar: ${rejectedPatterns.join('; ')}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    clientId: brandKit.clientId,
    palette: brandKit.palette ?? [],
    typography: brandKit.typography ?? [],
    toneOfVoice: brandKit.toneOfVoice ?? '',
    approvedPatterns,
    rejectedPatterns,
    aestheticDirection,
    confidence,
    feedbackCount: feedbacks.length,
  };
}
