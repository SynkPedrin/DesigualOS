/**
 * Perfis de qualidade centralizados: draft / standard / master.
 *
 * Regra do plano de evolução do Studio: parâmetros de geração NUNCA ficam
 * espalhados/hardcoded em múltiplos pontos do código. Este arquivo é a
 * ÚNICA fonte desses números. Se alguém for ajustar step count, denoise ou
 * resolução de um profile, é aqui - e o job grava qual profile foi usado
 * (ver index.ts / studio_jobs.metadata), nunca só os parâmetros técnicos
 * soltos, pra dar pra rastrear depois qual profile gerou o quê.
 *
 * MEDIÇÕES REAIS na GPU de produção (RTX 4090, ComfyUI 0.33.4, SEM nenhuma
 * flag de otimização), step a step via WebSocket do ComfyUI:
 *
 *   896x1120  (1.0 MP,  24 steps) -> 87s;  1º step 29,6s, demais 1,92s CONSTANTE (23x sem variar)
 *   1088x1360 (1.48 MP, 10 steps) -> 147s; 1º step 108s,  demais ~2,7s  CONSTANTE
 *
 * De ponta a ponta pelo caminho de produção (generateImageViaComfyUI):
 *
 *   com o modelo JÁ RESIDENTE na VRAM   -> 38,5s / 38,9s (duas rodadas)
 *   quando o modelo precisa (re)carregar -> 500,0s / 500,8s (duas rodadas)
 *
 * O achado que importa: **o custo dominante não é resolução nem step count,
 * é o modelo estar ou não residente na VRAM.** Note que 500s apareceu tanto
 * em 0.26 MP quanto em 1.0 MP - 4x mais pixels, mesmo tempo. O que muda o
 * patamar é o (re)load de ~460s, não o pixel count. Com o modelo residente,
 * o step é rápido e absolutamente estável em qualquer uma das resoluções.
 *
 * Por que o modelo é evictado: o FLUX.2 Dev sozinho ocupa ~18,6GB dos ~24GB
 * do card, e ESTA MESMA GPU também roda os jobs de vídeo H3 (MiniMax) - que
 * carregam outro conjunto de pesos e expulsam o Flux da VRAM. Alternar entre
 * família Flux e família H3 é o que cria o custo de reload. É exatamente o
 * problema que a seção 26 do plano de evolução (Model Affinity Queue)
 * descreve: agrupar jobs por família de modelo em vez de intercalar.
 *
 * Uma análise anterior desta sessão concluiu que ~1.0 MP era inviável (steps
 * crescendo de forma errática, 7s->46s). Isso estava ERRADO e foi corrigido:
 * aquelas medições foram feitas com a GPU disputada/fragmentada (inclusive
 * com job real de vídeo de produção rodando junto). Em estado limpo, 1.0 MP
 * roda com step constante de 1,92s.
 */

export type QualityProfile = 'draft' | 'standard' | 'master';
export const QUALITY_PROFILE_VALUES: readonly QualityProfile[] = ['draft', 'standard', 'master'];

export function isQualityProfile(value: unknown): value is QualityProfile {
  return typeof value === 'string' && (QUALITY_PROFILE_VALUES as readonly string[]).includes(value);
}

export interface T2IRefineParams {
  /** Megapixels alvo do passe de refino (1088x1360 ~= 1.48 MP no profile original 4:5). */
  megapixels: number;
  steps: number;
  denoise: number;
  upscaleMethod: 'bislerp';
}

export interface T2IProfileParams {
  /** Megapixels alvo do passe base (896x1120 ~= 1.0 MP no profile original 4:5). */
  baseMegapixels: number;
  baseSteps: number;
  /** null = sem segundo passe (draft). */
  refine: T2IRefineParams | null;
}

/**
 * Guidance NÃO varia por profile (é uma propriedade do prompt/estilo, não
 * de "quanto compute gastar") - varia só entre base e refine, igual ao
 *01_t2i_flux_editorial.json original: refine com guidance mais baixo
 * porque nesse estágio o objetivo é textura, não composição.
 */
/**
 * O template oficial do FLUX.2 Dev usa guidance 4 no passe principal. O
 * refino preserva guidance menor porque sua função é recuperar textura sem
 * redesenhar a composição aprovada.
 */
export const T2I_GUIDANCE = { base: 4.0, refine: 2.2 } as const;

/** 1.0 MP = 896x1120 em 4:5. Medido: 1,92s/step constante com modelo quente. */
const BASE_MEGAPIXELS = 1.0;
/** 1.48 MP = 1088x1360 em 4:5. Medido: ~2,7s/step constante com modelo quente. */
const REFINE_MEGAPIXELS = 1.48;

/**
 * Quem tem refino e quem não tem é decisão MEDIDA, não estética. O segundo
 * estágio custa, além dos seus 10-12 steps, mais um "primeiro step" caro
 * (108s medidos em 1088x1360) porque aloca um shape de tensor novo com a
 * VRAM já perto do teto. Pagar isso em TODA imagem, por um ganho que é só
 * de microtextura, não se justifica nesta GPU.
 *
 * Por isso `standard` (o default de todo mundo) fica em um estágio só, e o
 * refino vira o que diferencia o `master` - alinhado com a seção 5 do plano
 * de evolução ("tornar o refine condicional"): refino é pra quando faltou
 * detalhe, não pra toda imagem.
 */
export const T2I_PROFILES: Record<QualityProfile, T2IProfileParams> = {
  draft: {
    baseMegapixels: BASE_MEGAPIXELS,
    baseSteps: 20,
    refine: null, // ~80s medido
  },
  standard: {
    baseMegapixels: BASE_MEGAPIXELS,
    baseSteps: 24,
    refine: null, // ~87s medido (24 steps @ 896x1120, modelo quente)
  },
  master: {
    baseMegapixels: BASE_MEGAPIXELS,
    baseSteps: 28,
    // ~500s medido de ponta a ponta com refino. É o preço do "máxima qualidade".
    refine: { megapixels: REFINE_MEGAPIXELS, steps: 12, denoise: 0.38, upscaleMethod: 'bislerp' },
  },
};

/**
 * Dado um aspect ratio (da resolução pedida pelo usuário) e um alvo de
 * megapixels, devolve width/height múltiplos de 16 (grade do latente do
 * Flux) o mais próximo possível do MP alvo mantendo a proporção.
 */
export function resolutionForMegapixels(aspectWidth: number, aspectHeight: number, megapixels: number): { width: number; height: number } {
  const ratio = aspectWidth / aspectHeight;
  const targetPixels = megapixels * 1_000_000;
  const rawHeight = Math.sqrt(targetPixels / ratio);
  const rawWidth = rawHeight * ratio;
  const snap = (value: number) => Math.max(16, Math.round(value / 16) * 16);
  return { width: snap(rawWidth), height: snap(rawHeight) };
}

export interface I2IProfileParams {
  steps: number;
}

/** Edição multi-reference não tem passe de refino: só os steps variam por profile. */
export const I2I_PROFILES: Record<QualityProfile, I2IProfileParams> = {
  draft: { steps: 20 },
  standard: { steps: 24 },
  master: { steps: 28 },
};

/**
 * Guidance do template oficial Image Edit (FLUX.2 Dev) era 4.0. Baixado pra
 * 2.8 em 09/09/2026 depois de feedback real ("zero textura e zero
 * realismo" numa foto com pessoa + produto): guidance alto empurra o
 * modelo pra uma interpretação mais "idealizada"/editorial do prompt, que é
 * exatamente o viés que dá aparência de render. 2.8 é o meio-termo comum
 * pra reduzir esse efeito sem soltar tanto a aderência às referências que a
 * fidelidade de produto/cena (que já depende só do ReferenceLatent) piore
 * junto. Se a fidelidade cair perceptível nos próximos testes, subir de
 * volta pra perto de 3.5 antes de voltar a 4.0.
 */
export const I2I_GUIDANCE = 2.8;

/** Mesmo alvo do passe base do T2I - mantém o custo por step no mesmo patamar medido. */
export const I2I_TARGET_MEGAPIXELS = BASE_MEGAPIXELS;

export type TransformationStrength = 'low' | 'medium' | 'high';

/**
 * Seção 6 do plano: denoise NÃO é universal. Faixas do usuário:
 *   low    0.28-0.38 (recolor, luz, restyle leve)
 *   medium 0.45-0.58 (troca de cenário mantendo composição)
 *   high   0.65+     (reinterpretação forte)
 * Valor único escolhido no meio de cada faixa - documentado aqui, não
 * enterrado num literal solto no builder do grafo.
 */
export const TRANSFORMATION_STRENGTH_DENOISE: Record<TransformationStrength, number> = {
  low: 0.33,
  medium: 0.5,
  high: 0.72,
};

export interface MasterFinishDenoiseContext {
  identityCritical?: boolean;
  productCritical?: boolean;
}

/**
 * Seção 12: denoise do MASTER FINISH (UltimateSDUpscale) por contexto -
 * quanto mais crítico preservar identidade/produto exatos, menor o teto.
 * BLOQUEADO em produção hoje: custom node UltimateSDUpscale não está
 * instalado na GPU (ver workflow-registry.ts: finish_master_v1). Os
 * valores ficam prontos pra quando o node for instalado.
 */
export function masterFinishDenoise(context: MasterFinishDenoiseContext): number {
  if (context.identityCritical || context.productCritical) return 0.15; // 0.12-0.18
  return 0.20; // editorial: 0.18-0.22. "texture/environment" (0.22-0.28) é escolha explícita do chamador, não default.
}

/** Legado FLUX.1 Kontext, mantido somente para reproduzir jobs antigos. */
export const KONTEXT_STEPS: Record<'standard' | 'master', number> = {
  standard: 20,
  master: 24,
};

/** Seção 16: H3 Draft explora movimento/seed/câmera antes do Master gastar 8-14min de GPU. Master preserva os parâmetros medidos do workflow 05 original. */
export const H3_MASTER_STEPS = 25;
export const H3_DRAFT_STEPS = 8;
