import { Worker, type Job } from 'bullmq';
import {
  enqueueWhatsappSync,
  enqueueWhatsappWebhook,
  getRedisConnection,
  sendOpsAlert,
  WHATSAPP_QUEUE_NAME,
  type WhatsappQueueJobData,
} from '@desigual-os/orchestrator';
import {
  createWhatsappSyncJob,
  listPendingWhatsappSyncJobs,
  listPendingWhatsappWebhookEvents,
  processOpenwaSyncJob,
  processOpenwaWebhookEvent,
  whatsappSessionById,
} from '@desigual-os/tool-gateway';

interface Logger {
  info: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
}

async function process(job: Job<WhatsappQueueJobData>): Promise<void> {
  if (job.data.type === 'sync') {
    await processOpenwaSyncJob(job.data.id);
    return;
  }
  const result = await processOpenwaWebhookEvent(job.data.id);
  if (result.syncSessionId) {
    const session = await whatsappSessionById(result.syncSessionId);
    if (session) {
      const sync = await createWhatsappSyncJob(session, null);
      await enqueueWhatsappSync(sync.id);
    }
  }
}

export function startOpenwaWorker(logger: Logger): Worker<WhatsappQueueJobData> {
  const worker = new Worker<WhatsappQueueJobData>(WHATSAPP_QUEUE_NAME, process, {
    connection: getRedisConnection(),
    concurrency: 3,
  });
  worker.on('completed', (job) => logger.info({ jobId: job.id, type: job.data.type }, 'WhatsApp job completed'));
  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, type: job?.data.type, error: error.message }, 'WhatsApp job failed');
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void sendOpsAlert({
        severity: 'warning',
        title: 'Integração WhatsApp falhou sem mais tentativas',
        detail: `Fila: ${job.data.type}\nErro: ${error.message}`,
      });
    }
  });
  return worker;
}

export async function recoverOpenwaJobs(logger: Logger): Promise<void> {
  const [syncJobs, webhookEvents] = await Promise.all([
    listPendingWhatsappSyncJobs(),
    listPendingWhatsappWebhookEvents(),
  ]);
  for (const job of syncJobs) await enqueueWhatsappSync(job.id);
  for (const event of webhookEvents) await enqueueWhatsappWebhook(event.id);
  logger.info({ syncJobs: syncJobs.length, webhookEvents: webhookEvents.length }, 'WhatsApp recovery finished');
}
