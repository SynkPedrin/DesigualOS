import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { registerAutomationJob, removeAutomationJob } from '@desigual-os/orchestrator';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';

const createAutomationSchema = z.object({
  name: z.string().min(1),
  agent: z.enum([...AGENT_NAMES] as [AgentName, ...AgentName[]]),
  prompt: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  schedule: z.string().min(1),
  schedule_label: z.string().min(1),
});

const updateAutomationSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z.string().min(1).optional(),
  schedule_label: z.string().min(1).optional(),
});

function serializeAutomation(row: typeof schema.automations.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    agent: row.agent,
    prompt: row.prompt,
    client_id: row.clientId,
    conversation_id: row.conversationId,
    schedule: row.schedule,
    schedule_label: row.scheduleLabel,
    enabled: row.enabled,
    last_run_at: row.lastRunAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Automação agendada (pedido do usuário, 2026-09-03): "todo dia às 8h o
 * Bento analisa o ClickUp...". Compartilhada pela equipe, igual ao chat —
 * qualquer master/colaborador com `chat:write` cria, vê e gerencia
 * qualquer automação, não só as próprias.
 */
export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/automations', { preHandler: requireAuth }, async () => {
    const rows = await db.select().from(schema.automations).orderBy(desc(schema.automations.createdAt));
    return { automations: rows.map(serializeAutomation) };
  });

  app.post(
    '/automations',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const body = createAutomationSchema.parse(request.body);
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const [conversation] = await db
        .insert(schema.conversations)
        .values({ userId: user.id, clientId: body.client_id ?? null, title: `Automação: ${body.name}` })
        .returning();

      const [automation] = await db
        .insert(schema.automations)
        .values({
          name: body.name,
          createdBy: user.id,
          agent: body.agent,
          prompt: body.prompt,
          clientId: body.client_id ?? null,
          conversationId: conversation?.id ?? null,
          schedule: body.schedule,
          scheduleLabel: body.schedule_label,
        })
        .returning();

      if (!automation) {
        reply.code(500);
        return { error: 'Failed to create automation' };
      }

      try {
        await registerAutomationJob(automation.id, automation.schedule);
      } catch (error) {
        // Cron inválido só é descoberto aqui (BullMQ/cron-parser validam o pattern
        // de verdade); sem isso a automação ficava salva mas nunca disparava.
        await db.delete(schema.automations).where(eq(schema.automations.id, automation.id));
        reply.code(400);
        return { error: `Agenda inválida: ${error instanceof Error ? error.message : String(error)}` };
      }

      reply.code(201);
      return serializeAutomation(automation);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/automations/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const body = updateAutomationSchema.parse(request.body);
      const [existing] = await db.select().from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }

      const nextEnabled = body.enabled ?? existing.enabled;
      const nextSchedule = body.schedule ?? existing.schedule;
      const scheduleChanged = nextSchedule !== existing.schedule;

      // Se a agenda mudou (ou desativou), o repeatable job antigo precisa sumir —
      // BullMQ não troca o pattern de um job já registrado, só remove/recria.
      if (scheduleChanged || !nextEnabled) {
        await removeAutomationJob(existing.id, existing.schedule);
      }
      if (nextEnabled && (scheduleChanged || !existing.enabled)) {
        try {
          await registerAutomationJob(existing.id, nextSchedule);
        } catch (error) {
          reply.code(400);
          return { error: `Agenda inválida: ${error instanceof Error ? error.message : String(error)}` };
        }
      }

      const [updated] = await db
        .update(schema.automations)
        .set({
          enabled: nextEnabled,
          schedule: nextSchedule,
          scheduleLabel: body.schedule_label ?? existing.scheduleLabel,
          updatedAt: new Date(),
        })
        .where(eq(schema.automations.id, existing.id))
        .returning();

      return serializeAutomation(updated!);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/automations/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const [existing] = await db.select().from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }

      await removeAutomationJob(existing.id, existing.schedule);
      await db.delete(schema.automations).where(eq(schema.automations.id, existing.id));

      reply.code(204);
      return null;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/automations/:id/runs',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [automation] = await db.select({ id: schema.automations.id }).from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!automation) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }

      const rows = await db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.automationId, request.params.id))
        .orderBy(desc(schema.automationRuns.startedAt))
        .limit(50);

      return {
        runs: rows.map((row) => ({
          id: row.id,
          status: row.status,
          error: row.error,
          started_at: row.startedAt.toISOString(),
          completed_at: row.completedAt?.toISOString() ?? null,
        })),
      };
    },
  );
}
