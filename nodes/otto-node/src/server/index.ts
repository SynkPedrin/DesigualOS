import Fastify, { type FastifyInstance } from 'fastify';
import {
  executeRequestSchema,
  nodeCapabilitiesResponseSchema,
  nodeStatusResponseSchema,
} from '@desigual-os/node-protocol';
import { OTTO_CAPABILITIES, type OttoNodeConfig } from '../config.js';
import { createDefaultDeps, executeTask, type OttoNodeDeps } from '../execute.js';
import { requireNodeSecret } from '../security/index.js';
import { runtimeState, uptimeSeconds } from '../state.js';

export function buildServer(config: OttoNodeConfig, deps: OttoNodeDeps = createDefaultDeps(config)): FastifyInstance {
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
    // Health REAL agregado, não o "sempre ok" do desigual-node: o Otto sem
    // Ollama ou sem Brain não consegue trabalhar, e o Monitoramento precisa
    // saber disso. O payload é SUPERSET do nodeHealthResponseSchema - ele
    // exige status literal 'ok', o que cobriria só o caso feliz; aqui
    // reportamos degraded/down honestamente (llm down => down; modelo
    // ausente ou brain ilegível => degraded).
    const [llm, brain] = await Promise.all([
      deps.llm.healthCheck(),
      Promise.resolve().then(() => deps.brainHealth()),
    ]);
    const status = llm.status === 'down' ? 'down' : llm.status === 'degraded' || brain.status !== 'ok' ? 'degraded' : 'ok';
    return {
      status,
      node_id: config.NODE_ID,
      timestamp: new Date().toISOString(),
      llm,
      brain,
    };
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
      capabilities: [...OTTO_CAPABILITIES],
    });
  });

  app.post('/execute', { preHandler: requireNodeSecret(config) }, async (request) => {
    const body = executeRequestSchema.parse(request.body);
    return executeTask(body, config, deps, request.log);
  });

  return app;
}
