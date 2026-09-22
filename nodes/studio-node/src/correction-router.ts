import { z } from 'zod';

/**
 * ProblemClassifier + CorrectionRouter + MaskGenerator.
 *
 * O ponto da fase 3: a ação de correção é escolhida por TABELA, não pelo
 * LLM. Na fase 2 o "conserto" era regerar a imagem inteira com o mesmo
 * prompt e uma seed nova - um sorteio, que numa execução real piorou a peça
 * (inseriu mãos deformadas onde não havia mão). Sorteio não é correção.
 *
 * Aqui cada tipo de problema tem uma ação fixa e auditável, e o que não
 * estiver mapeado com confiança suficiente **não é corrigido**: preservar a
 * imagem original é sempre uma opção válida, e é o default.
 */

export const PROBLEM_TYPES = [
  'FACE', 'HAND', 'BODY_ANATOMY', 'PRODUCT_GEOMETRY', 'PRODUCT_TEXTURE', 'LOGO', 'TEXT',
  'BACKGROUND', 'LIGHTING', 'COMPOSITION', 'COLOR', 'EDGE', 'ARTIFACT', 'IDENTITY',
  'REFERENCE_FIDELITY', 'OTHER',
] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

export type CorrectionAction =
  | 'LOCAL_INPAINT'
  | 'REFERENCE_GUIDED_EDIT'
  | 'LOCALIZED_REFINEMENT'
  | 'COMPOSITOR'
  | 'GLOBAL_REGENERATE'
  | 'NO_AUTOMATIC_CORRECTION';

export type ProblemScope = 'LOCAL' | 'GLOBAL';

/** Região normalizada 0..1 sobre a imagem. */
export const regionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export type Region = z.infer<typeof regionSchema>;

/**
 * Uma região precisa CABER na imagem e ter área útil. Medido na fase 2 que
 * o modelo erra lateralidade e às vezes devolve caixa degenerada; aceitar
 * isso viraria máscara inválida e inpaint em lugar errado.
 */
export function isValidRegion(r: unknown): r is Region {
  const parsed = regionSchema.safeParse(r);
  if (!parsed.success) return false;
  const { x, y, width, height } = parsed.data;
  if (width <= 0.005 || height <= 0.005) return false;
  return x + width <= 1.0001 && y + height <= 1.0001;
}

export interface ClassifiedProblem {
  type: ProblemType;
  scope: ProblemScope;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  region: Region | null;
  description: string;
}

/**
 * Classificação por TEXTO da descrição, não pelo rótulo que o modelo
 * escolheu. Medido: o crítico rotulou quatro defeitos de mão/pé como
 * `region: "product"` numa imagem sem produto. O enum garante valor válido,
 * não valor correto.
 */
const PADROES: Array<[RegExp, ProblemType]> = [
  [/\b(finger|fingers|hand|hands|knuckle|thumb|palm)\b/i, 'HAND'],
  [/\b(eye|eyes|mouth|nose|ear|earlobe|teeth|facial|face)\b/i, 'FACE'],
  [/\b(identity|resembl|different person|looks like someone)\b/i, 'IDENTITY'],
  [/\b(limb|arm|leg|torso|shoulder|proportion|anatom)\b/i, 'BODY_ANATOMY'],
  [/\b(logo|emblem|badge|wordmark)\b/i, 'LOGO'],
  [/\b(text|sign|signage|lettering|letter|typography|spelling|word)\b/i, 'TEXT'],
  [/\b(shape|geometry|warp|distort|asymmetr|bent|misshapen)\b/i, 'PRODUCT_GEOMETRY'],
  [/\b(material|texture|surface|plastic|smooth|grain|fabric|leather)\b/i, 'PRODUCT_TEXTURE'],
  [/\b(background|backdrop|scenery|foliage)\b/i, 'BACKGROUND'],
  [/\b(light|lighting|shadow|highlight|exposure|reflection)\b/i, 'LIGHTING'],
  [/\b(composition|framing|crop|letterbox|placement|balance)\b/i, 'COMPOSITION'],
  [/\b(colou?r|hue|saturation|tint|temperature)\b/i, 'COLOR'],
  [/\b(edge|halo|outline|jagged|aliasing)\b/i, 'EDGE'],
  [/\b(artifact|noise|smear|glitch|blob)\b/i, 'ARTIFACT'],
];

export function classifyProblem(input: {
  description: string;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  region: unknown;
}): ClassifiedProblem {
  const type = PADROES.find(([re]) => re.test(input.description))?.[1] ?? 'OTHER';
  const region = isValidRegion(input.region) ? input.region : null;
  return {
    type,
    scope: scopeFor(type, region),
    severity: input.severity,
    confidence: input.confidence,
    region,
    description: input.description,
  };
}

/**
 * Sem região válida, um problema local vira global na prática: não há onde
 * aplicar máscara. Composição é global por definição - não existe recortar
 * "a composição".
 */
export function scopeFor(type: ProblemType, region: Region | null): ProblemScope {
  if (type === 'COMPOSITION') return 'GLOBAL';
  if (region === null) return 'GLOBAL';
  // Uma caixa que cobre quase tudo não é defeito local, é a cena inteira.
  return region.width * region.height > 0.6 ? 'GLOBAL' : 'LOCAL';
}

export interface Route {
  action: CorrectionAction;
  workflow: string | null;
  reason: string;
}

/**
 * Confiança mínima para MEXER numa imagem que já está entregável. Abaixo
 * disso o custo de errar (piorar a peça) supera o benefício.
 */
export const MIN_CONFIDENCE_TO_CORRECT = 0.7;

const TABELA: Record<ProblemType, { action: CorrectionAction; workflow: string | null }> = {
  HAND: { action: 'LOCAL_INPAINT', workflow: 'inpaint_flux2_local_v1' },
  FACE: { action: 'LOCAL_INPAINT', workflow: 'inpaint_flux2_local_v1' },
  BODY_ANATOMY: { action: 'LOCAL_INPAINT', workflow: 'inpaint_flux2_local_v1' },
  BACKGROUND: { action: 'LOCAL_INPAINT', workflow: 'inpaint_flux2_local_v1' },
  PRODUCT_GEOMETRY: { action: 'REFERENCE_GUIDED_EDIT', workflow: 'edit_flux2_multireference_v2' },
  REFERENCE_FIDELITY: { action: 'REFERENCE_GUIDED_EDIT', workflow: 'edit_flux2_multireference_v2' },
  PRODUCT_TEXTURE: { action: 'LOCALIZED_REFINEMENT', workflow: 'inpaint_flux2_local_v1' },
  EDGE: { action: 'LOCALIZED_REFINEMENT', workflow: 'inpaint_flux2_local_v1' },
  // Texto e logo NÃO se consertam pedindo ao modelo de imagem que desenhe
  // de novo - é o defeito mais notório do Flux. Vão pro compositor, que já
  // existe (text-overlay.ts / brand-compositor.ts) e usa o ativo real.
  TEXT: { action: 'COMPOSITOR', workflow: null },
  LOGO: { action: 'COMPOSITOR', workflow: null },
  COMPOSITION: { action: 'GLOBAL_REGENERATE', workflow: 't2i_flux2_native_v2' },
  // Sem ferramenta específica hoje: preservar é melhor que improvisar.
  LIGHTING: { action: 'NO_AUTOMATIC_CORRECTION', workflow: null },
  COLOR: { action: 'NO_AUTOMATIC_CORRECTION', workflow: null },
  ARTIFACT: { action: 'NO_AUTOMATIC_CORRECTION', workflow: null },
  IDENTITY: { action: 'NO_AUTOMATIC_CORRECTION', workflow: null },
  OTHER: { action: 'NO_AUTOMATIC_CORRECTION', workflow: null },
};

export function routeCorrection(problem: ClassifiedProblem): Route {
  if (problem.confidence < MIN_CONFIDENCE_TO_CORRECT) {
    return {
      action: 'NO_AUTOMATIC_CORRECTION',
      workflow: null,
      reason: `Confiança ${problem.confidence.toFixed(2)} abaixo do mínimo ${MIN_CONFIDENCE_TO_CORRECT} - preservando o original.`,
    };
  }

  const escolha = TABELA[problem.type];

  // Regeneração global é último recurso (seção 9 do plano): só COMPOSITION
  // a justifica. Qualquer outro tipo sem região válida vira "não corrige",
  // porque regerar a cena inteira por um defeito de canto é o sorteio que
  // já se provou danoso.
  if (escolha.action !== 'GLOBAL_REGENERATE' && problem.scope === 'GLOBAL' && escolha.action !== 'COMPOSITOR') {
    return {
      action: 'NO_AUTOMATIC_CORRECTION',
      workflow: null,
      reason: `${problem.type} sem região local utilizável - regerar a cena inteira por isso não se justifica.`,
    };
  }

  return {
    action: escolha.action,
    workflow: escolha.workflow,
    reason: `${problem.type}/${problem.scope} -> ${escolha.action}.`,
  };
}

/**
 * MaskGenerator: bounding box -> região de máscara, com folga.
 *
 * O padding existe porque inpaint sem contexto ao redor costura mal: a
 * emenda aparece. O teto de área evita que uma caixa grande vire
 * "regenerar quase tudo" disfarçado de correção local.
 */
export const MASK_PADDING = 0.04;
/**
 * Teto de área da máscara.
 *
 * Medido ao vivo (17/09/2026, candidato B sobre attempt_2.png): com o teto
 * em 0.6 a máscara de uma mão saiu com 0,54x0,67 - cobriu as duas mãos E a
 * parte de cima do tênis. O inpaint então ALTEROU O PRODUTO (surgiram
 * cadarços que não existiam), e o pairwise reprovou por regressão de
 * `product_fidelity`. A correção era "local" no nome e global no efeito.
 *
 * 0.25 mantém "local" com significado: a máscara que causou o dano cobria
 * 0,31 da imagem mesmo com o padding menor. Acima de um quarto da cena o
 * que se está fazendo é regerar boa parte dela, e isso tem que passar pelo
 * caminho explícito de GLOBAL_REGENERATE, não se disfarçar de inpaint.
 */
export const MASK_MAX_AREA = 0.25;

export interface MaskSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number;
}

export function buildMask(region: Region, padding = MASK_PADDING): MaskSpec | null {
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const width = Math.min(1 - x, region.width + padding * 2);
  const height = Math.min(1 - y, region.height + padding * 2);
  if (width * height > MASK_MAX_AREA) return null;
  return { x, y, width, height, feather: 0.25 };
}

/** Converte a máscara normalizada em pixels da imagem real, alinhada à grade do Flux. */
export function maskToPixels(mask: MaskSpec, imageWidth: number, imageHeight: number): { x: number; y: number; width: number; height: number } {
  const snap = (v: number) => Math.max(16, Math.round(v / 16) * 16);
  return {
    x: Math.round(mask.x * imageWidth),
    y: Math.round(mask.y * imageHeight),
    width: snap(mask.width * imageWidth),
    height: snap(mask.height * imageHeight),
  };
}

/**
 * Ordem de ataque quando há vários problemas: um de cada vez, o mais grave
 * primeiro. Corrigir dois ao mesmo tempo impede saber qual correção causou
 * qual efeito na comparação.
 */
const PESO_SEVERIDADE = { high: 3, medium: 2, low: 1 } as const;

export function prioritize(problems: ClassifiedProblem[]): ClassifiedProblem[] {
  return [...problems].sort((a, b) => {
    const s = PESO_SEVERIDADE[b.severity] - PESO_SEVERIDADE[a.severity];
    if (s !== 0) return s;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Com tudo igual, o que tem região definida vem antes: é corrigível.
    return Number(b.region !== null) - Number(a.region !== null);
  });
}
