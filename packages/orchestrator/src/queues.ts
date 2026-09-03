import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import type { AgentName, QueuePriority } from '@desigual-os/types';

/**
 * Timeout por agente (seção 6.7). Aplicado pelo worker como deadline da
 * chamada HTTP pro Node Agent, não como opção nativa do BullMQ (BullMQ não
 * tem "job timeout" embutido; quem impõe o limite é quem processa o job).
 */
export const AGENT_TIMEOUT_MS: Record<AgentName, number> = {
  bento: 120_000,
  jarbas: 180_000,
  suzy: 60_000,
  studio: 900_000,
};

// Menor número = maior prioridade no BullMQ.
export const PRIORITY_VALUE: Record<QueuePriority, number> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
};

export const MAX_ATTEMPTS = 2;

export interface AgentJobData {
  executionDbId: string;
  executionId: string;
  agent: AgentName;
  message: string;
  contextRefs: string[];
  conversationId: string | null;
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
    queue = new Queue<AgentJobData>(queueNameForAgent(agent), { connection: getRedisConnection() });
    queuesByAgent.set(agent, queue);
  }
  return queue;
}
