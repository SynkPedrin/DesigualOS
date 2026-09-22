import type { ContentClassification } from './content-classifier';

/**
 * QualityRubricBuilder — a rubrica depende da IMAGEM, não de uma lista fixa.
 *
 * Regra que dá nome à fase: uma dimensão que não se aplica vale `null`,
 * nunca `10`. Preencher com 10 significa "perfeito" e contamina qualquer
 * média, gate ou comparação; `null` significa "não existe aqui" e é
 * ignorado por construção.
 *
 * Isto ataca a causa raiz do falso negativo medido na fase 2: o schema
 * antigo exigia `anatomy` em toda peça, então o modelo inventava um número
 * mesmo numa foto de produto sem gente nenhuma.
 */

export const ALL_DIMENSIONS = [
  'prompt_alignment',
  'composition',
  'lighting',
  'realism',
  'artifact_level',
  'commercial_readiness',
  'identity',
  'face',
  'eyes',
  'skin',
  'hair',
  'hands',
  'body_anatomy',
  'product_fidelity',
  'product_geometry',
  'materials',
  'logo',
  'branding',
  'text',
  'hierarchy',
  'layout',
  'color_consistency',
] as const;
export type QualityDimension = (typeof ALL_DIMENSIONS)[number];

/** Vale para qualquer peça: não depende de haver gente, produto ou texto. */
const SEMPRE: QualityDimension[] = ['prompt_alignment', 'composition', 'lighting', 'realism', 'artifact_level', 'commercial_readiness'];

export interface Rubric {
  applicable: QualityDimension[];
  notApplicable: QualityDimension[];
  /** Subconjunto de `applicable` que não pode degradar numa correção. */
  critical: QualityDimension[];
  contentType: ContentClassification['content_type'];
}

export function buildRubric(content: ContentClassification): Rubric {
  const applicable = new Set<QualityDimension>(SEMPRE);
  const critical = new Set<QualityDimension>();

  if (content.contains_face) {
    for (const d of ['identity', 'face', 'eyes', 'skin', 'hair'] as QualityDimension[]) applicable.add(d);
    // Identidade é o que o cliente reconhece primeiro; trocar o rosto de
    // alguém é o pior desfecho possível de uma "melhoria".
    critical.add('identity');
    critical.add('face');
  }
  if (content.contains_hands) {
    applicable.add('hands');
    critical.add('hands');
  }
  if (content.contains_people) applicable.add('body_anatomy');

  if (content.contains_product) {
    for (const d of ['product_fidelity', 'product_geometry', 'materials'] as QualityDimension[]) applicable.add(d);
    critical.add('product_fidelity');
    critical.add('product_geometry');
  }
  if (content.contains_logo) {
    applicable.add('logo');
    applicable.add('branding');
    critical.add('logo');
  }
  if (content.contains_text) applicable.add('text');

  if (content.content_type === 'branding_editorial') {
    for (const d of ['hierarchy', 'layout', 'color_consistency', 'branding'] as QualityDimension[]) applicable.add(d);
  }

  const notApplicable = ALL_DIMENSIONS.filter((d) => !applicable.has(d));
  return {
    applicable: ALL_DIMENSIONS.filter((d) => applicable.has(d)),
    notApplicable,
    critical: ALL_DIMENSIONS.filter((d) => critical.has(d)),
    contentType: content.content_type,
  };
}

/**
 * Texto que vai ao crítico. Dizer explicitamente o que NÃO avaliar é o que
 * impede o modelo de inventar nota: sem essa lista ele tenta preencher
 * tudo que o schema oferece.
 */
export function rubricToPrompt(rubric: Rubric): string {
  return [
    `Content type: ${rubric.contentType}.`,
    `APPLICABLE CRITERIA (score 0-10): ${rubric.applicable.join(', ')}.`,
    rubric.notApplicable.length > 0
      ? `NOT APPLICABLE (return null, never a number): ${rubric.notApplicable.join(', ')}.`
      : '',
    rubric.critical.length > 0 ? `CRITICAL (must never degrade): ${rubric.critical.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
