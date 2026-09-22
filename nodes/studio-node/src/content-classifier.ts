import { z } from 'zod';

/**
 * ContentClassifier — descobre O QUE existe na imagem antes de julgá-la.
 *
 * Existe por causa de um erro medido na fase 2 (job STU-MU4GK4TT4B396E):
 * numa foto de PRODUTO o crítico devolveu `anatomy: 4.0` ao lado de
 * `hands: 10` e `face: 10`. Não havia mão nem rosto na cena; a nota veio do
 * nada, reprovou uma peça boa e disparou uma "correção" que inseriu mãos
 * deformadas numa imagem que não tinha mão.
 *
 * A causa raiz não é o modelo ser ruim: é ele ter sido OBRIGADO a preencher
 * um campo sobre algo inexistente. Um schema que exige `anatomy` sempre
 * força o modelo a inventar um número. A correção é perguntar primeiro o
 * que a imagem contém e só então montar a rubrica (ver rubric.ts).
 *
 * Classifica pela IMAGEM, não pelo prompt: o briefing diz o que foi PEDIDO,
 * a imagem mostra o que o FLUX realmente produziu - e os dois divergem com
 * frequência (foi o prompt de um tênis que trouxe um pé e, depois, duas
 * mãos).
 */

export const CONTENT_TYPES = [
  'product_ad',
  'portrait',
  'person_with_product',
  'branding_editorial',
  'scene',
  'other',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

const contentSchema = z.object({
  content_type: z.enum(CONTENT_TYPES),
  contains_people: z.boolean(),
  contains_face: z.boolean(),
  contains_hands: z.boolean(),
  contains_product: z.boolean(),
  contains_logo: z.boolean(),
  contains_text: z.boolean(),
  contains_environment: z.boolean(),
  contains_vehicle: z.boolean(),
  contains_food: z.boolean(),
  contains_architecture: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type ContentClassification = z.infer<typeof contentSchema> & {
  /** Derivado das flags, não pedido ao modelo: o que não pode degradar nesta peça. */
  critical_regions: string[];
  latencyMs: number;
};

export const CONTENT_FORMAT = {
  type: 'object',
  properties: {
    content_type: { type: 'string', enum: [...CONTENT_TYPES] },
    contains_people: { type: 'boolean' },
    contains_face: { type: 'boolean' },
    contains_hands: { type: 'boolean' },
    contains_product: { type: 'boolean' },
    contains_logo: { type: 'boolean' },
    contains_text: { type: 'boolean' },
    contains_environment: { type: 'boolean' },
    contains_vehicle: { type: 'boolean' },
    contains_food: { type: 'boolean' },
    contains_architecture: { type: 'boolean' },
    confidence: { type: 'number' },
  },
  required: [
    'content_type', 'contains_people', 'contains_face', 'contains_hands', 'contains_product',
    'contains_logo', 'contains_text', 'contains_environment', 'contains_vehicle', 'contains_food',
    'contains_architecture', 'confidence',
  ],
} as const;

export const CONTENT_SYSTEM_PROMPT = [
  'You inventory what is ACTUALLY VISIBLE in an image. You do not judge quality here.',
  'Answer only about what you can see, never about what the image was supposed to contain.',
  'contains_hands: true ONLY if human hands are visible in frame.',
  'contains_face: true ONLY if a human face is visible in frame.',
  'contains_people: true if any part of a human body is visible, including a leg or foot alone.',
  'contains_text: true only for readable lettering rendered inside the image.',
  'Be conservative: when a thing is not clearly there, answer false.',
].join(' ');

/**
 * `critical_regions` sai de regra, não do modelo: é uma consequência
 * mecânica do que existe na cena, e deixar o LLM decidir "o que é crítico"
 * reintroduz exatamente a arbitrariedade que esta fase quer remover.
 */
export function deriveCriticalRegions(c: z.infer<typeof contentSchema>): string[] {
  const regions: string[] = [];
  if (c.contains_face) regions.push('face');
  if (c.contains_hands) regions.push('hands');
  if (c.contains_product) regions.push('product');
  if (c.contains_logo) regions.push('logo');
  if (c.contains_text) regions.push('text');
  return regions;
}

export function parseContentClassification(raw: unknown, latencyMs: number): ContentClassification {
  const parsed = contentSchema.parse(raw);
  return { ...parsed, critical_regions: deriveCriticalRegions(parsed), latencyMs };
}

/**
 * Coerência interna. O modelo às vezes marca `contains_face` sem
 * `contains_people`, o que é impossível: um rosto implica uma pessoa. Sem
 * este ajuste a rubrica montaria critérios de identidade sem incluir
 * anatomia, e o inverso.
 */
export function reconcile(c: ContentClassification): ContentClassification {
  const contains_people = c.contains_people || c.contains_face || c.contains_hands;
  return { ...c, contains_people, critical_regions: deriveCriticalRegions({ ...c, contains_people }) };
}
