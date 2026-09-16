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
/**
 * Tira da fila um job que ainda NÃO começou.
 *
 * Achado real (16/09/2026): `DELETE /studio/jobs/:id` apagava a linha de
 * `studio_jobs` e os assets, mas deixava o job no Redis. O worker pegava
 * depois, não achava a linha e gerava assim mesmo - GPU real gasta numa peça
 * que ninguém pediu mais. Cancelar/apagar precisa tirar dos DOIS lugares.
 *
 * Devolve `false` quando o job não está mais na fila (já está rodando, ou o
 * BullMQ já o removeu): nesse caso quem chama precisa do caminho caro -
 * marcar `cancelled` no banco e deixar o worker parar no próximo checkpoint.
 * Busca pelo `jobId` de negócio (`STU-...`), não pelo id numérico do BullMQ,
 * porque é o único que a API conhece.
 */
export async function removeQueuedStudioJob(jobId: string): Promise<boolean> {
  const queue = getStudioJobQueue();
  // 'wait'|'delayed'|'prioritized' só: um job 'active' está com o worker e
  // não pode ser removido por baixo dele sem corromper o lock.
  const pending = await queue.getJobs(['wait', 'delayed', 'prioritized', 'paused'], 0, 1000);
  const match = pending.find((job) => job.data?.jobId === jobId);
  if (!match) return false;
  try {
    await match.remove();
    return true;
  } catch {
    // Corrida normal: o worker pegou o job entre o getJobs e o remove.
    return false;
  }
}

export function getStudioJobQueue(): Queue<StudioJobData> {
  // defaultJobOptions: mesmo teto de retenção das filas de agente (ver
  // DEFAULT_JOB_OPTIONS em queues.ts) - o histórico autoritativo do job de
  // mídia vive em studio_jobs no Postgres.
  queue ??= new Queue<StudioJobData>(STUDIO_JOBS_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
  });
  return queue;
}
