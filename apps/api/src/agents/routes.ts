import type { FastifyInstance } from 'fastify';
import { desc } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Agregados da tabela executions INTEIRA por agente (a tela de Agentes
   * mostrava tudo zerado porque lia só a janela de 50 do GET /executions).
   * Só requireAuth, sem permissão de nodes: colaborador também vê essa tela.
   * Agregação em JS de propósito: a tabela é pequena e a conta (performance,
   * tempo médio) fica mais legível aqui do que num SQL com três subconsultas.
   */
  app.get('/agents/stats', { preHandler: requireAuth }, async () => {
    const [allAgents, rows] = await Promise.all([
      db.select({ name: schema.agents.name }).from(schema.agents),
      db
        .select({
          agent: schema.executions.agent,
          status: schema.executions.status,
          startedAt: schema.executions.startedAt,
          completedAt: schema.executions.completedAt,
        })
        .from(schema.executions),
    ]);

    const stats = new Map<string, { active: number; completed: number; failed: number; responseSeconds: number[] }>();
    for (const row of rows) {
      const entry = stats.get(row.agent) ?? { active: 0, completed: 0, failed: 0, responseSeconds: [] };
      if (row.status === 'queued' || row.status === 'running') entry.active += 1;
      if (row.status === 'completed') {
        entry.completed += 1;
        if (row.startedAt && row.completedAt) {
          entry.responseSeconds.push((row.completedAt.getTime() - row.startedAt.getTime()) / 1000);
        }
      }
      if (row.status === 'failed') entry.failed += 1;
      stats.set(row.agent, entry);
    }

    return {
      // Uma entrada por agente da tabela agents, mesmo sem executions: a tela
      // precisa mostrar todo mundo, com zeros/nulls onde não há dado ainda.
      agents: allAgents.map(({ name }) => {
        const entry = stats.get(name);
        const settled = (entry?.completed ?? 0) + (entry?.failed ?? 0);
        return {
          agent: name,
          active_conversations: entry?.active ?? 0,
          performance_percent: settled > 0 ? Math.round(((entry?.completed ?? 0) / settled) * 100) : null,
          average_response_seconds:
            entry && entry.responseSeconds.length > 0
              ? Math.round((entry.responseSeconds.reduce((sum, s) => sum + s, 0) / entry.responseSeconds.length) * 10) / 10
              : null,
        };
      }),
    };
  });

  /**
   * KPIs do Agentic V2 (spec seções 66-68): qualidade e aprendizado por
   * agente calculados de agent_outcomes — cada linha ali só existe porque
   * uma execução real terminou, então os números são sempre medidos, nunca
   * estimados. É o endpoint que responde "os agentes estão melhorando?"
   * (first-attempt success e iterações médias ao longo do tempo).
   */
  app.get('/agents/kpis', { preHandler: requireAuth }, async () => {
    const rows = await db
      .select({
        agent: schema.agentOutcomes.agent,
        goalCompletion: schema.agentOutcomes.goalCompletion,
        firstAttemptSuccess: schema.agentOutcomes.firstAttemptSuccess,
        iterations: schema.agentOutcomes.iterations,
        toolFailures: schema.agentOutcomes.toolFailures,
        evaluatorScore: schema.agentOutcomes.evaluatorScore,
        latencyMs: schema.agentOutcomes.latencyMs,
        createdAt: schema.agentOutcomes.createdAt,
      })
      .from(schema.agentOutcomes)
      .orderBy(desc(schema.agentOutcomes.createdAt))
      .limit(1000);

    const byAgent = new Map<
      string,
      { total: number; success: number; firstAttempt: number; iterations: number[]; toolFailures: number; scores: number[]; latencies: number[] }
    >();
    for (const row of rows) {
      const entry =
        byAgent.get(row.agent) ?? { total: 0, success: 0, firstAttempt: 0, iterations: [], toolFailures: 0, scores: [], latencies: [] };
      entry.total += 1;
      if (row.goalCompletion) entry.success += 1;
      if (row.firstAttemptSuccess) entry.firstAttempt += 1;
      entry.iterations.push(row.iterations);
      entry.toolFailures += row.toolFailures;
      if (row.evaluatorScore !== null) entry.scores.push(Number(row.evaluatorScore));
      if (row.latencyMs !== null) entry.latencies.push(row.latencyMs);
      byAgent.set(row.agent, entry);
    }

    const avg = (values: number[]) =>
      values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;

    return {
      window: { limit: 1000, executions: rows.length, since: rows.at(-1)?.createdAt ?? null },
      agents: [...byAgent.entries()].map(([agent, entry]) => ({
        agent,
        executions: entry.total,
        task_success_rate: entry.total > 0 ? Math.round((entry.success / entry.total) * 1000) / 1000 : null,
        first_attempt_success_rate: entry.total > 0 ? Math.round((entry.firstAttempt / entry.total) * 1000) / 1000 : null,
        avg_iterations: avg(entry.iterations),
        tool_failures: entry.toolFailures,
        avg_evaluator_score: avg(entry.scores),
        avg_latency_ms: entry.latencies.length > 0 ? Math.round(avg(entry.latencies) ?? 0) : null,
      })),
    };
  });
}
