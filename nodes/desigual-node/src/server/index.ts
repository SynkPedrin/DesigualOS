import Fastify, { type FastifyInstance } from 'fastify';
import {
  executeRequestSchema,
  nodeCapabilitiesResponseSchema,
  nodeHealthResponseSchema,
  nodeStatusResponseSchema,
} from '@desigual-os/node-protocol';
import { getReleaseInfo } from '@desigual-os/logging';
import type { NodeConfig } from '../config.js';
import { executeTask } from '../execute.js';
import { requireNodeSecret } from '../security/index.js';
import { runtimeState, uptimeSeconds } from '../state.js';

export function buildServer(config: NodeConfig): FastifyInstance {
  const isProd = process.env.NODE_ENV === 'production';

  const app = Fastify({
    logger: isProd
      ? { level: process.env.LOG_LEVEL ?? 'info' }
      : {
          level: process.env.LOG_LEVEL ?? 'info',
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        },
  });

  app.get('/health', async () => {
    return nodeHealthResponseSchema.parse({
      status: 'ok',
      node_id: config.NODE_ID,
      timestamp: new Date().toISOString(),
      release_sha: getReleaseInfo().release_sha,
    });
  });

  app.get('/status', async () => {
    return nodeStatusResponseSchema.parse({
      node_id: config.NODE_ID,
      agent: config.AGENT_NAME,
      type: config.NODE_TYPE,
      version: config.VERSION,
      agent_status: runtimeState.agentStatus,
      uptime_seconds: uptimeSeconds(),
    });
  });

  app.get('/capabilities', async () => {
    return nodeCapabilitiesResponseSchema.parse({
      node_id: config.NODE_ID,
      capabilities: config.CAPABILITIES,
    });
  });

  app.post('/execute', { preHandler: requireNodeSecret(config) }, async (request) => {
    const body = executeRequestSchema.parse(request.body);
    return executeTask(body, config, request.log);
  });

  return app;
}
