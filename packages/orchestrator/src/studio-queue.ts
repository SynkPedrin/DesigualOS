import { Queue } from 'bullmq';
import type { StudioReferenceAsset } from '@desigual-os/types';
import { getRedisConnection } from './queues';

export const STUDIO_JOBS_QUEUE_NAME = 'studio-jobs';

export type StudioJobAttachment = StudioReferenceAsset;

export interface StudioCopySlide {
  headline: string;
  subtext?: string | undefined;
}

export interface StudioJobData {
  studioJobDbId: string;
  jobId: string;
  clientId: string;
  requestedBy: string | null;
  projectId: string | null;
  type: string;
  prompt: string | null;
  resolution: string | null;
  /** Imagens/PDFs anexados como referência de criação. */
  attachments: StudioJobAttachment[];
  /** Só carousel: quantas imagens gerar. */
  numSlides: number | null;
  /** Só video/reels: duração em segundos (default 5 no worker; metadata.seconds sobrescreve). */
  durationSeconds: number | null;
  qualityPreset: string | null;
  /** Se deve sobrepor o texto da copy nas imagens/slides gerados. */
  includeText: boolean;
  /** Texto por slide, já gerado pela API antes de enfileirar (ver studio/routes.ts). */
  copySlides: StudioCopySlide[] | null;
  /** Estilo visual escolhido na tela do Studio; o worker traduz em modificador de prompt. */
  style?: string | undefined;
  /** Só image: quantas variações gerar do mesmo prompt (default 1). */
  variations?: number | undefined;
  /**
   * Só carousel HTML: URLs de frames (imagens) que entram como fundo dos
   * cards, na ordem. Presença não-vazia liga o caminho HTML (puppeteer-core)
   * em vez de ComfyUI+sharp (ver nodes/studio-node/src/html-carousel/).
   */
  referenceImages?: string[] | undefined;
  /** Opções extras do produtor. `design: 'html'` força o carrossel HTML mesmo sem frames. */
  metadata?: Record<string, unknown> | undefined;
}

let queue: Queue<StudioJobData> | null = null;

/**
 * Fila separada da queue-studio (usada por /chat quando o agente é
 * 'studio' como conversa). Jobs de mídia (seção 7.3) têm formato de
 * payload completamente diferente (prompt, resolução, cliente), então
 * ficam em fila própria pra não misturar os dois formatos.
 */
export function getStudioJobQueue(): Queue<StudioJobData> {
  queue ??= new Queue<StudioJobData>(STUDIO_JOBS_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}
