import { createLogger } from '@desigual-os/logging';
import { getRedisConnection } from './queues';

const CHANNEL = 'desigual-os:ws-events';
const logger = createLogger({ service: 'orchestrator-pubsub' });

export interface WsEvent {
  type: 'execution.progress' | 'execution.completed' | 'node.status' | 'studio.job.progress' | 'agent.thinking' | 'dm.received';
  payload: Record<string, unknown>;
}

/**
 * Canal WebSocket (seção 9) é servido pelo apps/api, mas quem gera os
 * eventos pode ser um processo totalmente separado na rede (studio-node,
 * numa máquina diferente). Redis pub/sub é o jeito mais simples de levar
 * o evento de um processo pro outro sem acoplar os dois.
 */
export async function publishWsEvent(event: WsEvent): Promise<void> {
  await getRedisConnection().publish(CHANNEL, JSON.stringify(event));
}

export function subscribeToWsEvents(onEvent: (event: WsEvent) => void): () => void {
  const subscriber = getRedisConnection().duplicate();
  // Sem isso, um erro de conexão nesse socket duplicado (Redis reiniciando,
  // rede instável) virava uma exceção não tratada e derrubava o processo
  // inteiro (api ou worker) — ioredis trata 'error' sem listener como
  // exceção fatal do Node, não como um evento que se pode simplesmente
  // ignorar.
  subscriber.on('error', (error) => {
    logger.error({ error }, 'Redis subscriber error');
  });
  subscriber.subscribe(CHANNEL).catch((error: unknown) => {
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
    void subscriber.unsubscribe(CHANNEL);
    void subscriber.quit();
  };
}
