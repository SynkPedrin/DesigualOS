import { Queue, Worker } from 'bullmq';
import { getRedisConnection } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';
import { runEndOfDayChecklist, runMorningBriefing } from './daily-digest';
import { processPendingEvents } from '../processors/operational-events';

const QUEUE_NAME = 'daily-digest';
const logger = createLogger({ service: 'worker:scheduler' });

/**
 * Checklist de fim de dia (18h) e resumo de pendências de manhã (8h),
 * pedidos pelo usuário pra manter a visão do colaborador simples: métricas
 * ficam só pro master, o colaborador recebe isso pronto todo dia.
 *
 * Junto com eles roda a varredura de EVENTOS OPERACIONAIS (a cada 5 min): o
 * event store recebia evento do ClickUp o dia inteiro e nada consumia a fila
 * (processed_at ficava nulo pra sempre). Não é diário porque prazo estourado
 * e criativo rejeitado perdem o valor se só forem notados no dia seguinte.
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
    queue.add('operational-events', {}, { repeat: { pattern: '*/5 * * * *' }, jobId: 'operational-events' }),
  ])
    .then(() => logger.info('Daily digest scheduler armed (checklist 18:00, resumo 08:00, eventos a cada 5min)'))
    .catch((error: unknown) => logger.error({ error }, 'Failed to register daily digest repeatable jobs'));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'end-of-day-checklist') {
        await runEndOfDayChecklist(logger);
      } else if (job.name === 'morning-briefing') {
        await runMorningBriefing(logger);
      } else if (job.name === 'operational-events') {
        await processPendingEvents(logger);
      }
    },
    { connection: getRedisConnection() },
  );

  return worker;
}
