import { createLogger } from '@desigual-os/logging';
import { getRedisConnection } from './queues';

/**
 * P1-07 (release readiness audit, 22/09/2026): Redis PUB/SUB não respeita o
 * número de banco (`SELECT`/DB da URL) — é global no servidor Redis inteiro,
 * ao contrário de toda outra chave (BullMQ, cache). QA aponta pra
 * `redis://localhost:6380/1`, produção pra DB 0, e mesmo assim os dois
 * publicavam no MESMO canal fixo `desigual-os:ws-events` — evento de teste
 * chegava na UI de produção de verdade (E18).
 *
 * O número de banco já é a fronteira que este projeto usa hoje pra separar
 * QA de produção (mesma REDIS_URL, DB diferente) — reaproveitar esse mesmo
 * número no NOME do canal fecha o isolamento sem inventar variável de
 * ambiente nova nem configuração paralela que possa divergir da real.
 */
export function redisNamespace(url: string): string {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, '');
    return db && /^\d+$/.test(db) ? `db${db}` : 'db0';
  } catch {
    return 'db0';
  }
}

export function wsEventsChannel(): string {
  return `desigual-os:${redisNamespace(process.env.REDIS_URL ?? 'redis://localhost:6379')}:ws-events`;
}

const logger = createLogger({ service: 'orchestrator-pubsub' });

export interface WsEvent {
  type:
    | 'execution.progress'
    | 'execution.completed'
    | 'node.status'
    | 'studio.job.progress'
    | 'agent.thinking'
    | 'dm.received'
    | 'message.delta'
    | 'clickup.task_changed'
    // Agentic V2: transição de fase do agent loop (UNDERSTANDING, ACTING,
    // EVALUATING, REPLANNING...). Alimenta os indicadores de atividade da
    // UI com eventos REAIS em vez de etapas inventadas.
    | 'agent.phase';
  payload: Record<string, unknown>;
}

/**
 * Canal WebSocket (seção 9) é servido pelo apps/api, mas quem gera os
 * eventos pode ser um processo totalmente separado na rede (studio-node,
 * numa máquina diferente). Redis pub/sub é o jeito mais simples de levar
 * o evento de um processo pro outro sem acoplar os dois.
 */
export async function publishWsEvent(event: WsEvent): Promise<void> {
  await getRedisConnection().publish(wsEventsChannel(), JSON.stringify(event));
}

export function subscribeToWsEvents(onEvent: (event: WsEvent) => void): () => void {
  const channel = wsEventsChannel();
  const subscriber = getRedisConnection().duplicate();
  // Sem isso, um erro de conexão nesse socket duplicado (Redis reiniciando,
  // rede instável) virava uma exceção não tratada e derrubava o processo
  // inteiro (api ou worker) - ioredis trata 'error' sem listener como
  // exceção fatal do Node, não como um evento que se pode simplesmente
  // ignorar.
  subscriber.on('error', (error) => {
    logger.error({ error }, 'Redis subscriber error');
  });
  subscriber.subscribe(channel).catch((error: unknown) => {
    logger.error({ error }, 'Failed to subscribe to WS events channel');
  });
  subscriber.on('message', (_channel, message) => {
    try {
      onEvent(JSON.parse(message) as WsEvent);
    } catch {
      // mensagem não é um WsEvent válido, ignora
    }
  });

  return () => {
    void subscriber.unsubscribe(channel);
    void subscriber.quit();
  };
}
