/**
 * Tipos de job do Studio (seção 7.3), alinhado com as capabilities de
 * exemplo da seção 6.1 (image_generation, video_generation, upscale).
 */
export const STUDIO_JOB_TYPES = ['image', 'carousel', 'video', 'reels', 'upscale'] as const;

export type StudioJobType = (typeof STUDIO_JOB_TYPES)[number];
