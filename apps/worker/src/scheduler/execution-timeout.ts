import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { Logger } from '@desigual-os/logging';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { AGENT_TIMEOUT_MS, getAgentQueue, publishWsEvent } from '@desigual-os/orchestrator';

/**
 * execution-timeout.ts — uma execução de agente não pode ficar viva pra sempre.
 *
 * Achado real (18/09/2026, consulta ao banco de produção): DOZE execuções
 * presas, a mais antiga havia 326 horas (13,6 dias) — oito em `running` e
 * quatro em `queued`, de bento, otto e jarbas. Não havia nada no sistema que
 * expirasse execução: o Studio ganhou o seu vigia em 16/09
 * (studio-queue-timeout.ts), mas o caminho dos AGENTES ficou de fora.
 *
 * O que isso custava na tela: o chat lê o último step da execution pra montar
 * a bolha, e execução sem desfecho não tem step nenhum — a pessoa ficava com o
 * indicador de "pensando" aceso indefinidamente, sem erro e sem resposta. E o
 * resumo diário contava essas doze como trabalho em andamento todo dia.
 *
 * Por que uma execução chega nesse estado: o worker morreu no meio do job
 * (SIGKILL, deploy, falta de memória, `uncaughtException`), ou o Redis perdeu a
 * fila. Em qualquer um dos casos ninguém sobrou pra escrever o desfecho — é
 * justamente por isso que quem conserta tem que ser um processo de FORA da
 * execução, e não a própria.
 *
 * A decisão de expirar usa o mesmo princípio já provado no Studio: em vez de
 * chutar um tempo, pergunta ao BullMQ se existe worker conectado naquela fila.
 * Sem worker, não há o que esperar. Com worker, a tolerância é longa — a fila
 * do Otto roda com `concurrency: 1` e um turno criativo legítimo leva minutos.
 */

/** Terminal, e distinto de `failed`: quem lê o histórico precisa saber que ninguém respondeu. */
const STATUS_EXPIRADO = 'timeout' as const;

/** Estados não terminais que este vigia observa. */
const ESTADOS_EM_VOO = ['pending', 'queued', 'running'] as const;

/**
 * Sem worker conectado naquela fila: curto de propósito. Não é zero porque um
 * restart do worker (deploy, reboot) leva alguns segundos e não pode reprovar
 * execução recém-enfileirada.
 */
const SEM_WORKER_MS = 3 * 60_000;

/**
 * Com worker conectado, a tolerância sai do timeout REAL daquele agente
 * (AGENT_TIMEOUT_MS, o mesmo deadline que o worker aplica na chamada HTTP ao
 * node), multiplicado pelas tentativas possíveis e com folga. Se passou disso,
 * não é lentidão: é execução órfã. O Studio tem 25 minutos de deadline, então
 * o número sai grande pra ele e pequeno pro Bento — que é o certo.
 */
const FATOR_DE_FOLGA = 3;
const PISO_COM_WORKER_MS = 10 * 60_000;

export function limiteComWorkerMs(agent: AgentName): number {
  return Math.max(PISO_COM_WORKER_MS, AGENT_TIMEOUT_MS[agent] * FATOR_DE_FOLGA);
}

export const MENSAGEM_SEM_WORKER =
  'A execução não pôde ser concluída: nenhum worker estava conectado para processá-la. O processo do worker provavelmente caiu ou foi reiniciado.';

export const MENSAGEM_ORFA =
  'A execução não pôde ser concluída: ela passou do tempo máximo sem nenhum desfecho registrado. O worker que a processava provavelmente morreu no meio.';

export interface ResultadoDaExpiracao {
  expiradas: number;
  executionIds: string[];
  /** Por agente: quantos workers o BullMQ reportou conectados naquela fila. */
  workersPorAgente: Record<string, number>;
}

/** Quantos workers estão consumindo a fila de cada agente, agora. */
async function workersPorAgente(logger: Logger): Promise<Map<AgentName, number> | null> {
  const mapa = new Map<AgentName, number>();
  for (const agent of AGENT_NAMES) {
    try {
      mapa.set(agent, (await getAgentQueue(agent).getWorkers()).length);
    } catch (error) {
      // Redis fora do ar: sem sinal confiável NÃO se reprova nada. Um falso
      // positivo aqui mataria execução boa por problema de rede do vigia.
      logger.warn({ error, agent }, 'execution-timeout: não consegui listar workers - pulando esta rodada');
      return null;
    }
  }
  return mapa;
}

/**
 * Escreve o desfecho que o worker morto não escreveu: status terminal, step de
 * falha (senão a bolha do chat fica vazia — ver failExecution em
 * execute-job.ts), evento no WS e notificação pra quem pediu.
 *
 * O UPDATE é CONDICIONAL ao estado ainda ser não terminal. Entre o SELECT e o
 * UPDATE um worker pode ter voltado e concluído a execução de verdade; nesse
 * caso a linha não é tocada e o resto é pulado. Sem essa condição, o vigia
 * sobrescreveria uma resposta boa com um timeout inventado.
 */
async function expirarUma(
  execucao: { id: string; executionId: string; agent: AgentName; userId: string },
  motivo: string,
): Promise<boolean> {
  const agora = new Date();
  const atualizadas = await db
    .update(schema.executions)
    .set({ status: STATUS_EXPIRADO, completedAt: agora })
    .where(and(eq(schema.executions.id, execucao.id), inArray(schema.executions.status, [...ESTADOS_EM_VOO])))
    .returning({ id: schema.executions.id });
  if (atualizadas.length === 0) return false;

  // Mesma convenção de failExecution: só cria o step 0 quando não existe step
  // nenhum. Execução de workflow que completou etapas antes de orfanar mantém
  // o que já tinha — sobrescrever apagaria trabalho que deu certo.
  const [existente] = await db
    .select({ stepIndex: schema.executionSteps.stepIndex })
    .from(schema.executionSteps)
    .where(eq(schema.executionSteps.executionId, execucao.id))
    .limit(1);
  if (!existente) {
    await db
      .insert(schema.executionSteps)
      .values({
        executionId: execucao.id,
        stepIndex: 0,
        agent: execucao.agent,
        status: 'failed',
        output: { answer: `Não consegui responder agora: ${motivo}`, sources: [] },
        startedAt: agora,
        completedAt: agora,
      })
      .onConflictDoNothing({ target: [schema.executionSteps.executionId, schema.executionSteps.stepIndex] });
  }

  await publishWsEvent({
    type: 'execution.completed',
    payload: { execution_id: execucao.executionId, agent: execucao.agent, status: STATUS_EXPIRADO },
  });

  await db.insert(schema.notifications).values({
    userId: execucao.userId,
    type: 'execution.failed',
    title: `${execucao.agent} não concluiu uma solicitação sua`,
    body: motivo,
    link: '/chat',
  });

  return true;
}

export async function expireStaleExecutions(logger: Logger): Promise<ResultadoDaExpiracao> {
  const workers = await workersPorAgente(logger);
  if (!workers) return { expiradas: 0, executionIds: [], workersPorAgente: {} };

  const vazio: ResultadoDaExpiracao = {
    expiradas: 0,
    executionIds: [],
    workersPorAgente: Object.fromEntries(workers),
  };

  // O piso de idade é o MENOR limite possível; o filtro fino (por agente) vem
  // logo abaixo. Uma varredura só, em vez de uma por agente.
  const pisoMs = Math.min(SEM_WORKER_MS, ...AGENT_NAMES.map((a) => limiteComWorkerMs(a)));
  const candidatas = await db
    .select({
      id: schema.executions.id,
      executionId: schema.executions.executionId,
      agent: schema.executions.agent,
      userId: schema.executions.userId,
      status: schema.executions.status,
      // `started_at` é o relógio certo pra quem já começou; quem nunca saiu da
      // fila só tem `created_at`.
      desde: sql<Date>`coalesce(${schema.executions.startedAt}, ${schema.executions.createdAt})`,
    })
    .from(schema.executions)
    .where(
      and(
        inArray(schema.executions.status, [...ESTADOS_EM_VOO]),
        // A comparação inteira vai em SQL cru, com o instante já em ISO e
        // tipado como timestamptz.
        //
        // Por que não `lt(sql\`coalesce(...)\`, new Date(...))`: foi assim que
        // isto nasceu, e o reaper QUEBROU A CADA 2 MINUTOS em produção com
        // "The string argument must be of type string... Received an instance
        // of Date". Com o lado esquerdo sendo SQL cru, o Drizzle não tem a
        // coluna pra descobrir como serializar o Date, e entrega o objeto puro
        // ao driver. O teste unitário não pegava porque o banco é mockado - só
        // a fila real mostrou (226 jobs `failed` na daily-digest).
        sql`coalesce(${schema.executions.startedAt}, ${schema.executions.createdAt}) < ${new Date(
          Date.now() - pisoMs,
        ).toISOString()}::timestamptz`,
      ),
    )
    .limit(200);

  if (candidatas.length === 0) return vazio;

  const executionIds: string[] = [];
  for (const candidata of candidatas) {
    const temWorker = (workers.get(candidata.agent) ?? 0) > 0;
    const limiteMs = temWorker ? limiteComWorkerMs(candidata.agent) : SEM_WORKER_MS;
    const idadeMs = Date.now() - new Date(candidata.desde).getTime();
    if (idadeMs < limiteMs) continue;

    const motivo = temWorker ? MENSAGEM_ORFA : MENSAGEM_SEM_WORKER;
    if (await expirarUma(candidata, motivo)) executionIds.push(candidata.executionId);
  }

  if (executionIds.length > 0) {
    logger.warn({ expiradas: executionIds.length, executionIds }, 'execution-timeout: execuções órfãs expiradas');
    await db.insert(schema.auditLogs).values({
      action: 'execution.timeout_reaped',
      result: 'failed',
      metadata: { execution_ids: executionIds, workers_por_agente: Object.fromEntries(workers) },
    });
  }

  return { expiradas: executionIds.length, executionIds, workersPorAgente: Object.fromEntries(workers) };
}

/** Exportado só pro teste: evita repetir os números mágicos na asserção. */
export const LIMITES_MS = { semWorker: SEM_WORKER_MS, pisoComWorker: PISO_COM_WORKER_MS, fator: FATOR_DE_FOLGA };
