import { Queue, Worker, type Job } from 'bullmq';
import { getRedisConnection } from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';
import { withMotionLock } from './workspace/lock.js';
import { isMotionError } from './errors.js';

/**
 * §29 — fila.
 *
 * O Desigual já roda BullMQ sobre Redis (packages/orchestrator/queues.ts), e
 * a orientação era reutilizar em vez de inventar infraestrutura. Fila PRÓPRIA
 * (não a `queue-otto`) por uma razão de operação: um job de motion leva
 * minutos e a fila do Otto é conversacional, com concurrency 1 — um motion
 * deixaria a equipe inteira esperando pra fazer uma pergunta.
 */
export const MOTION_QUEUE_NAME = 'otto-motion';

export interface MotionJobData {
  motionId: string;
  /**
   * `render` re-renderiza o projeto como ele está, SEM chamar o agente.
   *
   * Existe porque o botão "Renderizar" do chat não é um pedido criativo: é
   * "gera o arquivo de novo". Passá-lo como `update` com a instrução "não mude
   * nada" gastaria uma sessão inteira de Opus 5.5 (alguns dólares) pra não
   * mudar nada — e ainda correria o risco de o modelo mudar algo.
   */
  mode: 'create' | 'update' | 'render';
  instruction?: string | undefined;
  executionId?: string | null | undefined;
}

let queue: Queue<MotionJobData> | null = null;

export function getMotionQueue(): Queue<MotionJobData> {
  queue ??= new Queue<MotionJobData>(MOTION_QUEUE_NAME, {
    connection: getRedisConnection(),
    // Mesma política de retenção das outras filas: o estado autoritativo vive
    // no Postgres (motion_sessions), o Redis é só o transporte.
    defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200, attempts: 1 },
  });
  return queue;
}

export async function enqueueMotionJob(data: MotionJobData): Promise<void> {
  await getMotionQueue().add(data.mode, data, {
    // jobId por motion+modo+timestamp: dois ajustes no mesmo motion são dois
    // jobs legítimos (e o lock os serializa), mas um duplo-clique não deve
    // virar dois renders.
    jobId: `${data.motionId}:${data.mode}:${Math.floor(Date.now() / 5000)}`,
  });
}

/**
 * §28 — concorrência.
 *
 * `concurrency: 2` no worker: dois MOTIONS diferentes podem render ao mesmo
 * tempo (é CPU/browser, e a máquina aguenta dois), e o lock por motionId
 * garante que nunca são duas passadas no MESMO workspace. A conta de §47-I
 * (dois motions simultâneos) e §47-J (duas alterações concorrentes no mesmo)
 * é exatamente essa: a primeira passa, a segunda espera o lock.
 */
export function startMotionWorker(logger: Logger): Worker<MotionJobData> {
  const worker = new Worker<MotionJobData>(
    MOTION_QUEUE_NAME,
    async (job: Job<MotionJobData>) => {
      const { motionId, mode, instruction } = job.data;
      logger.info({ motionId, mode, jobId: job.id }, 'Motion: job iniciado');
      // Import TARDIO do pipeline (07/10/2026, cutover): `./pipeline.js` puxa
      // @remotion/renderer, @remotion/bundler e sharp — três addons NATIVOS.
      // Importado no topo, quem só precisa ENFILEIRAR (a API, via
      // `getMotionQueue`) arrastava o renderizador inteiro junto, e o esbuild
      // de apps/api quebrava em "No loader is configured for .node files" —
      // ou seja, a API não tinha build de produção nenhum, só `tsx` em dev.
      // Quem renderiza é o worker, e só aqui dentro: o custo nativo agora
      // pertence a quem de fato roda o render.
      // Caminho de PACOTE (não './pipeline.js'): import relativo o esbuild
      // resolve e embute no mesmo bundle, o que anularia a laziness. Pela
      // entrada pública, apps/api consegue marcá-la como `external` e nunca
      // carregá-la; o worker, que renderiza de verdade, a embute.
      const { runMotionPipeline } = await import('@desigual-os/otto-motion/pipeline');
      await withMotionLock(motionId, async () =>
        runMotionPipeline({ motionId, mode, instruction, deps: { logger } }),
      );
    },
    {
      connection: getRedisConnection(),
      concurrency: Number(process.env.OTTO_MOTION_CONCURRENCY ?? '2'),
      // Render de 30s em 1080x1920 passa fácil dos 30s de lock padrão do
      // BullMQ; sem isto o BullMQ consideraria o job abandonado no meio e
      // outro worker o pegaria — dois processos no mesmo workspace, que é
      // exatamente o que o §28 proíbe.
      lockDuration: 30 * 60 * 1000,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error(
      {
        motionId: job?.data.motionId,
        jobId: job?.id,
        code: isMotionError(error) ? error.code : 'INTERNAL',
        error: error.message,
      },
      'Motion: job falhou',
    );
  });

  worker.on('completed', (job) => {
    logger.info({ motionId: job.data.motionId, jobId: job.id }, 'Motion: job concluído');
  });

  return worker;
}
