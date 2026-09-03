import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

export const STUDIO_JOBS_QUEUE_NAME = 'studio-jobs';

export interface StudioJobAttachment {
  filename: string;
  url: string;
  contentType: string;
}

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
  /** Só video/reels: guardados mesmo enquanto a geração real não está ligada. */
  durationSeconds: number | null;
  qualityPreset: string | null;
  /** Se deve sobrepor o texto da copy nas imagens/slides gerados. */
  includeText: boolean;
  /** Texto por slide, já gerado pela API antes de enfileirar (ver studio/routes.ts). */
  copySlides: StudioCopySlide[] | null;
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
