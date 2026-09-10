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
  app.get<{ Querystring: { range?: string } }>(
    '/costs/overview',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request) => {
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
        note:
          'Custo aproximado: modelo real usado pelo OpenClaw ainda não é reportado (ver Fase 04). ' +
          'Bento, Jarbas e Suzy usam contagem de tokens estimada por caracteres (o bento-qa e o susy-service ' +
          'não reportam usage de verdade); Otto e Studio usam contagem real. Ver packages/token-engine.',
      };
    },
  );

  app.get<{ Querystring: { range?: string } }>(
    '/costs/by-agent',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request) => {
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

      return {
        by_agent: rows.map((row) => ({
          agent: row.agent,
          total_cost_usd: Number(row.totalCost),
          events: row.eventCount,
        })),
      };
    },
  );

  app.get<{ Querystring: { range?: string } }>(
    '/costs/by-client',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request) => {
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
    },
  );

  // economy_records passou a ser escrito de verdade em 08/09/2026
  // (finalizeExecutionCost, ver cost-service.ts) - antes disso a tabela
  // existia migrada no banco desde a Fase 11, mas nada escrevia nela.
  app.get<{ Querystring: { range?: string } }>(
    '/costs/economy',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request) => {
      const since = rangeToDate(request.query.range);
      const [totals] = await db
        .select({
          estimatedCost: sql<string>`coalesce(sum(${schema.economyRecords.estimatedCost}), 0)`,
          actualCost: sql<string>`coalesce(sum(${schema.economyRecords.actualCost}), 0)`,
          savedAmount: sql<string>`coalesce(sum(${schema.economyRecords.savedAmount}), 0)`,
          executionCount: sql<number>`count(*)`,
        })
        .from(schema.economyRecords)
        .where(gte(schema.economyRecords.createdAt, since));

      const estimatedCost = Number(totals?.estimatedCost ?? 0);
      const savedAmount = Number(totals?.savedAmount ?? 0);

      return {
        range_days: Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
        executions_compared: totals?.executionCount ?? 0,
        estimated_cost_usd: estimatedCost,
        actual_cost_usd: Number(totals?.actualCost ?? 0),
        saved_amount_usd: savedAmount,
        saved_percentage:
          estimatedCost > 0 ? Number(((savedAmount / estimatedCost) * 100).toFixed(2)) : 0,
        note: 'Estimativa pré-execução aproximada por caracteres (ver estimateCost em @desigual-os/token-engine), comparada ao custo real medido depois. Só cobre execuções criadas após 08/09/2026 (estimatedCost não existia antes disso).',
      };
    },
  );

  app.get<{ Querystring: { range?: string } }>(
    '/costs/by-user',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request) => {
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
        by_user: rows.map((row) => ({
          user_id: row.userId,
          user_name: row.userName ?? null,
          total_cost_usd: Number(row.totalCost),
        })),
      };
    },
  );
}
