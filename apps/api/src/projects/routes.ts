import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth, requirePermission } from '../auth/middleware';

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  client_id: z.string().uuid().nullable().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  client_id: z.string().uuid().nullable().optional(),
});

function toWire(project: typeof schema.projects.$inferSelect) {
  return {
    id: project.id,
    name: project.name,
    client_id: project.clientId,
    created_by: project.createdBy,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}

/**
 * Projetos do Chat (a seção "Projetos" da sidebar, estilo Claude): estrutura de
 * organização compartilhada pela equipe inteira — qualquer colaborador vê todos
 * os projetos e qualquer um com chat:write cria/edita. A privacidade mora nas
 * CONVERSAS (visibility em conversations), não no projeto.
 */
export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', { preHandler: requireAuth }, async () => {
    const rows = await db.select().from(schema.projects).orderBy(asc(schema.projects.name));
    return { projects: rows.map(toWire) };
  });

  app.post('/projects', { preHandler: [requireAuth, requirePermission('chat', 'write')] }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    if (body.client_id) {
      const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, body.client_id));
      if (!client) {
        reply.code(404);
        return { error: `Client '${body.client_id}' not found` };
      }
    }

    const [project] = await db
      .insert(schema.projects)
      .values({ name: body.name.trim(), clientId: body.client_id ?? null, createdBy: user.id })
      .returning();
    reply.code(201);
    return { project: toWire(project!) };
  });

  app.patch<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const body = updateProjectSchema.parse(request.body);

      if (body.client_id) {
        const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, body.client_id));
        if (!client) {
          reply.code(404);
          return { error: `Client '${body.client_id}' not found` };
        }
      }

      const [project] = await db
        .update(schema.projects)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.client_id !== undefined ? { clientId: body.client_id } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, request.params.id))
        .returning();
      if (!project) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      return { project: toWire(project) };
    },
  );

  // Apagar um projeto NUNCA apaga as conversas dele: elas só voltam pra seção
  // "Conversas" soltas da sidebar (project_id = null).
  app.delete<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, request.params.id));
      if (!project) {
        reply.code(404);
        return { error: `Project '${request.params.id}' not found` };
      }
      await db.update(schema.conversations).set({ projectId: null }).where(eq(schema.conversations.projectId, request.params.id));
      await db.delete(schema.projects).where(eq(schema.projects.id, request.params.id));
      reply.code(204);
      return null;
    },
  );
}
