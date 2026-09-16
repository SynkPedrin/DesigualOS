import { z } from 'zod';
import { runVisualQA, VisualQAUnavailableError } from './visual-qa';

/**
 * Visual Critic — a crítica estruturada de uma imagem JÁ gerada.
 *
 * Difere de `visual-qa.ts` (que continua existindo e é usado como provedor
 * `anthropic` aqui dentro) em três pontos que vieram de MEDIÇÃO, não de
 * preferência arquitetural:
 *
 * 1. O crítico roda em COMPUTE SEPARADO da geração. Medido na GPU real em
 *    16/09/2026 (RTX 4090, 24GB, ComfyUI 0.33.4):
 *
 *      FLUX.2 residente, GPU limpa ............ geração  36,4s
 *      FLUX.2 frio ............................ geração 389,3s
 *      qwen3.6:35b-a3b co-residente ........... geração 110,1s  (3x)
 *                                               crítica  40,4s  (vs 4,5s limpa)
 *
 *    Com o FLUX.2 residente sobram ~6,4GB dos 24GB; o 35B quer 20,7GB. Não
 *    cabem juntos, e forçar o par degrada a geração em 3x. Por isso
 *    `CRITIC_OLLAMA_URL` aponta, por padrão, pra OUTRA máquina — não pro
 *    Ollama da caixa da GPU. Apontar pro host da GPU é possível, mas é uma
 *    escolha consciente de trocar latência de geração por qualidade de
 *    crítica, não o default.
 *
 * 2. O veredito do modelo NÃO decide nada. Medido: `qwen3.6:35b-a3b` e
 *    `qwen3.5:9b` devolveram scores IDÊNTICOS pra mesma imagem e mesmo
 *    assim discordaram no `requires_regeneration` (true vs false). Quem
 *    decide é `decision-engine.ts`, sobre os números. Os campos de
 *    recomendação do modelo ficam registrados como sinal auxiliar, nunca
 *    como gate.
 *
 * 3. `text_integrity` é medido mas NÃO é confiável. Medido: nenhum dos três
 *    modelos locais (3B, 9B, 35B) percebeu que a placa "Residencial
 *    HABIANA" de um asset real estava truncada/deformada; o 9B chegou a
 *    afirmar que estava "perfectly legible and correctly spelled". Texto de
 *    verdade continua sendo responsabilidade do compositing
 *    (`text-overlay.ts`), não do modelo de imagem nem do crítico.
 */

/** Dimensões 0-10. Nomes estáveis: viram coluna de métrica e entram no gate. */
const criticScoresSchema = z.object({
  overall_score: z.number().min(0).max(10),
  prompt_alignment: z.number().min(0).max(10),
  composition: z.number().min(0).max(10),
  lighting: z.number().min(0).max(10),
  realism: z.number().min(0).max(10),
  anatomy: z.number().min(0).max(10),
  hands: z.number().min(0).max(10),
  face: z.number().min(0).max(10),
  text_integrity: z.number().min(0).max(10),
  artifact_score: z.number().min(0).max(10),
  commercial_quality: z.number().min(0).max(10),
});

export const CRITIC_REGIONS = ['face', 'hands', 'body', 'product', 'text', 'background', 'composition', 'lighting', 'global'] as const;
export type CriticRegion = (typeof CRITIC_REGIONS)[number];

const criticProblemSchema = z.object({
  region: z.enum(CRITIC_REGIONS),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().min(1),
});

export type CriticProblem = z.infer<typeof criticProblemSchema>;

const criticResultSchema = criticScoresSchema.extend({
  problems: z.array(criticProblemSchema),
  /** Sinal auxiliar do modelo. Registrado, NUNCA usado como gate (ver cabeçalho, ponto 2). */
  requires_regeneration: z.boolean(),
  requires_local_edit: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type CriticResult = z.infer<typeof criticResultSchema> & {
  /** Qual provedor produziu este resultado - vai pro metadata do asset. */
  provider: CriticProvider;
  model: string;
  latencyMs: number;
};

export type CriticProvider = 'ollama' | 'anthropic';

export class CriticUnavailableError extends Error {
  constructor(reason: string) {
    super(`Visual Critic indisponível: ${reason}`);
    this.name = 'CriticUnavailableError';
  }
}

/**
 * JSON Schema entregue ao Ollama via `format`. Medido: com este schema o
 * `qwen3.6:35b-a3b` e o `qwen3.5:9b` devolveram JSON válido em 100% das
 * chamadas desta sessão (8/8), sem nenhum parse manual de texto.
 */
const OLLAMA_FORMAT = {
  type: 'object',
  properties: {
    overall_score: { type: 'number' },
    prompt_alignment: { type: 'number' },
    composition: { type: 'number' },
    lighting: { type: 'number' },
    realism: { type: 'number' },
    anatomy: { type: 'number' },
    hands: { type: 'number' },
    face: { type: 'number' },
    text_integrity: { type: 'number' },
    artifact_score: { type: 'number' },
    commercial_quality: { type: 'number' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string', enum: [...CRITIC_REGIONS] },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          description: { type: 'string' },
        },
        required: ['region', 'severity', 'description'],
      },
    },
    requires_regeneration: { type: 'boolean' },
    requires_local_edit: { type: 'boolean' },
    confidence: { type: 'number' },
  },
  required: [
    'overall_score', 'prompt_alignment', 'composition', 'lighting', 'realism', 'anatomy',
    'hands', 'face', 'text_integrity', 'artifact_score', 'commercial_quality',
    'problems', 'requires_regeneration', 'requires_local_edit', 'confidence',
  ],
} as const;

/**
 * "The image IS AI-generated" é literal e necessário: medido que o
 * `ministral-3:3b` respondeu "since this is an actual photograph (not
 * AI-generated), there are no AI-specific defects" e se recusou a criticar.
 * "typical Flux output scores 6-8" calibra a escala: sem essa âncora os
 * modelos concentram tudo em 8-9 e o gate deixa de discriminar.
 */
const CRITIC_SYSTEM_PROMPT = [
  'You are a rigorous visual QA critic for AI-generated (Flux) commercial advertising imagery.',
  'The image IS AI-generated - never claim it is a real photograph.',
  'Score each dimension 0-10 where 10 is flawless commercial-grade.',
  'Be harsh: typical Flux output scores 6-8, not 9-10.',
  'List only CONCRETE, LOCALIZED defects you can actually see. Empty list if genuinely none.',
  'Use region "hands" for finger/hand defects and "face" for facial defects,',
  'even when the hand or face belongs to someone holding a product.',
].join(' ');

export interface CriticInput {
  imageBytes: Buffer;
  mediaType: 'image/png' | 'image/jpeg';
  /** O briefing ORIGINAL do usuário, não o prompt compilado: é contra a intenção que se mede aderência. */
  briefing: string;
  identityCritical?: boolean;
  productCritical?: boolean;
}

export interface CriticConfig {
  provider: CriticProvider;
  /** Base URL do Ollama do CRÍTICO (outra máquina - ver cabeçalho, ponto 1). */
  ollamaUrl: string;
  ollamaModel: string;
  timeoutMs: number;
}

/**
 * Normaliza o `region` devolvido pelo modelo. Medido: o
 * `qwen3.6:35b-a3b` classificou defeito de mão como `region: "product"`
 * (quatro problemas seguidos, todos de mão/pé, todos rotulados "product")
 * numa imagem que tinha produto nenhum. O enum garante que o valor é
 * VÁLIDO, não que é CORRETO - então o texto da descrição desempata antes
 * de qualquer roteamento de correção depender do rótulo.
 */
export function normalizeProblemRegion(problem: CriticProblem): CriticProblem {
  const text = problem.description.toLowerCase();
  const byText: Array<[RegExp, CriticRegion]> = [
    [/\b(finger|fingers|hand|hands|knuckle|thumb|palm)\b/, 'hands'],
    [/\b(face|facial|eye|eyes|mouth|nose|ear|earlobe|teeth)\b/, 'face'],
    [/\b(text|sign|signage|lettering|letter|typography|spelling|word)\b/, 'text'],
  ];
  for (const [pattern, region] of byText) {
    if (pattern.test(text)) return { ...problem, region };
  }
  return problem;
}

async function critiqueViaOllama(input: CriticInput, config: CriticConfig): Promise<CriticResult> {
  const criticalNote = [
    input.identityCritical && 'the identity of the person is CRITICAL',
    input.productCritical && 'the integrity of the product is CRITICAL',
  ]
    .filter(Boolean)
    .join('; ');

  const body = {
    model: config.ollamaModel,
    system: CRITIC_SYSTEM_PROMPT,
    prompt: `Original briefing: "${input.briefing}"${criticalNote ? `\nConstraints: ${criticalNote}.` : ''}\nEvaluate the attached generated image against it.`,
    images: [input.imageBytes.toString('base64')],
    stream: false,
    // Medido: com think=true o modelo gasta todo o orçamento de tokens no
    // canal de raciocínio e devolve `response` VAZIO (14,6s desperdiçados,
    // zero saída). Desligar não é otimização, é requisito de correção.
    think: false,
    format: OLLAMA_FORMAT,
    // temperature 0: medido determinístico (mesmos scores em repetições
    // consecutivas, 3 pares testados). Um gate por threshold sobre score
    // instável seria ruído.
    options: { temperature: 0, num_predict: 900 },
  };

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new CriticUnavailableError(`não alcancei o Ollama do crítico em ${config.ollamaUrl}: ${String(error)}`);
  }
  if (!response.ok) {
    throw new CriticUnavailableError(`Ollama do crítico respondeu ${response.status} (${config.ollamaModel})`);
  }

  const payload = (await response.json()) as { response?: string };
  if (!payload.response) {
    throw new CriticUnavailableError(`Ollama devolveu resposta vazia (modelo ${config.ollamaModel} em modo thinking?)`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.response);
  } catch (error) {
    throw new CriticUnavailableError(`resposta do crítico não é JSON válido: ${String(error)}`);
  }

  const result = criticResultSchema.parse(parsed);
  return {
    ...result,
    problems: result.problems.map(normalizeProblemRegion),
    provider: 'ollama',
    model: config.ollamaModel,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Adapta o `visual-qa.ts` existente (Claude, escala 0-1) para o contrato do
 * crítico (escala 0-10). Não reimplementa: o módulo antigo continua sendo a
 * única implementação do caminho Anthropic.
 */
async function critiqueViaAnthropic(input: CriticInput): Promise<CriticResult> {
  const startedAt = Date.now();
  let qa: Awaited<ReturnType<typeof runVisualQA>>;
  try {
    qa = await runVisualQA({
      imageBytes: input.imageBytes,
      mediaType: input.mediaType,
      briefing: input.briefing,
      ...(input.identityCritical !== undefined ? { identityCritical: input.identityCritical } : {}),
      ...(input.productCritical !== undefined ? { productCritical: input.productCritical } : {}),
    });
  } catch (error) {
    if (error instanceof VisualQAUnavailableError) throw new CriticUnavailableError(error.message);
    throw error;
  }

  const to10 = (value: number): number => Math.round(value * 100) / 10;
  // O visual-qa não separa hands/face de subjectIntegrity; herdam o valor do
  // sujeito pra não inventar precisão que a fonte não tem.
  const subject = to10(qa.subjectIntegrity);
  return {
    overall_score: to10(qa.score),
    prompt_alignment: to10(qa.briefingAdherence),
    composition: to10(qa.composition),
    lighting: to10(qa.lighting),
    realism: to10(qa.score),
    anatomy: subject,
    hands: subject,
    face: subject,
    text_integrity: 10,
    artifact_score: to10(qa.artifactScore),
    commercial_quality: to10(qa.score),
    problems: qa.issues.map((issue) =>
      normalizeProblemRegion({ region: 'global', severity: 'medium', description: issue }),
    ),
    requires_regeneration: qa.recommendation === 'regenerate',
    requires_local_edit: qa.recommendation === 'refine',
    confidence: 0.8,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    latencyMs: Date.now() - startedAt,
  };
}

export async function critiqueImage(input: CriticInput, config: CriticConfig): Promise<CriticResult> {
  return config.provider === 'anthropic' ? critiqueViaAnthropic(input) : critiqueViaOllama(input, config);
}

/**
 * FINAL QA — o upscale também estraga imagem.
 *
 * Um upscale generativo/por modelo pode alucinar textura de pele, mudar
 * traço de rosto, deformar logo e produzir oversharpen com halo. Por isso o
 * passo depois do upscale NÃO é "aprovou, entrega": é uma comparação
 * explícita ANTES x DEPOIS, e o resultado pode REPROVAR o upscale e mandar
 * entregar a imagem original.
 *
 * As duas imagens vão na mesma chamada (o Ollama aceita `images` com mais
 * de uma), na ordem ANTES, DEPOIS, e o prompt diz qual é qual — sem isso o
 * modelo compara duas imagens sem saber qual deveria ser a melhorada.
 */
const upscaleQASchema = z.object({
  identity_preserved: z.number().min(0).max(10),
  texture_natural: z.number().min(0).max(10),
  logo_product_intact: z.number().min(0).max(10),
  oversharpen_free: z.number().min(0).max(10),
  detail_gain: z.number().min(0).max(10),
  degradations: z.array(z.string()),
});

export type UpscaleQAResult = z.infer<typeof upscaleQASchema> & {
  /** Regra determinística (não é o veredito do modelo): manter o upscale ou devolver o original. */
  keepUpscaled: boolean;
  model: string;
  latencyMs: number;
};

const UPSCALE_QA_FORMAT = {
  type: 'object',
  properties: {
    identity_preserved: { type: 'number' },
    texture_natural: { type: 'number' },
    logo_product_intact: { type: 'number' },
    oversharpen_free: { type: 'number' },
    detail_gain: { type: 'number' },
    degradations: { type: 'array', items: { type: 'string' } },
  },
  required: ['identity_preserved', 'texture_natural', 'logo_product_intact', 'oversharpen_free', 'detail_gain', 'degradations'],
} as const;

const UPSCALE_QA_SYSTEM = [
  'You compare two versions of the SAME AI-generated commercial image: the FIRST is BEFORE upscaling, the SECOND is AFTER upscaling.',
  'Judge ONLY whether the upscale damaged the image. Score 0-10 where 10 means no damage at all.',
  'identity_preserved: does the person still look like the same person?',
  'texture_natural: did the upscaler hallucinate fake skin/fabric texture?',
  'logo_product_intact: did logos, text or product geometry get distorted?',
  'oversharpen_free: 10 = no halos or crunchy edges, 0 = heavy oversharpening.',
  'detail_gain: how much REAL detail the upscale added (0 = none, 10 = large genuine gain).',
  'List concrete degradations you can see, or an empty list.',
].join(' ');

/**
 * Limiares do final QA. Deliberadamente severos nas dimensões de DANO:
 * um upscale que ganha nitidez mas troca o rosto da pessoa é pior que não
 * ter feito upscale nenhum. `detail_gain` NÃO reprova (ganho pequeno só
 * significa que o upscale foi inócuo, não que estragou).
 */
const UPSCALE_QA_MIN = { identity: 7, texture: 6, logo: 7, oversharpen: 6 } as const;

export async function critiqueUpscale(
  input: { before: Buffer; after: Buffer; briefing: string },
  config: CriticConfig,
): Promise<UpscaleQAResult> {
  const startedAt = Date.now();
  const body = {
    model: config.ollamaModel,
    system: UPSCALE_QA_SYSTEM,
    prompt: `Original briefing: "${input.briefing}"\nFirst image = BEFORE upscale. Second image = AFTER upscale. Did the upscale damage it?`,
    images: [input.before.toString('base64'), input.after.toString('base64')],
    stream: false,
    think: false,
    format: UPSCALE_QA_FORMAT,
    options: { temperature: 0, num_predict: 700 },
  };

  let response: Response;
  try {
    response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new CriticUnavailableError(`final QA do upscale não alcançou ${config.ollamaUrl}: ${String(error)}`);
  }
  if (!response.ok) throw new CriticUnavailableError(`final QA do upscale: Ollama respondeu ${response.status}`);

  const payload = (await response.json()) as { response?: string };
  if (!payload.response) throw new CriticUnavailableError('final QA do upscale devolveu resposta vazia');

  const parsed = upscaleQASchema.parse(JSON.parse(payload.response));
  return {
    ...parsed,
    keepUpscaled: decideKeepUpscaled(parsed),
    model: config.ollamaModel,
    latencyMs: Date.now() - startedAt,
  };
}

/** Regra pura, testável sem rede: o upscale só fica se não danificou nada. */
export function decideKeepUpscaled(qa: z.infer<typeof upscaleQASchema>): boolean {
  return (
    qa.identity_preserved >= UPSCALE_QA_MIN.identity &&
    qa.texture_natural >= UPSCALE_QA_MIN.texture &&
    qa.logo_product_intact >= UPSCALE_QA_MIN.logo &&
    qa.oversharpen_free >= UPSCALE_QA_MIN.oversharpen
  );
}
