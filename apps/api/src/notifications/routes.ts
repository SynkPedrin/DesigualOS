import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';

/**
 * Checklist de fim de dia e resumo de manhã (apps/worker/src/scheduler) só
 * viram informação de verdade pro colaborador se ele conseguir ler isso;
 * é exatamente o "dia a dia útil" pedido pelo usuário, não métrica.
 */
export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { unread_only?: string } }>('/notifications', { preHandler: requireAuth }, async (request) => {
    const userId = request.authUser?.id ?? '';
    const onlyUnread = request.query.unread_only === 'true';

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(onlyUnread ? and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)) : eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(30);

    return {
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        read: row.readAt !== null,
        created_at: row.createdAt.toISOString(),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/notifications/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const [notification] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, request.params.id));
    if (!notification) {
      reply.code(404);
      return { error: `Notification '${request.params.id}' not found` };
    }
    if (notification.userId !== request.authUser?.id) {
      reply.code(403);
      return { error: 'Not allowed to update this notification' };
    }

    await db.update(schema.notifications).set({ readAt: new Date() }).where(eq(schema.notifications.id, request.params.id));
    return { id: request.params.id, read: true };
  });
}
