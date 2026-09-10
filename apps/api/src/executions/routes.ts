import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';

export async function registerExecutionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { client_id?: string } }>('/executions', { preHandler: requireAuth }, async (request) => {
    // Chat compartilhado (2026-09-03, mesma decisão de /conversations): execution é o que
    // alimenta "conversas ativas" no dashboard de Agentes - sem isso ficava inconsistente
    // com conversas/mensagens já públicas, e colaborador via a própria atividade zerada.
    const clientFilter = request.query.client_id ? eq(schema.executions.clientId, request.query.client_id) : undefined;

    const rows = await db
      .select()
      .from(schema.executions)
      .where(clientFilter)
      .orderBy(desc(schema.executions.createdAt))
      .limit(50);

    return {
      executions: rows.map((row) => ({
        execution_id: row.executionId,
        client_id: row.clientId,
        agent: row.agent,
        intent: row.intent,
        status: row.status,
        priority: row.priority,
        started_at: row.startedAt?.toISOString() ?? null,
        completed_at: row.completedAt?.toISOString() ?? null,
        tokens_input: row.tokensInput,
        tokens_output: row.tokensOutput,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/executions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const [execution] = await db.select().from(schema.executions).where(eq(schema.executions.executionId, request.params.id));
    if (!execution) {
      reply.code(404);
      return { error: `Execution '${request.params.id}' not found` };
    }
    // Chat compartilhado: sem dono exclusivo, mesmo raciocínio do GET /executions acima.

    const steps = await db
      .select()
      .from(schema.executionSteps)
      .where(eq(schema.executionSteps.executionId, execution.id))
      .orderBy(schema.executionSteps.stepIndex);

    return {
      execution_id: execution.executionId,
      client_id: execution.clientId,
      agent: execution.agent,
      intent: execution.intent,
      status: execution.status,
      priority: execution.priority,
      started_at: execution.startedAt?.toISOString() ?? null,
      completed_at: execution.completedAt?.toISOString() ?? null,
      tokens_input: execution.tokensInput,
      tokens_output: execution.tokensOutput,
      estimated_cost: execution.estimatedCost,
      actual_cost: execution.actualCost,
      steps: steps.map((step) => ({
        step_index: step.stepIndex,
        agent: step.agent,
        status: step.status,
        output: step.output,
      })),
    };
  });
}
