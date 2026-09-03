import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { NODE_STATUSES } from '@desigual-os/types';
import { syncAgents } from '@desigual-os/orchestrator';
import { requireAuth, requirePermission } from '../auth/middleware';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Gerenciamento de agentes/infra é assunto de master (pedido do usuário:
  // colaborador só vê o dia a dia dele, não saúde de máquina).
  app.get('/health/infrastructure', { preHandler: [requireAuth, requirePermission('nodes', 'read')] }, async () => {
    const rows = await db
      .select({
        nodeId: schema.nodes.nodeId,
        agent: schema.agents.name,
        type: schema.nodes.type,
        status: schema.nodes.status,
        lastHeartbeatAt: schema.nodes.lastHeartbeatAt,
        internalId: schema.nodes.id,
      })
      .from(schema.nodes)
      .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id));

    const summary = Object.fromEntries(NODE_STATUSES.map((status) => [status, 0])) as Record<
      (typeof NODE_STATUSES)[number],
      number
    >;
    for (const row of rows) {
      summary[row.status] += 1;
    }

    // Um node por vez é aceitável aqui: o sistema tem no máximo alguns
    // nodes (3 Macs + RTX), não vale a pena uma window function pra isso.
    const nodes = await Promise.all(
      rows.map(async (row) => {
        const [latest] = await db
          .select()
          .from(schema.healthChecks)
          .where(eq(schema.healthChecks.nodeId, row.internalId))
          .orderBy(desc(schema.healthChecks.createdAt))
          .limit(1);

        return {
          node_id: row.nodeId,
          agent: row.agent,
          type: row.type,
          status: row.status,
          last_heartbeat_at: row.lastHeartbeatAt?.toISOString() ?? null,
          cpu: latest?.cpu ?? null,
          ram: latest?.ram ?? null,
          disk: latest?.disk ?? null,
          latency_ms: latest?.latencyMs ?? null,
          // Só o Studio preenche isso de verdade (seção 7.3).
          gpu: latest?.gpu ?? null,
          vram: latest?.vram ?? null,
          temperature: latest?.temperature ?? null,
          queue_depth: latest?.queueDepth ?? null,
        };
      }),
    );

    const online = summary.online;
    const total = rows.length;

    return {
      total_nodes: total,
      summary,
      // Curinga: nenhum node degraded/warning/offline conta como "tudo saudável".
      all_systems_online: total > 0 && online === total,
      overall_health_percent: total > 0 ? Math.round((online / total) * 100) : 0,
      agents_connected: { online, total },
      // Não existe sistema de backup implementado ainda; nunca inventar um valor aqui.
      last_backup_at: null,
      nodes,
    };
  });

  app.get<{ Params: { node_id: string } }>(
    '/nodes/:node_id',
    { preHandler: [requireAuth, requirePermission('nodes', 'read')] },
    async (request, reply) => {
    const [node] = await db
      .select({
        nodeId: schema.nodes.nodeId,
        agent: schema.agents.name,
        type: schema.nodes.type,
        privateHost: schema.nodes.privateHost,
        version: schema.nodes.version,
        status: schema.nodes.status,
        lastHeartbeatAt: schema.nodes.lastHeartbeatAt,
        internalId: schema.nodes.id,
      })
      .from(schema.nodes)
      .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id))
      .where(eq(schema.nodes.nodeId, request.params.node_id));

    if (!node) {
      reply.code(404);
      return { error: `Node '${request.params.node_id}' not found` };
    }

    const capabilities = await db
      .select({ capability: schema.nodeCapabilities.capability })
      .from(schema.nodeCapabilities)
      .where(eq(schema.nodeCapabilities.nodeId, node.internalId));

    const [latestHealthCheck] = await db
      .select()
      .from(schema.healthChecks)
      .where(eq(schema.healthChecks.nodeId, node.internalId))
      .orderBy(desc(schema.healthChecks.createdAt))
      .limit(1);

    return {
      node_id: node.nodeId,
      agent: node.agent,
      type: node.type,
      private_host: node.privateHost,
      version: node.version,
      status: node.status,
      last_heartbeat_at: node.lastHeartbeatAt?.toISOString() ?? null,
      capabilities: capabilities.map((row) => row.capability),
      latest_metrics: latestHealthCheck
        ? {
            cpu: latestHealthCheck.cpu,
            ram: latestHealthCheck.ram,
            disk: latestHealthCheck.disk,
            gpu: latestHealthCheck.gpu,
            vram: latestHealthCheck.vram,
            temperature: latestHealthCheck.temperature,
            latency_ms: latestHealthCheck.latencyMs,
            queue_depth: latestHealthCheck.queueDepth,
            active_job: latestHealthCheck.activeJob,
            recorded_at: latestHealthCheck.createdAt.toISOString(),
          }
        : null,
    };
    },
  );
  /**
   * Botão "Sincronizar" do Monitoramento: vai ATÉ cada agente, mede de
   * verdade, grava o resultado e devolve o diagnóstico com o que já foi
   * autossolucionado. Substitui a espera passiva por heartbeat — que nunca
   * chegava, deixando a tela em "0/2 agentes conectados".
   */
  app.post('/health/sync', { preHandler: [requireAuth, requirePermission('nodes', 'read')] }, async () => {
    const report = await syncAgents();
    return {
      ran_at: report.ranAt,
      recorded: report.recorded,
      agents: report.agents.map((agent) => ({
        agent: agent.agent,
        node_id: agent.nodeId,
        label: agent.label,
        status: agent.status,
        latency_ms: agent.latencyMs,
        services: agent.services.map((s) => ({ name: s.name, ok: s.ok, http_status: s.httpStatus, error: s.error })),
        metrics: {
          ram: agent.metrics.ramPercent ?? null,
          vram: agent.metrics.vramPercent ?? null,
          queue_depth: agent.metrics.queueDepth ?? null,
        },
      })),
      diagnoses: report.diagnoses.map((d) => ({
        agent: d.agent,
        problem: d.problem,
        suggestion: d.suggestion,
        auto_fixed: d.autoFixed,
        severity: d.severity,
      })),
    };
  });

}
