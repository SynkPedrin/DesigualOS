import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import {
  checkChatGptConnection,
  checkClaudeConnection,
  getMotionStatus,
  isMotionError,
  ottoMotionEnabled,
  probeOpusModel,
  renderMotionAgain,
  updateMotion,
  userMessageFor,
} from '@desigual-os/otto-motion';
import { requireAuth } from '../auth/middleware';
import { hasClientAccess } from '../lib/access';

const logger = createLogger({ service: 'api:motion' });

const updateSchema = z.object({ instruction: z.string().min(3).max(4000) });

/**
 * Rotas do Otto Motion Engine.
 *
 * Registradas SEMPRE, mas cada uma checa a flag: com o Motion desligado, o
 * front recebe um 404 explícito em vez de o endpoint não existir. A diferença
 * importa em produção — "rota não existe" e "recurso desligado" mandam o
 * desenvolvedor procurar em lugares completamente diferentes.
 *
 * Leitura é liberada a quem tem acesso ao CLIENTE do motion, seguindo a mesma
 * regra do Studio (hasClientAccess): o workspace de um cliente é compartilhado
 * pela equipe, e um motion é peça do cliente, não do indivíduo.
 */
export async function registerMotionRoutes(app: FastifyInstance): Promise<void> {
  const disabled = (reply: { code: (status: number) => void }): { error: string } => {
    reply.code(404);
    return { error: 'Motion Engine desligado neste ambiente (OTTO_MOTION_ENABLED).' };
  };

  app.get<{ Params: { id: string } }>('/motion/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!ottoMotionEnabled()) return disabled(reply);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const [session] = await db
      .select({ clientId: schema.motionSessions.clientId })
      .from(schema.motionSessions)
      .where(eq(schema.motionSessions.id, request.params.id))
      .limit(1);

    if (!session) {
      reply.code(404);
      return { error: 'Motion não encontrado' };
    }
    if (!(await hasClientAccess(user, session.clientId))) {
      reply.code(403);
      return { error: 'Sem acesso a este cliente' };
    }

    const status = await getMotionStatus(request.params.id);
    if (!status) {
      reply.code(404);
      return { error: 'Motion não encontrado' };
    }
    return status;
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/motion/:id/update',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!ottoMotionEnabled()) return disabled(reply);
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const body = updateSchema.parse(request.body);

      const [session] = await db
        .select({ clientId: schema.motionSessions.clientId })
        .from(schema.motionSessions)
        .where(eq(schema.motionSessions.id, request.params.id))
        .limit(1);
      if (!session) {
        reply.code(404);
        return { error: 'Motion não encontrado' };
      }
      if (!(await hasClientAccess(user, session.clientId))) {
        reply.code(403);
        return { error: 'Sem acesso a este cliente' };
      }

      try {
        await updateMotion(
          { motionId: request.params.id, instruction: body.instruction, requestedBy: user.id, executionId: null },
          logger,
        );
        return await getMotionStatus(request.params.id);
      } catch (error) {
        // §26 — nunca devolve stack. Código estável + texto que a UI mostra.
        reply.code(isMotionError(error) && error.code === 'OPUS_UNAVAILABLE' ? 503 : 400);
        return { error: userMessageFor(error), code: isMotionError(error) ? error.code : 'INTERNAL' };
      }
    },
  );

  app.post<{ Params: { id: string } }>('/motion/:id/render', { preHandler: requireAuth }, async (request, reply) => {
    if (!ottoMotionEnabled()) return disabled(reply);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [session] = await db
      .select({ clientId: schema.motionSessions.clientId })
      .from(schema.motionSessions)
      .where(eq(schema.motionSessions.id, request.params.id))
      .limit(1);
    if (!session) {
      reply.code(404);
      return { error: 'Motion não encontrado' };
    }
    if (!(await hasClientAccess(user, session.clientId))) {
      reply.code(403);
      return { error: 'Sem acesso a este cliente' };
    }

    try {
      await renderMotionAgain(request.params.id, logger);
      return await getMotionStatus(request.params.id);
    } catch (error) {
      reply.code(400);
      return { error: userMessageFor(error), code: isMotionError(error) ? error.code : 'INTERNAL' };
    }
  });

  /**
   * §38 — estado dos providers.
   *
   * Sem custo: `claude --version` + `claude auth status`, que não chamam a
   * API. A prova cara (um turno real no Opus 5.5) está em /test, atrás de um
   * clique.
   */
  app.get('/motion/providers', { preHandler: requireAuth }, async (request, reply) => {
    if (!ottoMotionEnabled()) return disabled(reply);
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [claude, chatgpt] = [await checkClaudeConnection(), checkChatGptConnection()];
    return { providers: [claude, chatgpt], motion_enabled: true };
  });

  app.post('/motion/providers/claude/test', { preHandler: requireAuth }, async (request, reply) => {
    if (!ottoMotionEnabled()) return disabled(reply);
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    return { provider: await probeOpusModel() };
  });
}
