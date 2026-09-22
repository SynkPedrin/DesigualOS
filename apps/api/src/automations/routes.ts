import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { registerAutomationJob, removeAutomationJob, runAutomationNow } from '@desigual-os/orchestrator';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { clientBelongsToTenant, requireTenant } from '../lib/tenant-context';

const agentNameSchema = z.enum([...AGENT_NAMES] as [AgentName, ...AgentName[]]);

const createAutomationSchema = z.object({
  name: z.string().min(1),
  agent: agentNameSchema,
  prompt: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  schedule: z.string().min(1),
  schedule_label: z.string().min(1),
});

const updateAutomationSchema = z.object({
  name: z.string().min(1).optional(),
  agent: agentNameSchema.optional(),
  prompt: z.string().min(1).optional(),
  client_id: z.string().uuid().nullable().optional(),
  estimated_minutes_saved: z.number().int().nonnegative().nullable().optional(),
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
    estimated_minutes_saved: row.estimatedMinutesSaved,
    last_run_at: row.lastRunAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Automação agendada (pedido do usuário, 2026-09-03): "todo dia às 8h o
 * Bento analisa o ClickUp...". Compartilhada pela equipe, igual ao chat -
 * qualquer master/colaborador com `chat:write` cria, vê e gerencia
 * qualquer automação, não só as próprias.
 */
export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (!reply.sent) await requireTenant(request, reply);
  });
  app.get('/automations', async (request, reply) => {
    if (!request.authUser) { reply.code(401); return { error: 'Not authenticated' }; }
    const rows = await db.select().from(schema.automations)
      .where(eq(schema.automations.organizationId, request.tenantContext!.organizationId))
      .orderBy(desc(schema.automations.createdAt));
    return { automations: rows.map(serializeAutomation) };
  });

  // Registrada antes das rotas com :id para não disputar matching com
  // /automations/:id/... (Fastify dá prioridade a rota estática, mas assim
  // a intenção fica explícita).
  app.get('/automations/metrics', async (request) => {
    const tenantFilter = eq(schema.automations.organizationId, request.tenantContext!.organizationId);
    const runFilter = inArray(schema.automationRuns.automationId,
      db.select({ id: schema.automations.id }).from(schema.automations).where(tenantFilter));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    // Janelas "hoje/ontem/mês" seguem o timezone do servidor, como combinado.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - DAY_MS);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);

    async function countRuns(from: Date, to?: Date): Promise<number> {
      const conditions = [runFilter, gte(schema.automationRuns.startedAt, from)];
      if (to) {
        conditions.push(lt(schema.automationRuns.startedAt, to));
      }
      const [row] = await db
        .select({ value: count() })
        .from(schema.automationRuns)
        .where(and(...conditions));
      return row?.value ?? 0;
    }

    async function successRate(from: Date, to?: Date): Promise<number | null> {
      const conditions = [runFilter, gte(schema.automationRuns.startedAt, from)];
      if (to) {
        conditions.push(lt(schema.automationRuns.startedAt, to));
      }
      const rows = await db
        .select({ status: schema.automationRuns.status })
        .from(schema.automationRuns)
        .where(and(...conditions));
      if (rows.length === 0) {
        return null;
      }
      const dispatched = rows.filter((row) => row.status === 'dispatched').length;
      return Math.round((dispatched / rows.length) * 1000) / 10;
    }

    const [activeRow] = await db
      .select({ value: count() })
      .from(schema.automations)
      .where(and(tenantFilter, eq(schema.automations.enabled, true)));
    const activeCount = activeRow?.value ?? 0;

    const [createdMonthRow] = await db
      .select({ value: count() })
      .from(schema.automations)
      .where(and(tenantFilter, gte(schema.automations.createdAt, startOfMonth)));
    const createdThisMonth = createdMonthRow?.value ?? 0;

    const runsToday = await countRuns(startOfToday);
    const runsYesterday = await countRuns(startOfYesterday, startOfToday);

    const rateLast30d = await successRate(thirtyDaysAgo);
    const rateLast7d = await successRate(sevenDaysAgo);
    const ratePrev7d = await successRate(fourteenDaysAgo, sevenDaysAgo);

    // Só faz sentido somar tempo economizado se ALGUMA automação tiver a
    // estimativa cadastrada; senão o campo sai null (não zero).
    const [anyEstimated] = await db
      .select({ id: schema.automations.id })
      .from(schema.automations)
      .where(and(tenantFilter, isNotNull(schema.automations.estimatedMinutesSaved)))
      .limit(1);
    let timeSavedMinutes: number | null = null;
    if (anyEstimated) {
      const [sumRow] = await db
        .select({ total: sql<number>`coalesce(sum(${schema.automations.estimatedMinutesSaved}), 0)::int` })
        .from(schema.automationRuns)
        .innerJoin(schema.automations, eq(schema.automationRuns.automationId, schema.automations.id))
        .where(and(tenantFilter, gte(schema.automationRuns.startedAt, startOfMonth)));
      timeSavedMinutes = Number(sumRow?.total ?? 0);
    }

    return {
      active_count: activeCount,
      active_delta_month: createdThisMonth > 0 ? createdThisMonth : null,
      runs_today: runsToday,
      runs_today_delta: runsToday === 0 && runsYesterday === 0 ? null : runsToday - runsYesterday,
      success_rate: rateLast30d,
      success_delta_week:
        rateLast7d !== null && ratePrev7d !== null ? Math.round((rateLast7d - ratePrev7d) * 10) / 10 : null,
      time_saved_minutes: timeSavedMinutes,
    };
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

      const tenant = request.tenantContext!;
      if (body.client_id && !(await clientBelongsToTenant(body.client_id, tenant.organizationId))) {
        reply.code(403); return { error: 'Client is outside your organization' };
      }

      const [conversation] = await db
        .insert(schema.conversations)
        .values({ userId: user.id, clientId: body.client_id ?? null, title: `Automação: ${body.name}` })
        .returning();

      const [automation] = await db
        .insert(schema.automations)
        .values({
          organizationId: tenant.organizationId,
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
      if (existing.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
      }
      if (body.client_id && !(await clientBelongsToTenant(body.client_id, request.tenantContext!.organizationId))) {
        reply.code(403); return { error: 'Client is outside your organization' };
      }

      const nextEnabled = body.enabled ?? existing.enabled;
      const nextSchedule = body.schedule ?? existing.schedule;
      const scheduleChanged = nextSchedule !== existing.schedule;

      // Se a agenda mudou (ou desativou), o repeatable job antigo precisa sumir -
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
          name: body.name ?? existing.name,
          agent: body.agent ?? existing.agent,
          prompt: body.prompt ?? existing.prompt,
          clientId: body.client_id !== undefined ? body.client_id : existing.clientId,
          estimatedMinutesSaved:
            body.estimated_minutes_saved !== undefined ? body.estimated_minutes_saved : existing.estimatedMinutesSaved,
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

  // "Executar agora": job único na fila (sem repeatable), disparado mesmo com
  // a automação desabilitada - o worker só pula enabled=false em disparo agendado.
  app.post<{ Params: { id: string } }>(
    '/automations/:id/run',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const [existing] = await db
        .select({ id: schema.automations.id, organizationId: schema.automations.organizationId })
        .from(schema.automations)
        .where(eq(schema.automations.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }
      if (existing.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
      }

      await runAutomationNow(existing.id);

      reply.code(202);
      return { status: 'queued' };
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
      if (existing.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
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

      if (!request.authUser) { reply.code(401); return { error: 'Not authenticated' }; }
      const [scoped] = await db.select({ organizationId: schema.automations.organizationId }).from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!scoped || scoped.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
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
