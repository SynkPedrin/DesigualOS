import { db, schema } from '@desigual-os/database';
import { and, eq, lt, notInArray, type SQL } from 'drizzle-orm';
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

/**
 * Estados terminais de studio_jobs.status. Tudo que NÃO está aqui e não é
 * `queued` é um job que já estava sendo gerado (`rendering`, `quality_check`,
 * `uploading`, os estágios de vídeo...).
 */
export const STATUS_TERMINAIS = ['completed', 'failed', 'cancelled'] as const;

/**
 * Teto para job que já COMEÇOU a gerar e parou de dar sinal.
 *
 * O caso que faltava: o `queued` acima cobre "ninguém pegou o job". Não cobria
 * "alguém pegou e morreu no meio". O próprio studio-node registra o sintoma no
 * comentário do `uncaughtException` (16/09/2026): o processo saiu com código 1
 * duas vezes durante uma geração e o job ficou preso em `rendering`. O
 * `worker.on('failed')` de lá só ESCREVE LOG - quando o BullMQ desiste de um
 * job travado, nada atualiza a linha do Postgres, porque o processo que faria
 * isso é justamente o que morreu.
 *
 * O número sai do `lockDuration` do studio-node (25 min): até ele expirar, o
 * BullMQ ainda considera o job vivo e pode reentregá-lo a um worker novo -
 * reprovar antes disso mataria um job que ia se recuperar sozinho. Depois de
 * duas janelas de lock sem nenhuma mudança de progresso, não há recuperação
 * vindo: ninguém está com ele.
 */
const RENDERIZANDO_TRAVADO_MS = 55 * 60 * 1000;

/**
 * "Já saiu da fila e ainda não terminou" — `rendering`, `quality_check`,
 * `uploading`, os estágios de vídeo. Definido por exclusão de propósito: o
 * pipeline ganha estágio novo sem que ninguém precise lembrar de atualizar
 * uma lista aqui (ver STUDIO_JOB_STATUSES em packages/types/src/studio.ts).
 */
const EM_VOO = notInArray(schema.studioJobs.status, [...STATUS_TERMINAIS, 'queued']);

export const MENSAGEM_TRAVADO_RENDERIZANDO =
  'A geração parou de dar sinal de vida e não foi retomada por nenhum worker. A máquina do Studio provavelmente reiniciou no meio do trabalho. Nada foi cobrado - pode pedir de novo.';

export const MENSAGEM_SEM_WORKER =
  'No available Studio worker. A máquina de geração do Studio não está conectada - nenhum worker consumindo a fila. Avise o responsável pela máquina da GPU.';

const MENSAGEM_ESPERA_LONGA =
  'O job ficou na fila além do tempo máximo mesmo com worker conectado. A fila pode estar travada - confira o estado do studio-node e do ComfyUI.';

export interface ResultadoDoTimeout {
  workersConectados: number;
  expirados: number;
  jobIds: string[];
  /** Jobs que já estavam gerando e ficaram órfãos (worker morto no meio). */
  orfaos: number;
}

/** Escreve o desfecho de um job que ninguém vai mais concluir. */
async function reprovarJob(
  job: { jobId: string; requestedBy: string | null; progress: number },
  motivo: string,
  aindaElegivel: SQL,
): Promise<boolean> {
  // Condicional no status: se o job mudou entre o SELECT e agora (um worker
  // pegou de verdade, ou terminou), não sobrescreve o progresso real com uma
  // falha inventada.
  const atualizados = await db
    .update(schema.studioJobs)
    .set({ status: 'failed', error: motivo })
    .where(and(eq(schema.studioJobs.jobId, job.jobId), aindaElegivel))
    .returning({ jobId: schema.studioJobs.jobId });
  if (atualizados.length === 0) return false;

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
  return true;
}

/**
 * Jobs que JÁ ESTAVAM GERANDO e pararam de dar sinal.
 *
 * Duas condições, e as duas precisam valer — cada uma sozinha produz falso
 * positivo:
 *
 *   1. o job não está `active` no BullMQ. Se estiver, um worker está com ele
 *      agora e a geração é legítima, por mais demorada que seja;
 *   2. a linha não é tocada há mais que uma janela de lock com folga. O
 *      studio-node escreve progresso a cada etapa, então `updated_at` parado é
 *      ausência de sinal de verdade — não lentidão.
 *
 * (A condição 2 só virou sinal confiável depois da correção do `$onUpdate` em
 * `timestampColumns`; antes disso `updated_at` nunca mudava em UPDATE nenhum.)
 */
async function expirarOrfaosEmRenderizacao(
  queue: ReturnType<typeof getStudioJobQueue>,
  logger: Logger,
): Promise<string[]> {
  const limite = new Date(Date.now() - RENDERIZANDO_TRAVADO_MS);

  const travados = await db
    .select({ jobId: schema.studioJobs.jobId, requestedBy: schema.studioJobs.requestedBy, progress: schema.studioJobs.progress })
    .from(schema.studioJobs)
    .where(
      and(EM_VOO, lt(schema.studioJobs.updatedAt, limite)),
    )
    .limit(100);

  if (travados.length === 0) return [];

  // Quem está `active` AGORA está sendo gerado de verdade: intocável.
  let ativos: Set<string>;
  try {
    const jobsAtivos = await queue.getJobs(['active'], 0, 1000);
    ativos = new Set(jobsAtivos.map((j) => j.data?.jobId).filter((id): id is string => typeof id === 'string'));
  } catch (error) {
    logger.warn({ error }, 'studio-queue-timeout: não consegui listar jobs ativos - não reprovo órfão sem esse sinal');
    return [];
  }

  const reprovados: string[] = [];
  for (const job of travados) {
    if (ativos.has(job.jobId)) continue;
    // Mesma condição do SELECT: continua em voo (nem terminal, nem na fila).
    if (await reprovarJob(job, MENSAGEM_TRAVADO_RENDERIZANDO, EM_VOO)) {
      reprovados.push(job.jobId);
    }
  }

  if (reprovados.length > 0) {
    logger.warn({ orfaos: reprovados.length, jobIds: reprovados }, 'studio-queue-timeout: gerações órfãs reprovadas (worker morreu no meio)');
    await db.insert(schema.auditLogs).values({
      action: 'studio.job.render_orphaned',
      agent: 'studio',
      result: 'failed',
      metadata: { job_ids: reprovados, timeout_ms: RENDERIZANDO_TRAVADO_MS },
    });
  }
  return reprovados;
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
    return { workersConectados: 0, expirados: 0, jobIds: [], orfaos: 0 };
  }

  const orfaos = await expirarOrfaosEmRenderizacao(queue, logger);

  const limiteMs = workersConectados > 0 ? COM_WORKER_TIMEOUT_MS : SEM_WORKER_TIMEOUT_MS;
  const limite = new Date(Date.now() - limiteMs);

  const parados = await db
    .select({ jobId: schema.studioJobs.jobId, requestedBy: schema.studioJobs.requestedBy, progress: schema.studioJobs.progress })
    .from(schema.studioJobs)
    .where(and(eq(schema.studioJobs.status, 'queued'), lt(schema.studioJobs.createdAt, limite)));

  if (parados.length === 0) {
    return { workersConectados, expirados: orfaos.length, jobIds: orfaos, orfaos: orfaos.length };
  }

  const motivo = workersConectados > 0 ? MENSAGEM_ESPERA_LONGA : MENSAGEM_SEM_WORKER;
  const jobIds: string[] = [];

  for (const job of parados) {
    // Tira da fila ANTES de marcar falhado: se um worker aparecer no meio
    // desta varredura, é melhor ele já não encontrar o job do que gerar
    // uma imagem pra um job que o usuário verá como falhada.
    await removeQueuedStudioJob(job.jobId);
    if (await reprovarJob(job, motivo, eq(schema.studioJobs.status, 'queued'))) jobIds.push(job.jobId);
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

  return {
    workersConectados,
    expirados: jobIds.length + orfaos.length,
    jobIds: [...jobIds, ...orfaos],
    orfaos: orfaos.length,
  };
}

/** Exportado só pro teste: evita repetir os números mágicos na asserção. */
export const TIMEOUTS_MS = {
  semWorker: SEM_WORKER_TIMEOUT_MS,
  comWorker: COM_WORKER_TIMEOUT_MS,
  renderizandoTravado: RENDERIZANDO_TRAVADO_MS,
};
