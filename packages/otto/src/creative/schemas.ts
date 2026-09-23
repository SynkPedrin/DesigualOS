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

/**
 * Lista de referências que TOLERA o modelo respondendo string em vez de
 * array quando não há referência nenhuma. Medido ao vivo em 22/09/2026 (Otto
 * Elite Phase 2, baseline reels Jardim Europa V): qwen3.5:4b mandou
 * `"references": "nenhuma"` (ou similar) em vez de `[]`, e como chatJson só
 * corrige uma vez, isso derrubou o turno inteiro por um campo que, sem
 * referência real anexada, é só uma lista vazia.
 */
const referencesField = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (value === null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || /^(nenhuma?|none|n\/a|sem referências?)$/i.test(trimmed)) return [];
    return [trimmed];
  }
  return value;
}, z.array(z.string()).default([]));

// ---------------------------------------------------------------------------
// SCHEMA RESILIENCE TOOLKIT (Otto Senior 20Y, Missão 1-3, 19).
//
// Achados ao vivo, mesma causa raiz repetida em formatos diferentes:
// qwen3.5:4b, ao decidir que um campo OPCIONAL não se aplica, não omite a
// chave — manda "" (string vazia), `null` (JSON explícito), ou um número
// fora do range esperado. z.optional() só aceita `undefined` como "ausente"
// — `""` e `null` contam como PRESENTE E INVÁLIDO — e como chatJson só
// corrige uma vez (ollama-provider.ts), um campo que existe pra ser
// opcional derrubava o turno inteiro (achados reais: spoken_line/
// on_screen_text "" — 252s perdidos; duration_seconds fora de [1,5] — 293s
// perdidos; real_world_fidelity.entity_type: null — mais uma rodada
// perdida). Corrigir "" e não `null` é resolver a instância, não a classe
// (Missão 19) — `isBlank()` cobre as DUAS representações de "nada" de uma
// vez.
//
// Classificação (Missão 1): isto só vale pra campos TYPE B (opcionais, onde
// omissão é semanticamente equivalente a vazio/null). NUNCA aplicar este
// padrão a TYPE C (conteúdo semântico obrigatório: roteiro, headline,
// conceito) nem deixar um valor NÃO VAZIO E INVÁLIDO ("banana" num enum de
// 5 opções) escapar da validação normal — esse caso continua caindo no
// caminho de correção existente do chatJson, porque é um erro de verdade,
// não ruído de representação.
// ---------------------------------------------------------------------------

/** "" (string vazia/só espaço) ou `null` — as duas formas que um campo opcional "sem valor" toma quando o modelo não omite a chave. */
function isBlank(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.trim().length === 0);
}

/**
 * String opcional que TOLERA "" ou `null` como "ausente".
 */
const optionalString = () =>
  z.preprocess((value) => (isBlank(value) ? undefined : value), z.string().min(1).optional());

/**
 * Enum opcional (ou com default) que TOLERA "" ou `null` como "ausente" —
 * vira undefined ANTES da validação, então cai no .optional()/.default() em
 * vez de estourar "invalid_enum_value"/"invalid_type". Um valor não-vazio
 * que não bate com NENHUMA opção continua inválido: não é convertido pra
 * undefined (isso esconderia um erro semântico real do modelo), só passa
 * reto pro enum rejeitar normalmente e acionar a correção existente do
 * chatJson.
 */
const normalizedEnum = <T extends readonly [string, ...string[]]>(values: T, opts: { default?: T[number] } = {}) => {
  const base = opts.default !== undefined ? z.enum(values).default(opts.default) : z.enum(values).optional();
  return z.preprocess((value) => (isBlank(value) ? undefined : value), base);
};

/**
 * Número opcional CLAMPADO em vez de rejeitado quando fora de [min,max];
 * `null`/vazio TOLERADO como "ausente" (mesma classe dos dois helpers acima).
 *
 * Regra 25-26 (Otto Senior V1.0): ruído representacional inofensivo (um
 * valor de TIMING/medida interno fora do range, não um fato de
 * cliente/data/oferta) é normalizado, não descartado — um FINITO fora do
 * range é clampado pro limite mais próximo. Um valor NÃO numérico (string
 * não-vazia, NaN) continua caindo no erro de schema normal — não é ruído de
 * representação, é o campo errado de verdade.
 */
const clampedNumber = (min: number, max: number) =>
  z.preprocess((value) => {
    if (isBlank(value)) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.min(max, Math.max(min, value));
    }
    return value;
  }, z.number().min(min).max(max).optional());

/**
 * Array de string que TOLERA o modelo mandando UMA STRING SOLTA em vez de
 * array de um item — Otto Elite, Blocker 3 (achado ao vivo:
 * `text_overlays` recebeu string, não array; mesma classe de
 * `referencesField`, generalizada aqui pra qualquer campo textual em
 * lista). "abc" -> ["abc"] é semanticamente sem perda: o modelo tinha UM
 * item e não empacotou. Array já correto passa direto. `null`/"" viram
 * lista vazia (perde sentido só quando o array em si é opcional — por isso
 * quem precisa de min(1) real, como generation_prompts, aplica o preprocess
 * mas mantém o próprio .min(1) na base, que barra lista vazia normalmente).
 * Objeto, número ou qualquer outro tipo NÃO é normalizado — cai no erro de
 * schema normal, porque não é ruído de representação, é conteúdo errado.
 */
const stringOrArray = <T extends z.ZodArray<z.ZodString>>(base: T) =>
  z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (value === null) return [];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length === 0 ? [] : [trimmed];
    }
    return value;
  }, base);

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
  fidelity: normalizedEnum(STUDIO_REFERENCE_FIDELITY, { default: 'high' }),
  instruction: z.string().min(1),
  placement: normalizedEnum(STUDIO_BRAND_PLACEMENTS, { default: 'reference_only' }),
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
  entity_type: normalizedEnum(['product', 'brand', 'person', 'location', 'machine']),
  entity_description: optionalString(),
});

export const creativePlanSchema = z.object({
  client: z.string().min(1),
  project: optionalString(),
  objective: z.string().min(1),
  audience: z.string().min(1),
  strategy: z.string().min(1),
  concept: z.string().min(1),
  narrative: z.string().min(1),
  copy: z.string().min(1),
  art_direction: artDirectionSchema,
  references: referencesField,
  reference_strategy: z.array(referenceStrategySchema).default([]),
  real_world_fidelity: realWorldFidelitySchema.default({ requires_reference: false }),
  image_prompt: z.string().min(1),
  negative_prompt: z.string().default(''),
  technical_specs: z.string().min(1),
  production_requirements: z.string().min(1),
  quality_criteria: z.array(qualityCriteriaSchema).min(1),
  /**
   * TYPE A (Missão 2): `delivery_format` é derivável de jobType + aspect
   * ratio, que o CÓDIGO já sabe no momento de montar a produção
   * (buildProductionSpec recebe jobType/aspectRatio como parâmetros). Pedir
   * pro modelo ser a fonte de verdade de um campo de ROTEAMENTO do sistema
   * — especialmente durante uma reescrita longa, com o contrato do critic
   * anexado ao prompt — é pedir pra ele lembrar de um dado que ele não
   * deveria precisar carregar. Achado ao vivo (validação Cosentino,
   * REWRITE #1): o campo sumiu inteiro do JSON de reescrita e derrubou o
   * turno inteiro. Agora é opcional aqui; buildProductionSpec (planner.ts)
   * deriva um valor determinístico quando ausente.
   */
  delivery_format: optionalString(),
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
  render_mode: normalizedEnum(['editorial', 'photographic'], { default: 'editorial' }),
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
  duration_seconds: clampedNumber(1, 5),
  image_prompt: optionalString(),
  shot_type: normalizedEnum(['portrait', 'wide', 'detail', 'action', 'environment', 'closing']),
  continuity: optionalString(),
  camera_movement: z.string().min(1),
  subject_movement: z.string().min(1),
  environment: z.string().min(1),
  lighting: z.string().min(1),
  transition: z.string().min(1),
  pacing: z.string().min(1),
  /**
   * FALA/NARRAÇÃO desta cena, palavra por palavra, na ordem de gravação.
   * Opcional porque nem todo vídeo é falado (b-roll puro de produto não
   * tem). Mas quando o briefing pede um roteiro informativo — alguém
   * explicando um anúncio, uma data, um processo — é ISTO que falta sem
   * este campo: o plano tinha direção de câmera e luz, e nenhuma linha do
   * que a pessoa diz. Sem ele, "roteiro de Reels" produzia storyboard de
   * geração de imagem, não um roteiro que alguém consegue gravar lendo.
   */
  spoken_line: optionalString(),
  /** Texto que aparece NA TELA nesta cena (legenda embutida, não a legenda do post). */
  on_screen_text: optionalString(),
});

export const videoPlanSchema = z.object({
  concept: z.string().min(1),
  duration: z.number().positive().max(80),
  aspect_ratio: z.string().min(1),
  scenes: z.array(videoSceneSchema).min(1).max(16),
  sound_direction: z.string().min(1),
  text_overlays: stringOrArray(z.array(z.string())).default([]),
  cta: z.string().min(1),
  generation_prompts: stringOrArray(z.array(z.string()).min(1)),
}).superRefine((plan, ctx) => {
  if (plan.generation_prompts.length !== plan.scenes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['generation_prompts'], message: 'Cada cena precisa de um prompt de movimento.' });
  }
}).transform((plan) => {
  /**
   * `duration` era EXIGIDA bater com a soma dos takes, e rejeitada se não
   * batesse. Medido ao vivo em 22/09/2026 contra qwen3.5:4b (Otto Elite
   * Phase 2): o modelo consistentemente erra essa soma por 1-2 segundos
   * mesmo com os takes corretos - é aritmética redundante que o modelo já
   * expôs no dado primário (duration_seconds por cena), e cobrar consistência
   * exata dela é cobrar do modelo o que o código já pode calcular sozinho.
   * Com chatJson tendo só UMA correção antes de desistir, isso derrubava o
   * turno inteiro por um campo derivado. Agora `duration` é DERIVADA da soma
   * das cenas quando todas a declaram, em vez de validada contra o número que
   * o modelo chutou.
   */
  const todasComDuracao = plan.scenes.every((scene) => scene.duration_seconds !== undefined);
  if (!todasComDuracao) return plan;
  const soma = plan.scenes.reduce((total, scene) => total + scene.duration_seconds!, 0);
  return { ...plan, duration: soma };
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

// ---------------------------------------------------------------------------
// Critic estruturado (Otto Elite Phase 2, Fase 2) — avalia o ENTREGÁVEL
// RENDERIZADO (o texto que o humano vai ler), não o asset de imagem
// (isso já existe em qualityEvaluationSchema/evaluateCreative). Dimensões
// são chaves FIXAS, não um record livre: um record livre deixa o modelo
// inventar, renomear ou omitir dimensão, e o gate (Fase 13) precisa de
// todas as dez presentes pra decidir.
// ---------------------------------------------------------------------------

export const criticScoresSchema = z.object({
  strategy: z.number().min(0).max(10),
  concept: z.number().min(0).max(10),
  hook: z.number().min(0).max(10),
  specificity: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
  brand_fit: z.number().min(0).max(10),
  copy: z.number().min(0).max(10),
  retention: z.number().min(0).max(10),
  platform_fit: z.number().min(0).max(10),
  executability: z.number().min(0).max(10),
});

export const criticFlagsSchema = z.object({
  missing_deliverables: stringOrArray(z.array(z.string())).default([]),
  genericity: z.boolean().default(false),
  unsupported_claims: stringOrArray(z.array(z.string())).default([]),
  weak_hook: z.boolean().default(false),
  weak_concept: z.boolean().default(false),
  bad_cta: z.boolean().default(false),
  bad_platform_fit: z.boolean().default(false),
  ai_slop: z.boolean().default(false),
  over_explanation: z.boolean().default(false),
  missing_production_direction: z.boolean().default(false),
  brand_mismatch: z.boolean().default(false),
});

/**
 * Classificação de causa raiz (Otto Elite — Missão 15): QUANDO o critic
 * reprova, ele precisa dizer EM QUE CAMADA está o problema, não só quais
 * scores caíram. Isto é o que decide o ESCOPO da reescrita (Missão 16): uma
 * falha em STRATEGY/ANGLE/BIG_IDEA/HOOK exige regenerar a camada
 * estratégica inteira (ângulo, big idea, hook) antes de redigir de novo;
 * uma falha em COPY/STRUCTURE/BRAND_FIT/EXECUTABILITY/FACTUAL/DELIVERABLE
 * só exige reescrever o texto — polir frase quando o problema é a ideia
 * é a "reescrita de sinônimo" que a missão proíbe explicitamente.
 */
export const criticRootCauseSchema = z.enum([
  'STRATEGY',
  'ANGLE',
  'BIG_IDEA',
  'HOOK',
  'STRUCTURE',
  'COPY',
  'BRAND_FIT',
  'EXECUTABILITY',
  'FACTUAL',
  'DELIVERABLE',
  'NONE',
]);

/**
 * `overall` NÃO vem do modelo. Lição do bug de `duration` (mesma sessão,
 * commit 375f7ba): pedir pro modelo somar/derivar um número a partir de
 * outros campos que ele mesmo gerou é pedir aritmética que ele erra de
 * forma consistente. O overall é a MÉDIA dos dez scores, calculada em
 * código depois do parse (ver `deriveCriticOverall` em critic.ts) — o
 * schema só aceita o que o LLM sabe fazer bem: julgar cada dimensão
 * isoladamente.
 */
export const criticEvaluationSchema = z.object({
  scores: criticScoresSchema,
  flags: criticFlagsSchema,
  reasoning: z.string().min(1),
  /** 'NONE' quando a peça passa; caso contrário, a camada mais crítica que falhou. */
  root_cause: criticRootCauseSchema.default('NONE'),
});

// ---------------------------------------------------------------------------
// CAMADA ESTRATÉGICA (Otto Elite — pipeline de pensamento antes do draft).
// Duas chamadas estruturadas, não cinco: divergência de ângulos + scoring
// numa só, big idea + hooks numa segunda. "Algumas etapas podem ocorrer numa
// única inferência estruturada" — cada chamada de LLM nesta máquina já mede
// minutos (ver OTTO_ELITE_HANDOFF.md); um estágio por chamada seria 5-6
// chamadas só pra pensar, antes de qualquer rascunho existir.
// ---------------------------------------------------------------------------

export const angleScoresSchema = z.object({
  objective_fit: z.number().min(0).max(10),
  audience_fit: z.number().min(0).max(10),
  brand_fit: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
  hook_potential: z.number().min(0).max(10),
  visual_potential: z.number().min(0).max(10),
  executability: z.number().min(0).max(10),
  factual_safety: z.number().min(0).max(10),
});

export const creativeAngleSchema = z.object({
  name: z.string().min(1),
  one_sentence_idea: z.string().min(1),
  hook_direction: z.string().min(1),
  emotional_mechanism: z.string().min(1),
  why_it_fits_audience: z.string().min(1),
  why_it_fits_brand: z.string().min(1),
  visual_potential: z.string().min(1),
  execution_risk: z.string().min(1),
  scores: angleScoresSchema,
});

export const creativeStrategySchema = z.object({
  audience_insight: z.string().min(1),
  tension: z.string().min(1),
  opportunity: z.string().min(1),
  promise_or_message: z.string().min(1),
  communication_job: z.string().min(1),
  emotional_direction: z.string().min(1),
  desired_reaction: z.string().min(1),
  reason_to_watch: z.string().min(1),
  reason_to_believe: z.string().min(1),
  /** 4-6 ângulos GENUINAMENTE diferentes — não sinônimos da mesma frase. */
  angles: z.array(creativeAngleSchema).min(4).max(6),
});

export const hookScoresSchema = z.object({
  stop_power: z.number().min(0).max(10),
  specificity: z.number().min(0).max(10),
  curiosity: z.number().min(0).max(10),
  clarity: z.number().min(0).max(10),
  believability: z.number().min(0).max(10),
  brand_fit: z.number().min(0).max(10),
  continuation_power: z.number().min(0).max(10),
});

export const hookCandidateSchema = z.object({
  text: z.string().min(1),
  scores: hookScoresSchema,
});

export const bigIdeaAndHooksSchema = z.object({
  big_idea: z.string().min(1),
  /** 5-8 hooks candidatos; escolha final é feita em código (ver critic.ts). */
  hooks: z.array(hookCandidateSchema).min(5).max(8),
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
export type CriticScores = z.infer<typeof criticScoresSchema>;
export type CriticFlags = z.infer<typeof criticFlagsSchema>;
export type CriticRootCause = z.infer<typeof criticRootCauseSchema>;
export type CriticEvaluation = z.infer<typeof criticEvaluationSchema>;
export type AngleScores = z.infer<typeof angleScoresSchema>;
export type CreativeAngle = z.infer<typeof creativeAngleSchema>;
export type CreativeStrategy = z.infer<typeof creativeStrategySchema>;
export type HookScores = z.infer<typeof hookScoresSchema>;
export type HookCandidate = z.infer<typeof hookCandidateSchema>;
export type BigIdeaAndHooks = z.infer<typeof bigIdeaAndHooksSchema>;
