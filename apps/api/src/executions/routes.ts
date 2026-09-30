import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { tenantSharingScope } from '../lib/access';

export async function registerExecutionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { client_id?: string } }>('/executions', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    // Chat compartilhado (2026-09-03, mesma decisão de /conversations): execution é o que
    // alimenta "conversas ativas" no dashboard de Agentes - sem isso ficava inconsistente
    // com conversas/mensagens já públicas, e colaborador via a própria atividade zerada.
    const clientFilter = request.query.client_id ? eq(schema.executions.clientId, request.query.client_id) : undefined;

    /**
     * P0-02 (22/09/2026): sem filtro nenhum de organização — qualquer
     * colaborador autenticado lia a execução de QUALQUER organização.
     * Mesmo escopo de `GET /conversations`: cliente precisa estar na
     * organização de quem pede; sem cliente, o dono precisa compartilhar
     * organização com quem pede. Master mantém o alcance que já tinha.
     */
    const isMaster = user.roles.includes('master');
    const scope = isMaster ? null : await tenantSharingScope(user.id);
    const tenantScopeCondition =
      scope === null
        ? undefined
        : or(
            scope.allowedClientIds.length > 0 ? inArray(schema.executions.clientId, scope.allowedClientIds) : undefined,
            and(isNull(schema.executions.clientId), inArray(schema.executions.userId, scope.teammateUserIds)),
          );

    /**
     * QUEM PEDIU vem junto desde 29/09/2026.
     *
     * A execução sempre soube de quem era (`user_id` é NOT NULL na tabela), e a
     * listagem não devolvia. Sem isso, "Atividade", "Auditoria", "Uso" e
     * "Pessoas" do Control Plane não têm como existir — atividade sem autor é
     * log, não auditoria.
     *
     * Vem por LEFT JOIN e não por consulta por linha: 50 execuções davam 50
     * idas ao banco, que é exatamente o N+1 que custou 22s do turno em
     * listAuthorizedClients (ver access.ts). Uma vez por dia é suficiente pra
     * aprender.
     */
    const rows = await db
      .select({
        execucao: schema.executions,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.executions)
      .leftJoin(schema.users, eq(schema.users.id, schema.executions.userId))
      .where(and(clientFilter, tenantScopeCondition))
      .orderBy(desc(schema.executions.createdAt))
      .limit(50);

    return {
      executions: rows.map(({ execucao: row, userName, userEmail }) => ({
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
        user_id: row.userId,
        // O nome quando existe; o e-mail como segunda opção. `null` significa
        // usuário apagado — e some da tela como "—", nunca como outra pessoa.
        user_name: userName ?? userEmail ?? null,
        created_at: row.createdAt?.toISOString() ?? null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/executions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const [execution] = await db.select().from(schema.executions).where(eq(schema.executions.executionId, request.params.id));
    if (!execution) {
      reply.code(404);
      return { error: `Execution '${request.params.id}' not found` };
    }
    // Chat compartilhado: sem dono exclusivo, mesmo raciocínio do GET /executions acima —
    // mas escopado à organização (P0-02, 22/09/2026), não mais global.
    if (!user.roles.includes('master') && execution.userId !== user.id) {
      const scope = await tenantSharingScope(user.id);
      const inScope = execution.clientId
        ? scope.allowedClientIds.includes(execution.clientId)
        : scope.teammateUserIds.includes(execution.userId);
      if (!inScope) {
        reply.code(404);
        return { error: `Execution '${request.params.id}' not found` };
      }
    }

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
