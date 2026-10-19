import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

export const WHATSAPP_QUEUE_NAME = 'queue-whatsapp';

export type WhatsappQueueJobData =
  | { type: 'sync'; id: string }
  | { type: 'webhook'; id: string };

let queue: Queue<WhatsappQueueJobData> | null = null;

export function getWhatsappQueue(): Queue<WhatsappQueueJobData> {
  queue ??= new Queue<WhatsappQueueJobData>(WHATSAPP_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
  return queue;
}

// Sync espera o WhatsApp Web terminar de carregar o histórico do celular, o
// que numa conta grande leva minutos: 8 tentativas de 30 s em diante cobrem
// ~2 h, no lugar das 5 de 5 s (~1 min) que valem para webhook.
const SYNC_JOB_OPTIONS = { attempts: 8, backoff: { type: 'exponential' as const, delay: 30_000 } };

export async function enqueueWhatsappSync(id: string): Promise<void> {
  await getWhatsappQueue().add('sync', { type: 'sync', id }, { jobId: `whatsapp-sync-${id}`, ...SYNC_JOB_OPTIONS });
}

export async function enqueueWhatsappWebhook(id: string): Promise<void> {
  await getWhatsappQueue().add('webhook', { type: 'webhook', id }, { jobId: `whatsapp-webhook-${id}` });
}

export async function retryWhatsappSync(id: string): Promise<void> {
  await getWhatsappQueue().add('sync', { type: 'sync', id }, { jobId: `whatsapp-sync-${id}-${Date.now()}`, ...SYNC_JOB_OPTIONS });
}

export async function retryWhatsappWebhook(id: string): Promise<void> {
  await getWhatsappQueue().add('webhook', { type: 'webhook', id }, { jobId: `whatsapp-webhook-${id}-${Date.now()}` });
}
