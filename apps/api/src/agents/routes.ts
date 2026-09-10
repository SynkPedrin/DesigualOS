import type { FastifyInstance } from 'fastify';
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
}
