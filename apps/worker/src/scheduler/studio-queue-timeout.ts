import { db, schema } from '@desigual-os/database';
import { and, eq, lt } from 'drizzle-orm';
import type { Logger } from '@desigual-os/logging';
import { getStudioJobQueue, publishWsEvent, removeQueuedStudioJob } from '@desigual-os/orchestrator';

/**
 * studio-queue-timeout.ts — um job do Studio não pode ficar `queued` pra
 * sempre.
 *
 * Achado real (16/09/2026): o studio-node estava fora do ar e um job
 * ficou parado em `queued` desde 14/09 — dois dias. Nada no sistema
 * expirava job enfileirado, então o frontend mostrava "gerando" pra
 * sempre e ninguém era avisado de que não havia máquina pra processar.
 *
 * A dificuldade é que "esperando" é AMBÍGUO: a fila roda com
 * `concurrency: 1` e uma geração cold de duas passadas levou 1510s
 * medidos, então esperar 25 minutos pode ser perfeitamente normal se
 * houver um worker ocupado na frente. Reprovar por tempo puro
 * transformaria fila saudável em job falhado.
 *
 * Por isso a decisão usa o sinal que o BullMQ já expõe: `getWorkers()`
 * lista os workers CONECTADOS naquele Redis. Com isso dá pra separar os
 * dois casos de verdade:
 *
 *   nenhum worker conectado  -> não existe quem processe. Falha rápido.
 *   worker conectado         -> pode estar só ocupado. Tolerância longa.
 *
 * Quando expira, o job também sai da fila: deixar a linha `failed` no
 * banco mas o job vivo no Redis faria um worker que voltasse depois gerar
 * a imagem assim mesmo — GPU real gasta numa peça que o usuário já viu
 * como falhada.
 */

/**
 * Sem worker nenhum conectado. Curto de propósito: não há o que esperar,
 * e o valor aqui é o colaborador descobrir rápido que a máquina do Studio
 * está fora, em vez de olhar um spinner. Não é zero porque um restart do
 * studio-node (deploy, reboot) leva alguns segundos e não deve reprovar
 * jobs recém-criados.
 */
const SEM_WORKER_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Com worker conectado, o teto é generoso: cobre uma fila de algumas
 * gerações cold (1510s medidos cada) sem reprovar espera legítima. Se
 * estourar isso, alguma coisa travou de verdade.
 */
const COM_WORKER_TIMEOUT_MS = 90 * 60 * 1000;

export const MENSAGEM_SEM_WORKER =
  'No available Studio worker. A máquina de geração do Studio não está conectada - nenhum worker consumindo a fila. Avise o responsável pela máquina da GPU.';

const MENSAGEM_ESPERA_LONGA =
  'O job ficou na fila além do tempo máximo mesmo com worker conectado. A fila pode estar travada - confira o estado do studio-node e do ComfyUI.';

export interface ResultadoDoTimeout {
  workersConectados: number;
  expirados: number;
  jobIds: string[];
}

export async function expireStaleStudioJobs(logger: Logger): Promise<ResultadoDoTimeout> {
  const queue = getStudioJobQueue();

  // getWorkers() fala com o Redis (CLIENT LIST) e devolve quem está
  // registrado como worker DESTA fila. É o sinal autoritativo de "existe
  // alguém pra processar", não uma suposição por tempo.
  let workersConectados = 0;
  try {
    workersConectados = (await queue.getWorkers()).length;
  } catch (error) {
    // Redis fora: sem sinal confiável, não reprova nada. Falso positivo
    // aqui reprovaria job bom por problema de rede do próprio scheduler.
    logger.warn({ error }, 'studio-queue-timeout: não consegui listar workers - pulando esta rodada');
    return { workersConectados: 0, expirados: 0, jobIds: [] };
  }

  const limiteMs = workersConectados > 0 ? COM_WORKER_TIMEOUT_MS : SEM_WORKER_TIMEOUT_MS;
  const limite = new Date(Date.now() - limiteMs);

  const parados = await db
    .select({ jobId: schema.studioJobs.jobId, requestedBy: schema.studioJobs.requestedBy, progress: schema.studioJobs.progress })
    .from(schema.studioJobs)
    .where(and(eq(schema.studioJobs.status, 'queued'), lt(schema.studioJobs.createdAt, limite)));

  if (parados.length === 0) return { workersConectados, expirados: 0, jobIds: [] };

  const motivo = workersConectados > 0 ? MENSAGEM_ESPERA_LONGA : MENSAGEM_SEM_WORKER;
  const jobIds: string[] = [];

  for (const job of parados) {
    // Tira da fila ANTES de marcar falhado: se um worker aparecer no meio
    // desta varredura, é melhor ele já não encontrar o job do que gerar
    // uma imagem pra um job que o usuário verá como falhado.
    await removeQueuedStudioJob(job.jobId);

    // Condicional no status: se o job saiu de `queued` entre o SELECT e
    // agora (um worker pegou de verdade), não sobrescreve o progresso
    // real com uma falha inventada.
    const atualizados = await db
      .update(schema.studioJobs)
      .set({ status: 'failed', error: motivo })
      .where(and(eq(schema.studioJobs.jobId, job.jobId), eq(schema.studioJobs.status, 'queued')))
      .returning({ jobId: schema.studioJobs.jobId });
    if (atualizados.length === 0) continue;

    jobIds.push(job.jobId);
    await publishWsEvent({
      type: 'studio.job.progress',
      payload: { job_id: job.jobId, progress: job.progress, status: 'failed' },
    });
    if (job.requestedBy) {
      await db.insert(schema.notifications).values({
        userId: job.requestedBy,
        type: 'studio.job.failed',
        title: 'Seu job no Studio não pôde ser processado',
        body: motivo,
        link: '/studio',
      });
    }
  }

  if (jobIds.length > 0) {
    logger.warn({ workersConectados, expirados: jobIds.length, jobIds }, 'studio-queue-timeout: jobs expirados na fila');
    await db.insert(schema.auditLogs).values({
      action: 'studio.job.queue_timeout',
      agent: 'studio',
      result: 'failed',
      metadata: { job_ids: jobIds, workers_connected: workersConectados, timeout_ms: limiteMs },
    });
  }

  return { workersConectados, expirados: jobIds.length, jobIds };
}

/** Exportado só pro teste: evita repetir os números mágicos na asserção. */
export const TIMEOUTS_MS = { semWorker: SEM_WORKER_TIMEOUT_MS, comWorker: COM_WORKER_TIMEOUT_MS };
