import './env.js';
import { Worker } from 'bullmq';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { createLogger } from '@desigual-os/logging';
import {
  AUTOMATIONS_QUEUE_NAME,
  expireStaleMemories,
  flushPendingLearnings,
  getRedisConnection,
  queueNameForAgent,
  sendOpsAlert,
  startWorkerHeartbeat,
  stopWorkerHeartbeat,
  THUMBNAILS_QUEUE_NAME,
  type AgentJobData,
  type AutomationJobData,
} from '@desigual-os/orchestrator';
import { processAgentJob } from './processors/execute-job.js';
import { processAutomationJob } from './processors/run-automation.js';
import { backfillThumbnails, generateThumbnail } from './processors/generate-thumbnail.js';
import { setupDailyJobs } from './scheduler/index.js';

const logger = createLogger({ service: 'worker' });

/** true quando essa foi a ÚLTIMA tentativa (BullMQ não vai reenfileirar sozinho de novo). */
function isFinalAttempt(
  job: { attemptsMade: number; opts: { attempts?: number } } | undefined,
): boolean {
  if (!job) return true;
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

const dailyDigestWorker = setupDailyJobs();

const automationsWorker = new Worker<AutomationJobData>(
  AUTOMATIONS_QUEUE_NAME,
  async (job) => {
    await processAutomationJob(job, logger);
  },
  { connection: getRedisConnection(), concurrency: 5 },
);

automationsWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, automationId: job.data.automationId }, 'Automation job completed');
});

automationsWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, automationId: job?.data.automationId, error: error.message },
    'Automation job failed',
  );
  // Só alerta quando esgotou as tentativas - falha de uma tentativa que o
  // BullMQ ainda vai reenfileirar sozinho não precisa acordar ninguém.
  if (isFinalAttempt(job)) {
    void sendOpsAlert({
      severity: 'warning',
      title: `Automação falhou (sem mais tentativas)`,
      detail: `automationId: ${job?.data.automationId ?? 'desconhecido'}\nErro: ${error.message}`,
    });
  }
});

// Concurrency por agente (BL-14, medido ao vivo 13/09/2026: o otto-node é
// single-thread de fato - Ollama em CPU serializa - e 2+ jobs simultâneos
// empilhavam DENTRO do timeout um do outro: o segundo job morria sem nunca
// ter começado. A fila do BullMQ é o lugar certo pra serializar: o job
// seguinte só começa quando o anterior terminou, com seu timeout intacto.
// Jarbas e os demais seguem em 5.
const AGENT_QUEUE_CONCURRENCY: Partial<Record<AgentName, number>> = { otto: 1 };

const workers = AGENT_NAMES.map((agent) => {
  const worker = new Worker<AgentJobData>(
    queueNameForAgent(agent),
    async (job) => {
      await processAgentJob(job, logger);
    },
    { connection: getRedisConnection(), concurrency: AGENT_QUEUE_CONCURRENCY[agent] ?? 5 },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, agent }, 'Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, agent, error: error.message }, 'Job failed');
    if (isFinalAttempt(job)) {
      void sendOpsAlert({
        severity: 'critical',
        title: `Execução do ${agent} falhou (sem mais tentativas)`,
        detail: `jobId: ${job?.id ?? 'desconhecido'}\nErro: ${error.message}`,
      });
    }
  });

  return worker;
});

// Thumbnails da galeria do Studio: originais Flux chegam a 2-17MB cada e a
// galeria baixava ~80MB por carga (auditoria de performance, 12/09/2026).
// Concurrency 2: sharp é CPU-bound e o Mac divide recurso com a API.
const thumbnailsWorker = new Worker<{ assetId: string }>(
  THUMBNAILS_QUEUE_NAME,
  async (job) => {
    await generateThumbnail(job.data.assetId, logger);
  },
  { connection: getRedisConnection(), concurrency: 2 },
);
thumbnailsWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, assetId: job?.data.assetId, error: error.message }, 'Thumbnail job failed');
});

backfillThumbnails(logger).catch((error: unknown) => logger.error({ error }, 'Falha no backfill de thumbnails'));

// Sinal de vida, lido pela API em /health/infrastructure. Ver worker-heartbeat.ts pro defeito
// que isto fecha: worker morto por 10 minutos com o painel estampando "Todos os sistemas online".
const pararBatimento = startWorkerHeartbeat();

// flushPendingLearnings (learning.ts) existia sem nenhum chamador (achado da
// auditoria de prontidão, 2026-09-11): um aprendizado que ficou `pending`
// porque a máquina do agente estava fora do ar na hora nunca era reenviado
// pro brain. Flush a cada 5 min com catch próprio - uma rejeição solta aqui
// cairia no unhandledRejection abaixo e derrubaria o worker inteiro por
// causa de um efeito colateral.
const FLUSH_PENDING_LEARNINGS_MS = 5 * 60_000;
const flushLearningsTimer = setInterval(() => {
  flushPendingLearnings()
    .then(({ tried, pushed }) => {
      if (tried > 0) {
        logger.info({ tried, pushed }, 'Reenvio de aprendizados pendentes concluído');
      }
    })
    .catch((error: unknown) => logger.error({ error }, 'Falha ao reenviar aprendizados pendentes'));
}, FLUSH_PENDING_LEARNINGS_MS);
flushLearningsTimer.unref();

// Onda 1.7 (auditoria forense 12/09/2026, BL de memória): expireStaleMemories
// existia sem nenhum chamador - fato temporário ("cliente de férias até dia
// 20") seguiria ativo pra sempre na recuperação. Roda 1x/hora; marca como
// 'expired', nunca apaga (o histórico continua auditável).
const EXPIRE_MEMORIES_MS = 60 * 60_000;
const expireMemoriesTimer = setInterval(() => {
  expireStaleMemories()
    .then((expired) => {
      if (expired > 0) logger.info({ expired }, 'Memórias expiradas marcadas');
    })
    .catch((error: unknown) => logger.error({ error }, 'Falha ao expirar memórias'));
}, EXPIRE_MEMORIES_MS);
expireMemoriesTimer.unref();

logger.info({ agents: AGENT_NAMES, pid: process.pid }, 'Worker started, listening on all agent queues');

/**
 * Desligamento: termina o job em execução antes de sair.
 *
 * Medido em 10/09/2026: com o processo morto no meio de um job, o usuário recebia a bolha de
 * erro e a execução ficava presa. `worker.close()` sem argumento já espera o job ativo terminar
 * — o problema era o supervisor perder a paciência antes (o watcher do tsx força SIGKILL em 5s,
 * e uma chamada de LLM leva mais que isso). O launchd de produção (infra/launchd) dá 60s por
 * isso, e o teto abaixo garante que a gente saia mesmo se um job travar pra sempre.
 *
 * `apagarBatimento` roda ANTES de esperar os jobs: assim a saúde acusa "parando" imediatamente,
 * em vez de mentir "online" durante o dreno.
 */
const TETO_DE_DRENO_MS = 55_000;
let desligando = false;

async function shutdown(motivo: string): Promise<void> {
  if (desligando) return;
  desligando = true;
  logger.info({ motivo }, 'Shutting down worker');

  clearInterval(flushLearningsTimer);
  clearInterval(expireMemoriesTimer);
  pararBatimento();
  await stopWorkerHeartbeat();

  const dreno = Promise.all(
    [...workers, dailyDigestWorker, automationsWorker, thumbnailsWorker].map((worker) => worker.close()),
  );
  const teto = new Promise<'teto'>((resolve) => {
    const t = setTimeout(() => resolve('teto'), TETO_DE_DRENO_MS);
    t.unref?.();
  });

  const resultado = await Promise.race([dreno.then(() => 'drenado' as const), teto]);
  if (resultado === 'teto') {
    logger.error({ TETO_DE_DRENO_MS }, 'Job ativo não terminou no teto de dreno; saindo mesmo assim');
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

/**
 * Crash não pode virar processo zumbi: sem estes dois, uma promessa rejeitada sem catch deixava
 * o worker vivo mas sem consumir fila — o pior estado possível, porque o supervisor não
 * reinicia (o processo existe) e ninguém executa nada. Sai com código 1; quem reinicia é o
 * supervisor, que é o único que sabe reiniciar de verdade.
 */
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'uncaughtException no worker: saindo pra o supervisor reiniciar');
  void sendOpsAlert({
    severity: 'critical',
    title: 'Worker caiu (uncaughtException)',
    detail: `${(error as Error).message}\n\nO supervisor vai reiniciar. Se isto se repetir, é bug, não instabilidade.`,
  });
  setTimeout(() => process.exit(1), 1000).unref?.();
});

process.on('unhandledRejection', (motivo) => {
  logger.fatal({ motivo }, 'unhandledRejection no worker: saindo pra o supervisor reiniciar');
  setTimeout(() => process.exit(1), 1000).unref?.();
});
