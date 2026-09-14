import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import type { AgentName, QueuePriority, StudioReferenceAsset } from '@desigual-os/types';

/**
 * Timeout por agente (seção 6.7). Aplicado pelo worker como deadline da
 * chamada HTTP pro Node Agent, não como opção nativa do BullMQ (BullMQ não
 * tem "job timeout" embutido; quem impõe o limite é quem processa o job).
 */
export const AGENT_TIMEOUT_MS: Record<AgentName, number> = {
  bento: 120_000,
  jarbas: 180_000,
  // Suzy fala com o MESMO serviço (agentes-desigual/susy-service, porta
  // 3102) e protocolo que o Jarbas, só que respondia em 60s - o timeout mais
  // curto de todos, justamente no agente de atendimento em tempo real
  // (WhatsApp). Igualado ao Jarbas em 07/09/2026: não há razão pro mesmo
  // backend precisar de 1/3 do tempo aqui.
  suzy: 180_000,
  // 25min (era 15min): medido ao vivo em 08/09/2026 que o passo de vídeo H3
  // sozinho já leva 13-14min real na 4090 (bem acima do "~7min" documentado
  // no h3gen.py), e isso vem DEPOIS do hero frame Flux - 15min não sobrava
  // margem nenhuma pro pipeline completo. Casa com o lockDuration do worker
  // BullMQ em nodes/studio-node/src/index.ts - mudar um sem o outro reabre
  // o mesmo problema.
  studio: 1_500_000,
  // Raciocínio criativo do Otto roda em LLM local via Ollama: bem mais lento
  // que as chamadas HTTP simples de bento/jarbas/suzy, mas sem render de GPU
  // (isso é trabalho do Studio, pra quem o Otto delega a execução visual).
  //
  // 360s, e precisa ser ESTRITAMENTE MAIOR que o OTTO_LLM_TIMEOUT_MS da máquina
  // do Otto (hoje 300_000 no .env dela). Os dois eram 300_000 iguais, e empate
  // aqui é o pior caso: o AbortSignal deste lado derrubava o socket no mesmo
  // instante em que o node ia responder, então o node NUNCA conseguia devolver
  // um `status: failed` com motivo - virava erro de conexão sem explicação.
  // Medido ao vivo em 08/09/2026 (briefing da Fratelli): tentativa 1 abortou em
  // 300_052ms e a resposta real, de 4.292 chars, só chegou na tentativa 2.
  // Quem tem que estourar primeiro é sempre o lado de dentro, que sabe o motivo.
  otto: 360_000,
};

// Menor número = maior prioridade no BullMQ.
export const PRIORITY_VALUE: Record<QueuePriority, number> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
};

export const MAX_ATTEMPTS = 2;

/**
 * Teto de retenção do histórico de jobs no Redis (achado da auditoria de
 * prontidão, 2026-09-11): sem defaultJobOptions, jobs completed/failed
 * acumulavam sem limite nenhum. Número = "guarda só os N mais recentes"
 * (BullMQ 5, ver BaseJobOptions.removeOnComplete/removeOnFail). O estado
 * autoritativo da execução vive no Postgres (executions/execution_steps),
 * então encurtar o histórico do Redis não apaga rastro de verdade. Failed
 * fica com teto maior porque é o que se consulta pra diagnosticar.
 */
const DEFAULT_JOB_OPTIONS = { removeOnComplete: 100, removeOnFail: 500 } as const;

/**
 * Tentativas do BullMQ por agente. Jarbas e Suzy são exceção: quando o
 * agentes-desigual devolve falha, não dá pra garantir que o efeito colateral
 * real (mensagem enviada de verdade pro WhatsApp do lead via answerQuestion)
 * não tenha acontecido do lado dele antes do erro voltar pra cá - um retry
 * automático pode disparar uma SEGUNDA mensagem real pro mesmo lead. Sem
 * idempotência garantida pelo lado deles (serviço fora deste repo), a opção
 * segura é não reenfileirar sozinho: falha uma vez só, e quem decide
 * reenviar é gente, não o BullMQ. Os demais agentes (bento, otto, studio)
 * não têm esse efeito colateral e mantêm o retry padrão.
 */
export const AGENT_MAX_ATTEMPTS: Record<AgentName, number> = {
  bento: MAX_ATTEMPTS,
  jarbas: 1,
  suzy: 1,
  studio: MAX_ATTEMPTS,
  otto: MAX_ATTEMPTS,
};

export interface AgentJobData {
  executionDbId: string;
  executionId: string;
  agent: AgentName;
  message: string;
  contextRefs: string[];
  /** Referências do turno, preservadas até o node e em handoffs criativos. */
  attachments?: StudioReferenceAsset[];
  conversationId: string | null;
  /** Dado operacional AO VIVO já apurado pelo Orquestrador (escopo resolvido + consulta
   * real ao ClickUp). Viaja SEPARADO da mensagem porque o backend do Bento usa a mensagem
   * inteira como consulta vetorial e o detector de ClickUp dele intercepta pedindo cliente
   * quando o dado cita vários — ver askBentoComContextoOperacional no bento-qa. */
  operationalContext?: string;
  // Presentes só quando este job é uma etapa de workflow (Fase 10).
  workflowId?: string;
  stepIndex?: number;
}

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  connection ??= new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  return connection;
}

const queuesByAgent = new Map<AgentName, Queue<AgentJobData>>();

// O prompt mestre (seção 6.7) nomeia as filas "queue:bento" etc, mas o
// BullMQ rejeita ':' em nome de fila de verdade (erro real ao subir o
// worker: "Queue name cannot contain :"). Usando hífen, mesma intenção.
export function queueNameForAgent(agent: AgentName): string {
  return `queue-${agent}`;
}

export function getAgentQueue(agent: AgentName): Queue<AgentJobData> {
  let queue = queuesByAgent.get(agent);
  if (!queue) {
    queue = new Queue<AgentJobData>(queueNameForAgent(agent), {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queuesByAgent.set(agent, queue);
  }
  return queue;
}
