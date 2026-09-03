import { Queue, Worker } from 'bullmq';
import { getRedisConnection } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';
import { runEndOfDayChecklist, runMorningBriefing } from './daily-digest';

const QUEUE_NAME = 'daily-digest';
const logger = createLogger({ service: 'worker:scheduler' });

/**
 * Checklist de fim de dia (18h) e resumo de pendências de manhã (8h),
 * pedidos pelo usuário pra manter a visão do colaborador simples: métricas
 * ficam só pro master, o colaborador recebe isso pronto todo dia.
 */
export function setupDailyJobs(): Worker {
  const queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });

  // Antes eram `void queue.add(...)`: se o Redis estivesse lento/fora do
  // ar bem no boot, a rejeição não tinha handler nenhum (unhandled
  // rejection) e o log de "scheduler armado" logo abaixo disparava do
  // mesmo jeito, escondendo que os jobs repetíveis nunca foram
  // registrados de verdade.
  Promise.all([
    queue.add('end-of-day-checklist', {}, { repeat: { pattern: '0 18 * * *' }, jobId: 'end-of-day-checklist' }),
    queue.add('morning-briefing', {}, { repeat: { pattern: '0 8 * * *' }, jobId: 'morning-briefing' }),
  ])
    .then(() => logger.info('Daily digest scheduler armed (checklist 18:00, resumo 08:00)'))
    .catch((error: unknown) => logger.error({ error }, 'Failed to register daily digest repeatable jobs'));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'end-of-day-checklist') {
        await runEndOfDayChecklist(logger);
      } else if (job.name === 'morning-briefing') {
        await runMorningBriefing(logger);
      }
    },
    { connection: getRedisConnection() },
  );

  return worker;
}
