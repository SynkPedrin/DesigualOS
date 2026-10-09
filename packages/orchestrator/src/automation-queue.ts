import { Queue } from 'bullmq';
import { getRedisConnection } from './queues';

export const AUTOMATIONS_QUEUE_NAME = 'automations';

export interface AutomationJobData {
  automationId: string;
  /** Execução manual (POST /automations/:id/run): dispara uma vez, sem repeatable. */
  manual?: boolean;
}

let queue: Queue<AutomationJobData> | null = null;

export function getAutomationsQueue(): Queue<AutomationJobData> {
  queue ??= new Queue<AutomationJobData>(AUTOMATIONS_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

/**
 * Um repeatable job do BullMQ por automação (jobId = automation.id, então
 * registrar de novo com o mesmo id/pattern é idempotente - não duplica).
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

/** Precisa do MESMO pattern usado no registro - BullMQ identifica o repeatable pela
 * combinação {pattern, jobId}, não só pelo jobId. E o jobId tem que ir no 3º
 * argumento: dentro de repeatOpts ele é sobrescrito por undefined no
 * Object.assign interno do BullMQ e a remoção falha em silêncio (repeatable
 * órfão no Redis, medido em 03/09/2026). */
export async function removeAutomationJob(automationId: string, schedule: string): Promise<void> {
  await getAutomationsQueue().removeRepeatable('run', { pattern: schedule }, automationId);
}

/**
 * Disparo manual ("executar agora"): job comum, sem repeat e sem jobId fixo
 * (o BullMQ gera o id), então execuções manuais repetidas não colidem entre
 * si nem com o repeatable job agendado da mesma automação.
 */
export async function runAutomationNow(automationId: string): Promise<void> {
  await getAutomationsQueue().add('run', { automationId, manual: true });
}

/**
 * QUANDO CADA AUTOMAÇÃO RODA DE NOVO — perguntando a quem de fato vai disparar.
 *
 * A tela de Automações precisa mostrar "próxima execução", e havia duas formas
 * de obter isso: reinterpretar o padrão cron no servidor (ou no navegador), ou
 * perguntar ao BullMQ. A segunda é a certa, e não por economia de código.
 *
 * O `next` do repeatable job é a hora que o agendador REALMENTE agendou. Um
 * recálculo nosso seria uma segunda opinião sobre o mesmo cron — e as duas
 * divergem no momento em que alguém edita o schedule, muda o fuso, ou o
 * repeatable fica órfão no Redis (já aconteceu aqui em 03/09/2026). Nesse
 * momento a tela mostraria um horário que não vai acontecer, com toda a
 * confiança de um dado calculado.
 *
 * Automação sem repeatable registrado simplesmente não aparece no mapa — e a
 * ausência é informação: significa que ela está no banco mas não está agendada
 * em lugar nenhum, que é exatamente o estado que alguém precisa ver.
 */
export async function proximasExecucoes(): Promise<Map<string, number>> {
  const jobs = await getAutomationsQueue().getRepeatableJobs();
  const porAutomacao = new Map<string, number>();
  for (const job of jobs) {
    // `id` é o jobId que registramos = automation.id. `next` vem em epoch ms.
    if (!job.id || typeof job.next !== 'number') continue;
    const anterior = porAutomacao.get(job.id);
    // Se houver mais de um repeatable pro mesmo id (resquício de troca de
    // schedule), vale o que dispara ANTES: é o que a pessoa vai ver acontecer.
    if (anterior === undefined || job.next < anterior) porAutomacao.set(job.id, job.next);
  }
  return porAutomacao;
}
