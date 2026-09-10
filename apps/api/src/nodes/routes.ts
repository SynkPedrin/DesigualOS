import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  heartbeatRequestSchema,
  heartbeatResponseSchema,
  registerNodeRequestSchema,
  registerNodeResponseSchema,
} from '@desigual-os/node-protocol';
import { requireNodeSecret } from './auth';
import { requireAuth, requirePermission } from '../auth/middleware';
import { publishWsEvent } from '@desigual-os/orchestrator';

// 'drain' não existe de verdade ainda porque não há rastreio de trabalho em
// andamento por node (isso chega com a fila na Fase 9). Por enquanto os dois
// comandos administrativos possíveis são só entrar e sair de manutenção.
const nodeCommandSchema = z.object({
  command: z.enum(['maintenance', 'resume']),
});

export async function registerNodeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/nodes/register', { preHandler: requireNodeSecret }, async (request, reply) => {
    const payload = registerNodeRequestSchema.parse(request.body);

    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.name, payload.agent));
    if (!agent) {
      reply.code(400);
      return { error: `Unknown agent '${payload.agent}'. Seed the agents table first.` };
    }

    const [node] = await db
      .insert(schema.nodes)
      .values({
        nodeId: payload.node_id,
        agentId: agent.id,
        type: payload.type,
        privateHost: payload.private_host,
        version: payload.version,
        status: 'online',
        lastHeartbeatAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.nodes.nodeId,
        set: {
          agentId: agent.id,
          type: payload.type,
          privateHost: payload.private_host,
          version: payload.version,
          status: 'online',
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!node) {
      throw new Error('Failed to upsert node during registration');
    }

    await db.delete(schema.nodeCapabilities).where(eq(schema.nodeCapabilities.nodeId, node.id));
    if (payload.capabilities.length > 0) {
      await db
        .insert(schema.nodeCapabilities)
        .values(payload.capabilities.map((capability) => ({ nodeId: node.id, capability })));
    }

    request.log.info({ node_id: payload.node_id, agent: payload.agent }, 'Node registered');

    return registerNodeResponseSchema.parse({
      node_id: node.nodeId,
      status: 'online',
      registered_at: node.updatedAt.toISOString(),
    });
  });

  app.post<{ Params: { node_id: string } }>(
    '/nodes/:node_id/heartbeat',
    { preHandler: requireNodeSecret },
    async (request, reply) => {
      const payload = heartbeatRequestSchema.parse(request.body);

      if (payload.node_id !== request.params.node_id) {
        reply.code(400);
        return { error: 'node_id in URL does not match node_id in body' };
      }

      const [node] = await db.select().from(schema.nodes).where(eq(schema.nodes.nodeId, payload.node_id));
      if (!node) {
        reply.code(404);
        return { error: `Node '${payload.node_id}' is not registered` };
      }

      const now = new Date();

      await db
        .update(schema.nodes)
        .set({ status: payload.status, lastHeartbeatAt: now, updatedAt: now })
        .where(eq(schema.nodes.id, node.id));

      await db.insert(schema.healthChecks).values({
        nodeId: node.id,
        status: payload.status,
        cpu: payload.cpu ?? null,
        ram: payload.ram ?? null,
        disk: payload.disk ?? null,
        gpu: payload.gpu ?? null,
        vram: payload.vram ?? null,
        temperature: payload.temperature ?? null,
        latencyMs: payload.latency_ms ?? null,
        queueDepth: payload.queue_depth ?? null,
        activeJob: payload.active_job ?? null,
      });

      // Avisa o Monitoramento pelo WS na hora, sem esperar o próximo polling.
      // Falha no publish não pode derrubar o heartbeat: o dado já está gravado.
      try {
        await publishWsEvent({
          type: 'node.status',
          payload: { node_id: payload.node_id, status: payload.status },
        });
      } catch (error) {
        request.log.error({ error }, 'Falha ao publicar node.status no WS');
      }

      return heartbeatResponseSchema.parse({
        node_id: payload.node_id,
        acknowledged_at: now.toISOString(),
      });
    },
  );

  app.get('/nodes', { preHandler: [requireAuth, requirePermission('nodes', 'read')] }, async () => {
    const rows = await db
      .select({
        nodeId: schema.nodes.nodeId,
        agent: schema.agents.name,
        type: schema.nodes.type,
        privateHost: schema.nodes.privateHost,
        version: schema.nodes.version,
        status: schema.nodes.status,
        lastHeartbeatAt: schema.nodes.lastHeartbeatAt,
      })
      .from(schema.nodes)
      .innerJoin(schema.agents, eq(schema.nodes.agentId, schema.agents.id));

    return {
      nodes: rows.map((row) => ({
        node_id: row.nodeId,
        agent: row.agent,
        type: row.type,
        private_host: row.privateHost,
        version: row.version,
        status: row.status,
        last_heartbeat_at: row.lastHeartbeatAt?.toISOString() ?? null,
      })),
    };
  });

  // Comando administrativo (entrar/sair de manutenção), não autenticação
  // node -> Orchestrator: antes usava requireNodeSecret, o que deixava
  // qualquer processo com o segredo compartilhado (todo node registrado)
  // comandar QUALQUER outro node, e nenhum master conseguia chamar isso
  // pela própria sessão sem ter o segredo em mãos. É uma ação de operador
  // humano (ver comentário em health/routes.ts), então usa RBAC de usuário.
  app.post<{ Params: { node_id: string } }>(
    '/nodes/:node_id/command',
    { preHandler: [requireAuth, requirePermission('nodes', 'write')] },
    async (request, reply) => {
      const { command } = nodeCommandSchema.parse(request.body);

      const [node] = await db.select().from(schema.nodes).where(eq(schema.nodes.nodeId, request.params.node_id));
      if (!node) {
        reply.code(404);
        return { error: `Node '${request.params.node_id}' not found` };
      }

      const nextStatus = command === 'maintenance' ? 'maintenance' : 'online';
      await db
        .update(schema.nodes)
        .set({
          status: nextStatus,
          lastHeartbeatAt: command === 'resume' ? new Date() : node.lastHeartbeatAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.nodes.id, node.id));

      request.log.info({ node_id: request.params.node_id, command }, 'Node command executed');

      return { node_id: request.params.node_id, status: nextStatus };
    },
  );
}
