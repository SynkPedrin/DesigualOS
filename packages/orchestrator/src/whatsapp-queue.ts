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

export async function enqueueWhatsappSync(id: string): Promise<void> {
  await getWhatsappQueue().add('sync', { type: 'sync', id }, { jobId: `whatsapp-sync-${id}` });
}

export async function enqueueWhatsappWebhook(id: string): Promise<void> {
  await getWhatsappQueue().add('webhook', { type: 'webhook', id }, { jobId: `whatsapp-webhook-${id}` });
}

export async function retryWhatsappSync(id: string): Promise<void> {
  await getWhatsappQueue().add('sync', { type: 'sync', id }, { jobId: `whatsapp-sync-${id}-${Date.now()}` });
}

export async function retryWhatsappWebhook(id: string): Promise<void> {
  await getWhatsappQueue().add('webhook', { type: 'webhook', id }, { jobId: `whatsapp-webhook-${id}-${Date.now()}` });
}
