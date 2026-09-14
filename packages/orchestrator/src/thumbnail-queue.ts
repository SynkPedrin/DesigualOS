import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

/**
 * Fila de thumbnails da galeria do Studio (achado da auditoria de
 * performance, 12/09/2026: a galeria baixava 43 imagens / ~80MB de
 * originais Flux). jobId = assetId: reenqueue é idempotente de graça.
 */
export const THUMBNAILS_QUEUE_NAME = 'studio-thumbnails';

let queue: Queue<{ assetId: string }> | null = null;

export function getThumbnailsQueue(): Queue<{ assetId: string }> {
  if (!queue) {
    queue = new Queue(THUMBNAILS_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    });
  }
  return queue;
}

export async function enqueueThumbnail(assetId: string): Promise<void> {
  await getThumbnailsQueue().add('generate', { assetId }, { jobId: `thumb-${assetId}` });
}
