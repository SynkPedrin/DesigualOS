import type { FastifyInstance } from 'fastify';
import { gte, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth, requirePermission } from '../auth/middleware';

function rangeToDate(range: string | undefined): Date {
  const days = range?.endsWith('d') ? Number(range.slice(0, -1)) : 30;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
}

export async function registerCostRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { range?: string } }>('/costs/overview', { preHandler: [requireAuth, requirePermission('costs', 'read')] }, async (request) => {
    const since = rangeToDate(request.query.range);

    const [totals] = await db
      .select({
        totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(schema.costRecords)
      .where(gte(schema.costRecords.createdAt, since));

    const [tokenTotals] = await db
      .select({
        inputTokens: sql<string>`coalesce(sum(${schema.tokenUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${schema.tokenUsage.outputTokens}), 0)`,
      })
      .from(schema.tokenUsage)
      .where(gte(schema.tokenUsage.createdAt, since));

    return {
      range_days: Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
      total_cost_usd: Number(totals?.totalCost ?? 0),
      cost_events: totals?.eventCount ?? 0,
      total_input_tokens: Number(tokenTotals?.inputTokens ?? 0),
      total_output_tokens: Number(tokenTotals?.outputTokens ?? 0),
      note: 'Custo aproximado: modelo real usado pelo OpenClaw ainda não é reportado (ver Fase 04). Ver packages/token-engine.',
    };
  });

  app.get<{ Querystring: { range?: string } }>('/costs/by-agent', { preHandler: [requireAuth, requirePermission('costs', 'read')] }, async (request) => {
    const since = rangeToDate(request.query.range);
    const rows = await db
      .select({
        agent: schema.costRecords.agent,
        totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(schema.costRecords)
      .where(gte(schema.costRecords.createdAt, since))
      .groupBy(schema.costRecords.agent);

    return { by_agent: rows.map((row) => ({ agent: row.agent, total_cost_usd: Number(row.totalCost), events: row.eventCount })) };
  });

  app.get<{ Querystring: { range?: string } }>('/costs/by-client', { preHandler: [requireAuth, requirePermission('costs', 'read')] }, async (request) => {
    const since = rangeToDate(request.query.range);
    const rows = await db
      .select({
        clientId: schema.costRecords.clientId,
        clientName: schema.clients.name,
        totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
      })
      .from(schema.costRecords)
      .leftJoin(schema.clients, sql`${schema.costRecords.clientId} = ${schema.clients.id}`)
      .where(gte(schema.costRecords.createdAt, since))
      .groupBy(schema.costRecords.clientId, schema.clients.name);

    return {
      by_client: rows.map((row) => ({
        client_id: row.clientId,
        client_name: row.clientName ?? null,
        total_cost_usd: Number(row.totalCost),
      })),
    };
  });

  app.get<{ Querystring: { range?: string } }>('/costs/by-user', { preHandler: [requireAuth, requirePermission('costs', 'read')] }, async (request) => {
    const since = rangeToDate(request.query.range);
    const rows = await db
      .select({
        userId: schema.costRecords.userId,
        userName: schema.users.name,
        totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
      })
      .from(schema.costRecords)
      .leftJoin(schema.users, sql`${schema.costRecords.userId} = ${schema.users.id}`)
      .where(gte(schema.costRecords.createdAt, since))
      .groupBy(schema.costRecords.userId, schema.users.name);

    return {
      by_user: rows.map((row) => ({ user_id: row.userId, user_name: row.userName ?? null, total_cost_usd: Number(row.totalCost) })),
    };
  });
}
