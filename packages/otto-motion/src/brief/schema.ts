import { z } from 'zod';
import { ALLOWED_FPS, DEFAULT_DURATION_SECONDS, DEFAULT_FPS, DEFAULT_MOTION_FORMAT, MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, MOTION_FORMATS } from '../types.js';

/**
 * BRIEFING DA CAMPANHA (§4/§6).
 *
 * A separação entre BRAND CONTEXT e CAMPAIGN BRIEF não é organizacional, é de
 * procedência: a marca vem do brain do cliente e vale pra sempre; o briefing
 * vem da pessoa, naquele turno, e vale pra aquela peça. Misturar os dois faria
 * um preço de campanha virar "fato do cliente" no motion seguinte.
 *
 * Nada aqui é obrigatório além do essencial. Formulário grande não é briefing,
 * é obstáculo — quem preenche está no meio de uma conversa.
 */
export const offerSchema = z.object({
  /** Nome da oferta. "Avaliação gratuita", "Plano Anual". */
  name: z.string().trim().min(1).max(160).optional(),
  /** Preço à vista, como a pessoa escreveu. Normalizado, nunca reinterpretado. */
  price: z.string().trim().max(40).optional(),
  /** Preço "de", quando há comparação. */
  originalPrice: z.string().trim().max(40).optional(),
  installments: z.string().trim().max(40).optional(),
  installmentValue: z.string().trim().max(40).optional(),
  discount: z.string().trim().max(40).optional(),
  /** Condição comercial em uma linha. "Só em setembro", "para novos clientes". */
  condition: z.string().trim().max(240).optional(),
});

export type Offer = z.infer<typeof offerSchema>;

export const campaignBriefSchema = z.object({
  campaignName: z.string().trim().max(160).optional(),
  objective: z.string().trim().max(240).optional(),
  offer: offerSchema.optional(),
  cta: z.string().trim().max(120).optional(),
  audience: z.string().trim().max(400).optional(),
  platform: z.string().trim().max(80).optional(),
  aspectRatio: z.enum(Object.keys(MOTION_FORMATS) as [string, ...string[]]).optional(),
  duration: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS).optional(),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
  tone: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CampaignBrief = z.infer<typeof campaignBriefSchema>;

/** Presets que a UI oferece; o campo continua livre pra quem quiser escrever outra coisa. */
export const TONE_PRESETS = ['Premium', 'Direto', 'Agressivo', 'Clean', 'Acolhedor', 'Institucional'] as const;

export const OBJECTIVE_PRESETS = [
  'Gerar leads',
  'Vender agora',
  'Divulgar lançamento',
  'Reforçar marca',
  'Convidar para evento',
] as const;

export interface BriefResolution {
  aspectRatio: keyof typeof MOTION_FORMATS;
  duration: number;
  fps: (typeof ALLOWED_FPS)[number];
}

/**
 * Formato/duração/fps efetivos: o que o briefing diz, depois o que a frase do
 * turno dizia, depois o default. Nesta ordem porque o briefing é a decisão
 * mais recente e mais explícita da pessoa.
 */
export function resolveBriefFormat(
  brief: CampaignBrief | null,
  fromMessage: { format?: string | undefined; durationSeconds?: number | undefined; fps?: number | undefined },
): BriefResolution {
  const aspect = (brief?.aspectRatio ?? fromMessage.format ?? DEFAULT_MOTION_FORMAT) as keyof typeof MOTION_FORMATS;
  const fps = (brief?.fps ?? fromMessage.fps ?? DEFAULT_FPS) as (typeof ALLOWED_FPS)[number];
  return {
    aspectRatio: MOTION_FORMATS[aspect] ? aspect : DEFAULT_MOTION_FORMAT,
    duration: brief?.duration ?? fromMessage.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    fps: ALLOWED_FPS.includes(fps) ? fps : DEFAULT_FPS,
  };
}

/**
 * O briefing tem o mínimo pra valer a pena gerar?
 *
 * "Mínimo" aqui é deliberadamente baixo: objetivo OU oferta OU uma observação
 * com direção. Exigir mais transformaria o card num formulário, e uma peça
 * institucional legítima não tem preço nem CTA — o §22 é explícito que campo
 * vazio não pode virar fato inventado, não que ele bloqueie a geração.
 */
export function briefHasDirection(brief: CampaignBrief | null | undefined): boolean {
  if (!brief) return false;
  const offer = brief.offer;
  return Boolean(
    brief.objective?.trim() ||
      brief.campaignName?.trim() ||
      brief.notes?.trim() ||
      offer?.name?.trim() ||
      offer?.price?.trim(),
  );
}
