import { z } from 'zod';
import { snapToH3Grid } from './video-h3';

const sceneSchema = z.object({
  image_prompt: z.string().min(1).optional(),
  duration_seconds: z.number().min(1).max(5).optional(),
  shot_type: z.string().optional(),
  continuity: z.string().optional(),
  camera_movement: z.string().optional(),
  subject_movement: z.string().optional(),
  environment: z.string().optional(),
  lighting: z.string().optional(),
});
const planSchema = z.object({
  duration: z.number().positive().max(80),
  scenes: z.array(sceneSchema).min(1).max(16),
  generation_prompts: z.array(z.string().min(1)).min(1),
  sound_direction: z.string().optional(),
});

export const TAKE_QUALITY_DIRECTION = 'Advertising editorial photography. Resolved skin pores and individual hair, natural fabric weave, physically consistent reflections and contact shadows, controlled highlights, optical depth of field. Preserve recognizable facial geometry, exact product parts and location evidence from the references. Do not invent branding, machinery parts or lettering.';
export const TAKE_CONTINUITY = 'Continuity across the sequence: same identifiable subjects, wardrobe, product geometry, material colors and lighting direction. Change only the framing and action explicitly requested for this take.';
export const MOTION_PRESERVATION = 'One continuous shot, no internal cuts. Preserve the keyframe identity, wardrobe, product geometry and scene layout throughout the shot. Maintain coherent shadows, stable fine texture and natural anatomy; no morphing, duplicate limbs, flickering, sudden acceleration or unrequested people/objects. Follow only the specified camera movement.';

export interface ProductionTake {
  index: number;
  sceneIndex: number;
  seconds: number;
  imagePrompt: string;
  motionPrompt: string;
}

/** Invalid explicit plans fail before spending GPU, never silently become one generic shot. */
export function buildProductionTakes(prompt: string, metadata: Record<string, unknown>, duration?: number | null): ProductionTake[] {
  const plan = metadata.video_plan === undefined ? null : planSchema.parse(metadata.video_plan);
  if (plan && plan.generation_prompts.length !== plan.scenes.length) {
    throw new Error('O roteiro precisa de um prompt de movimento para cada cena.');
  }
  const seconds = metadata.seconds ?? duration ?? plan?.duration ?? 5;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 1 || seconds > 80) {
    throw new Error('A sequência de vídeo deve ter entre 1 e 80 segundos.');
  }
  const scenes = plan?.scenes ?? [{}];
  const weights = scenes.map((scene) => scene.duration_seconds ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const takes: ProductionTake[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const sceneSeconds = seconds * weights[sceneIndex]! / totalWeight;
    if (sceneSeconds < 1) throw new Error('O roteiro tem mais cenas do que a duração permite (mínimo de 1 segundo por cena).');
    const parts = Math.ceil(sceneSeconds / 5);
    for (let part = 0; part < parts; part++) {
      const direction = [scene.environment, scene.lighting, scene.continuity].filter(Boolean).join('. ');
      takes.push({
        index: takes.length,
        sceneIndex,
        seconds: sceneSeconds / parts,
        imagePrompt: [scene.image_prompt ?? prompt, direction, TAKE_CONTINUITY, TAKE_QUALITY_DIRECTION].filter(Boolean).join('. '),
        motionPrompt: [plan?.generation_prompts[sceneIndex] ?? prompt,
          scene.camera_movement ? `Camera: ${scene.camera_movement}` : 'Camera: locked or subtle controlled movement',
          scene.subject_movement, direction,
          plan?.sound_direction ? `Sound: ${plan.sound_direction}` : 'Sound: natural ambience only, no invented dialogue',
          MOTION_PRESERVATION].filter(Boolean).join('. '),
      });
    }
  });
  if (takes.length > 16) throw new Error('O roteiro excede 16 takes; reduza a duração ou a quantidade de cenas.');
  return takes;
}

/** Local 4090 profile: preserve ratio without sending a 1080p/4K canvas to H3. */
export function resolveVideoCanvas(width: number, height: number, reels = false): { width: number; height: number } {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Resolução de vídeo inválida.');
  if (reels) { width = 768; height = 1344; }
  const scale = Math.min(1, Math.sqrt((768 * 1344) / (width * height)), 1344 / Math.max(width, height));
  return { width: snapToH3Grid(width * scale), height: snapToH3Grid(height * scale) };
}

export function plannedCarouselPrompt(metadata: Record<string, unknown>, index: number): string | undefined {
  const plan = metadata.carousel_plan as { slides?: unknown } | undefined;
  if (!Array.isArray(plan?.slides)) return undefined;
  const slide = plan.slides[index] as Record<string, unknown> | undefined;
  if (!slide || typeof slide.image_prompt !== 'string' || !slide.image_prompt.trim()) {
    throw new Error(`O slide ${index + 1} não tem direção de imagem no roteiro.`);
  }
  return [slide.image_prompt, typeof slide.composition === 'string' ? slide.composition : '', TAKE_CONTINUITY, TAKE_QUALITY_DIRECTION].filter(Boolean).join('. ');
}

export function shouldRenderHtmlCarousel(metadata: Record<string, unknown>, hasFrames: boolean): boolean {
  if (metadata.design === 'photographic' || metadata.design === 'takes' || metadata.carousel_plan || metadata.video_plan) return false;
  return metadata.design === 'html' || hasFrames;
}
