import { z } from 'zod';
import {
  STUDIO_BRAND_PLACEMENTS,
  STUDIO_REFERENCE_FIDELITY,
  STUDIO_REFERENCE_ROLES,
} from '@desigual-os/types';

/**
 * Schemas dos payloads criativos do Otto. Os campos são snake_case porque
 * estes objetos cruzam fronteiras: saem/entram do LLM como JSON (wire) e o
 * productionSpec alimenta a fila studio-jobs. Internamente, quem consome
 * converte pra camelCase se precisar.
 */

// ---------------------------------------------------------------------------
// Direção de arte: o bloco que impede prompt genérico. Cada campo é uma
// decisão que um diretor de arte humano tomaria antes de abrir o Midjourney.
// ---------------------------------------------------------------------------

export const artDirectionSchema = z.object({
  composition: z.string().min(1),
  typography: z.string().min(1),
  color: z.string().min(1),
  lighting: z.string().min(1),
  photography: z.string().min(1),
  materials: z.string().min(1),
  atmosphere: z.string().min(1),
});

export const qualityCriteriaSchema = z.object({
  criterion: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0).max(1).default(1),
});

export const referenceStrategySchema = z.object({
  reference_index: z.number().int().min(1),
  role: z.enum(STUDIO_REFERENCE_ROLES),
  fidelity: z.enum(STUDIO_REFERENCE_FIDELITY).default('high'),
  instruction: z.string().min(1),
  placement: z.enum(STUDIO_BRAND_PLACEMENTS).default('reference_only'),
});

/**
 * Gate de fidelidade real (2026-09): o Otto lê o briefing e decide se ele
 * pede pra representar um produto, máquina, pessoa, marca ou local REAL e
 * específico (não um genérico "um trator", mas "o trator X da marca Y", "a
 * fachada da loja do cliente", "o CEO", um prédio real etc). Achado real:
 * sem referência anexada, o FLUX.2 inventa uma aproximação genérica que
 * PARECE certa mas não é o produto/pessoa/lugar de verdade (um "trator
 * inventado" visualmente bom, mas não o modelo real do cliente).
 */
export const realWorldFidelitySchema = z.object({
  requires_reference: z.boolean().default(false),
  entity_type: z.enum(['product', 'brand', 'person', 'location', 'machine']).optional(),
  entity_description: z.string().optional(),
});

export const creativePlanSchema = z.object({
  client: z.string().min(1),
  project: z.string().optional(),
  objective: z.string().min(1),
  audience: z.string().min(1),
  strategy: z.string().min(1),
  concept: z.string().min(1),
  narrative: z.string().min(1),
  copy: z.string().min(1),
  art_direction: artDirectionSchema,
  references: z.array(z.string()).default([]),
  reference_strategy: z.array(referenceStrategySchema).default([]),
  real_world_fidelity: realWorldFidelitySchema.default({ requires_reference: false }),
  image_prompt: z.string().min(1),
  negative_prompt: z.string().default(''),
  technical_specs: z.string().min(1),
  production_requirements: z.string().min(1),
  quality_criteria: z.array(qualityCriteriaSchema).min(1),
  delivery_format: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Carrossel: funções narrativas alinhadas à estrutura canônica do modus
// operandi (.agents/skills/carrossel-cinema-impossivel): capa abre (hook),
// meio desenvolve, CTA fecha. O planner impõe hook no 1º e cta no último.
// ---------------------------------------------------------------------------

export const carouselNarrativeFunctionSchema = z.enum([
  'hook',
  'context',
  'development',
  'value',
  'cta',
]);

export const carouselSlideSchema = z.object({
  index: z.number().int().min(1),
  narrative_function: carouselNarrativeFunctionSchema,
  objective: z.string().min(1),
  copy: z.string().min(1),
  visual: z.string().min(1),
  composition: z.string().min(1),
  layout: z.string().min(1),
  image_prompt: z.string().min(1),
});

export const carouselPlanSchema = z.object({
  concept: z.string().min(1),
  render_mode: z.enum(['editorial', 'photographic']).default('editorial'),
  // Lei do modus operandi: carrossel é 10 a 16 cards 1080x1350.
  slide_count: z.number().int().min(1).max(16),
  slides: z.array(carouselSlideSchema).min(1),
}).superRefine((plan, ctx) => {
  if (plan.render_mode === 'editorial' && plan.slide_count < 10) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slide_count'], message: 'Carrossel editorial requer 10 a 16 cards.' });
  if (plan.slides.length !== plan.slide_count) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slides'], message: 'O número de slides deve corresponder ao plano.' });
});

// ---------------------------------------------------------------------------
// Vídeo/reels: cena a cena com direção de câmera e ritmo, não um "promptão".
// ---------------------------------------------------------------------------

export const videoSceneSchema = z.object({
  duration_seconds: z.number().min(1).max(5).optional(),
  image_prompt: z.string().min(1).optional(),
  shot_type: z.enum(['portrait', 'wide', 'detail', 'action', 'environment', 'closing']).optional(),
  continuity: z.string().min(1).optional(),
  camera_movement: z.string().min(1),
  subject_movement: z.string().min(1),
  environment: z.string().min(1),
  lighting: z.string().min(1),
  transition: z.string().min(1),
  pacing: z.string().min(1),
});

export const videoPlanSchema = z.object({
  concept: z.string().min(1),
  duration: z.number().positive().max(80),
  aspect_ratio: z.string().min(1),
  scenes: z.array(videoSceneSchema).min(1).max(16),
  sound_direction: z.string().min(1),
  text_overlays: z.array(z.string()).default([]),
  cta: z.string().min(1),
  generation_prompts: z.array(z.string()).min(1),
}).superRefine((plan, ctx) => {
  if (plan.generation_prompts.length !== plan.scenes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['generation_prompts'], message: 'Cada cena precisa de um prompt de movimento.' });
  }
  if (plan.scenes.every((scene) => scene.duration_seconds !== undefined)) {
    const sum = plan.scenes.reduce((total, scene) => total + scene.duration_seconds!, 0);
    if (Math.abs(sum - plan.duration) > 0.05) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['duration'], message: 'A duração deve ser a soma dos takes.' });
  }
});

// ---------------------------------------------------------------------------
// Upscale: spec técnica pro studio-node (método + preservações), alinhada
// ao job type 'upscale' da fila studio-jobs.
// ---------------------------------------------------------------------------

export const upscaleSpecSchema = z.object({
  method: z.string().min(1),
  scale: z.number().positive(),
  target_resolution: z.string().min(1),
  denoise: z.number().min(0).max(1),
  detail_preservation: z.number().min(0).max(1),
  texture_preservation: z.number().min(0).max(1),
  face_preservation: z.number().min(0).max(1),
  edge_preservation: z.number().min(0).max(1),
  sharpening: z.number().min(0).max(1),
  artifact_prevention: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Feedback criativo: unidade de aprendizado do Otto (ver creative/dna.ts e
// learning/pipeline.ts). verdict 'needs_iteration' é o caso mais comum e
// o mais valioso: carrega o motivo que alimenta o DNA do cliente.
// ---------------------------------------------------------------------------

export const creativeFeedbackSchema = z.object({
  verdict: z.enum(['approved', 'rejected', 'needs_iteration']),
  reason: z.string().min(1),
  context: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Production Spec: o contrato entre o Otto e a fila studio-jobs. Os job
// types são exatamente os aceitos pelo StudioJobData/worker do Studio.
// ---------------------------------------------------------------------------

export const studioJobTypeSchema = z.enum(['image', 'carousel', 'video', 'reels', 'upscale']);

export const productionReferenceAssetSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  role: z.enum(STUDIO_REFERENCE_ROLES).optional(),
  fidelity: z.enum(STUDIO_REFERENCE_FIDELITY).optional(),
  instruction: z.string().min(1).optional(),
  placement: z.enum(STUDIO_BRAND_PLACEMENTS).optional(),
});

export const productionSpecSchema = z.object({
  job_type: studioJobTypeSchema,
  client_id: z.string().min(1),
  prompt: z.string().min(1),
  negative_prompt: z.string().default(''),
  /** Só carousel: specs slide a slide, na ordem de geração. */
  slides: z.array(carouselSlideSchema).optional(),
  /** Copy final (legenda/texto de overlay) quando o job carrega texto. */
  copy: z.string().optional(),
  quality: z.string().default('high'),
  aspect_ratio: z.string().default('4:5'),
  references: z.array(z.string()).default([]),
  reference_assets: z.array(productionReferenceAssetSchema).max(10).default([]),
  metadata: z.record(z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Avaliação de qualidade (saída do QC estruturado, creative/quality.ts).
// ---------------------------------------------------------------------------

export const qualityIssueSchema = z.object({
  criterion: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().min(1),
});

export const qualityEvaluationSchema = z.object({
  verdict: z.enum(['approved', 'rejected', 'needs_iteration']),
  scores: z.record(z.number().min(0).max(10)),
  issues: z.array(qualityIssueSchema).default([]),
  reasoning: z.string().min(1),
});

export type ArtDirection = z.infer<typeof artDirectionSchema>;
export type QualityCriteria = z.infer<typeof qualityCriteriaSchema>;
export type ReferenceStrategy = z.infer<typeof referenceStrategySchema>;
export type CreativePlan = z.infer<typeof creativePlanSchema>;
export type CarouselNarrativeFunction = z.infer<typeof carouselNarrativeFunctionSchema>;
export type CarouselSlide = z.infer<typeof carouselSlideSchema>;
export type CarouselPlan = z.infer<typeof carouselPlanSchema>;
export type VideoScene = z.infer<typeof videoSceneSchema>;
export type VideoPlan = z.infer<typeof videoPlanSchema>;
export type UpscaleSpec = z.infer<typeof upscaleSpecSchema>;
export type CreativeFeedback = z.infer<typeof creativeFeedbackSchema>;
export type StudioJobType = z.infer<typeof studioJobTypeSchema>;
export type ProductionSpec = z.infer<typeof productionSpecSchema>;
export type QualityIssue = z.infer<typeof qualityIssueSchema>;
export type QualityEvaluation = z.infer<typeof qualityEvaluationSchema>;
