import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePermission } from '../auth/middleware';
import { chatRequestSchema, submitChatTurn } from './turn-service';

/**
 * POST /chat — o canal web.
 *
 * O turno em si mora em ./turn-service.ts desde 16/10/2026, para o WhatsApp
 * do Bento andar pelo mesmo caminho. Aqui ficou só o que é da web: o JWT, a
 * permissão `chat:write` e o parse do corpo. O `reply` vai inteiro para o
 * serviço, que escolhe o status HTTP exatamente como antes.
 */
export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/chat',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const body = chatRequestSchema.parse(request.body);
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      return submitChatTurn(user, body, reply, request.log);
    },
  );
}
