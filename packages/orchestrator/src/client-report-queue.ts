import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

/**
 * Fila de Relatórios PDF por cliente (§46-51 do prompt de refinamento,
 * 06/10/2026). Mesmo padrão de thumbnail-queue.ts: fila pequena, dedicada,
 * jobId = reportId (reenqueue é idempotente de graça).
 *
 * Assíncrono porque gerar o PDF cruza DUAS chamadas de API externa por canal
 * (período atual + período anterior, pra comparação) mais a renderização em
 * si — longo demais pra uma requisição HTTP síncrona seguir sendo segura.
 */
export const CLIENT_REPORTS_QUEUE_NAME = 'client-reports';

export interface ClientReportJobData {
  reportId: string;
}

let queue: Queue<ClientReportJobData> | null = null;

export function getClientReportQueue(): Queue<ClientReportJobData> {
  if (!queue) {
    queue = new Queue(CLIENT_REPORTS_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    });
  }
  return queue;
}

export async function enqueueClientReport(reportId: string): Promise<void> {
  await getClientReportQueue().add('generate', { reportId }, { jobId: `report-${reportId}` });
}
