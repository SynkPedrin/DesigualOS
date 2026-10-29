import { Worker, type Job } from 'bullmq';
import {
  enqueueWhatsappSync,
  retryWhatsappSync,
  retryWhatsappWebhook,
  getRedisConnection,
  publishWsEvent,
  scheduleWhatsappFollowupSync,
  sendOpsAlert,
  WHATSAPP_QUEUE_NAME,
  type WhatsappQueueJobData,
} from '@desigual-os/orchestrator';
import {
  createWhatsappSyncJob,
  listPendingWhatsappSyncJobs,
  listPendingWhatsappWebhookEvents,
  listWhatsappWebhookEventsParaRetomar,
  processOpenwaSyncJob,
  recoverWhatsappWebhookEvent,
  processOpenwaWebhookEvent,
  whatsappSessionById,
} from '@desigual-os/tool-gateway';

interface Logger {
  info: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
}

async function process(job: Job<WhatsappQueueJobData>): Promise<void> {
  if (job.data.type === 'sync') {
    const result = await processOpenwaSyncJob(job.data.id, {
      finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      onProgress: (ownerUserId) => void publishWsEvent({ type: 'inbox.updated', payload: { owner_user_id: ownerUserId, sync: true } }).catch(() => undefined),
    });
    if (result.firstForSession && result.sessionId) await scheduleWhatsappFollowupSync(result.sessionId);
    return;
  }
  if (job.data.type === 'followup') {
    const session = await whatsappSessionById(job.data.id);
    if (session?.status === 'ready') {
      const sync = await createWhatsappSyncJob(session, null);
      if (sync.created) await enqueueWhatsappSync(sync.id);
    }
    return;
  }
  const result = await processOpenwaWebhookEvent(job.data.id);
  if (result.inboxChanged && result.ownerUserId) {
    await publishWsEvent({ type: 'inbox.updated', payload: { owner_user_id: result.ownerUserId, ...(result.threadId ? { thread_id: result.threadId } : {}) } }).catch(() => undefined);
  }
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
    // Sync e webhook dividem a fila. Com 3 vagas, três pessoas conectando ao
    // mesmo tempo (sync de minutos cada) seguravam toda mensagem nova que
    // chegava pelo webhook até um sync terminar. Webhook é leve; sync de cada
    // sessão usa o próprio navegador no OpenWA.
    concurrency: 12,
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
  // Identificador NOVO na fila: o job que um restart interrompeu fica no
  // conjunto "failed" do BullMQ com o id original ("stalled more than allowable
  // limit"), e reenfileirar com o mesmo id era ignorado em silêncio — o sync
  // ficava "running" no banco para sempre (visto em produção, 19/10/2026).
  for (const job of syncJobs) await retryWhatsappSync(job.id);
  // O mesmo vale para o webhook: o id original ficava preso no conjunto "failed" e o reenvio sumia.
  for (const event of webhookEvents) await retryWhatsappWebhook(event.id);
  logger.info({ syncJobs: syncJobs.length, webhookEvents: webhookEvents.length }, 'WhatsApp recovery finished');
}

/**
 * A cada 10 min, devolve à fila os eventos que falharam ou ficaram presos (ver
 * `listWhatsappWebhookEventsParaRetomar`). Mensagem que falhou numa instabilidade
 * passa a chegar sozinha, sem retry manual.
 */
export async function retomarEventosDoWhatsapp(logger: Logger): Promise<number> {
  const eventos = await listWhatsappWebhookEventsParaRetomar();
  for (const event of eventos) {
    await recoverWhatsappWebhookEvent(event.id);
    await retryWhatsappWebhook(event.id);
  }
  if (eventos.length) logger.info({ eventos: eventos.length }, 'WhatsApp: eventos falhos devolvidos à fila');
  return eventos.length;
}
