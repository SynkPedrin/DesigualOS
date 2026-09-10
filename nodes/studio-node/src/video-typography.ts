import sharp from 'sharp';
import { z } from 'zod';
import { compositeSlideText } from './text-overlay';
import { compositeExactLogo, type BrandLogoComposition } from './brand-compositor';

export interface VideoOverlay { png: Buffer; startSeconds: number; endSeconds: number }
const textSchema = z.array(z.object({
  text: z.string().min(1).max(400), start_seconds: z.number().nonnegative(), end_seconds: z.number().positive(),
})).max(20);

/** Real glyph outlines and source logo pixels, added AFTER diffusion/motion. */
export async function renderVideoTypography(params: {
  width: number; height: number; seconds: number; metadata: Record<string, unknown>; logo?: BrandLogoComposition;
}): Promise<VideoOverlay[]> {
  const plan = params.metadata.video_plan as { text_overlays?: unknown } | undefined;
  const planTexts = Array.isArray(plan?.text_overlays) ? plan.text_overlays.filter((text): text is string => typeof text === 'string' && Boolean(text.trim())) : [];
  const raw = params.metadata.video_text_overlays ?? planTexts.map((text, i) => ({ text, start_seconds: i * params.seconds / planTexts.length, end_seconds: (i + 1) * params.seconds / planTexts.length }));
  const texts = textSchema.parse(raw);
  const blank = await sharp({ create: { width: params.width, height: params.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const overlays: VideoOverlay[] = [];
  for (const text of texts) {
    if (text.end_seconds <= text.start_seconds || text.end_seconds > params.seconds) throw new Error('Intervalo de texto fora da duração do vídeo.');
    overlays.push({ png: await compositeSlideText(blank, { headline: text.text }), startSeconds: text.start_seconds, endSeconds: text.end_seconds });
  }
  if (params.logo?.placement.startsWith('canvas_')) overlays.push({
    png: await compositeExactLogo(blank, params.logo), startSeconds: 0, endSeconds: params.seconds,
  });
  return overlays;
}
