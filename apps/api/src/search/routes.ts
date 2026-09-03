import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';

const searchQuerySchema = z.object({ q: z.string().min(1) });

/**
 * Busca geral (pedido do usuário): usuários, clientes e agentes num só
 * lugar. Sem full-text search dedicado por enquanto, ILIKE cobre o volume
 * atual de dados da agência.
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q: string } }>('/search', { preHandler: requireAuth }, async (request) => {
    const { q } = searchQuerySchema.parse(request.query);
    const pattern = `%${q}%`;

    const [users, clients, agents] = await Promise.all([
      db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl })
        .from(schema.users)
        .where(and(isNull(schema.users.deletedAt), ilike(schema.users.name, pattern)))
        .limit(10),
      db
        .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
        .from(schema.clients)
        .where(and(isNull(schema.clients.deletedAt), ilike(schema.clients.name, pattern)))
        .limit(10),
      db
        .select({ id: schema.agents.id, name: schema.agents.name, displayName: schema.agents.displayName })
        .from(schema.agents)
        .where(and(eq(schema.agents.active, true), ilike(schema.agents.displayName, pattern)))
        .limit(10),
    ]);

    return {
      users: users.map((user) => ({ id: user.id, name: user.name, email: user.email, avatar_url: user.avatarUrl })),
      clients: clients.map((client) => ({ id: client.id, name: client.name, slug: client.slug })),
      agents: agents.map((agent) => ({ id: agent.id, name: agent.name, display_name: agent.displayName })),
    };
  });
}
