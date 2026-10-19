import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

export const WHATSAPP_QUEUE_NAME = 'queue-whatsapp';

export type WhatsappQueueJobData =
  | { type: 'sync'; id: string }
  | { type: 'webhook'; id: string }
  /** Segunda passada agendada após o primeiro sync de uma sessão; `id` é o da sessão. */
  | { type: 'followup'; id: string };

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

/**
 * Logo após o QR, o WhatsApp Web só tem a última mensagem de cada conversa;
 * o celular manda o resto nos minutos seguintes. Uma segunda passada depois
 * disso busca o histórico que o primeiro sync ainda não tinha como ver.
 */
export async function scheduleWhatsappFollowupSync(sessionId: string, delayMs = 10 * 60_000): Promise<void> {
  await getWhatsappQueue().add('followup', { type: 'followup', id: sessionId }, { jobId: `whatsapp-followup-${sessionId}`, delay: delayMs, attempts: 1 });
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
