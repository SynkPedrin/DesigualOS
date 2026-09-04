import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

export const AUTOMATIONS_QUEUE_NAME = 'automations';

export interface AutomationJobData {
  automationId: string;
}

let queue: Queue<AutomationJobData> | null = null;

function getAutomationsQueue(): Queue<AutomationJobData> {
  queue ??= new Queue<AutomationJobData>(AUTOMATIONS_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

/**
 * Um repeatable job do BullMQ por automação (jobId = automation.id, então
 * registrar de novo com o mesmo id/pattern é idempotente — não duplica).
 * Chamado pela API ao criar/editar/reativar uma automação; o worker
 * (apps/worker/src/automations) é quem consome e executa de fato.
 */
export async function registerAutomationJob(automationId: string, schedule: string): Promise<void> {
  await getAutomationsQueue().add(
    'run',
    { automationId },
    { repeat: { pattern: schedule }, jobId: automationId },
  );
}

/** Precisa do MESMO pattern usado no registro — BullMQ identifica o repeatable pela
 * combinação {pattern, jobId}, não só pelo jobId. E o jobId tem que ir no 3º
 * argumento: dentro de repeatOpts ele é sobrescrito por undefined no
 * Object.assign interno do BullMQ e a remoção falha em silêncio (repeatable
 * órfão no Redis, medido em 03/09/2026). */
export async function removeAutomationJob(automationId: string, schedule: string): Promise<void> {
  await getAutomationsQueue().removeRepeatable('run', { pattern: schedule }, automationId);
}
