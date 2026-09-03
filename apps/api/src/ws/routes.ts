import type { FastifyInstance } from 'fastify';
import { subscribeToWsEvents } from '@desigual-os/orchestrator';

/**
 * Canal WebSocket único (seção 9): execution.progress, execution.completed,
 * node.status, studio.job.progress, agent.thinking. Broadcast simples pra
 * todo cliente conectado no MVP; filtrar por usuário/cliente é refinamento
 * futuro (não tem sessão por conexão WS ainda, só REST tem auth).
 */
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  const clients = new Set<{ send: (data: string) => void; readyState: number }>();

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
  });

  subscribeToWsEvents((event) => {
    const message = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  });
}
