import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  executeRequestSchema,
  nodeCapabilitiesResponseSchema,
  nodeStatusResponseSchema,
} from '@desigual-os/node-protocol';
import { OTTO_CAPABILITIES, type OttoNodeConfig } from '../config.js';
import { createDefaultDeps, executeTask, type OttoNodeDeps } from '../execute.js';
import { requireNodeSecret } from '../security/index.js';
import { runtimeState, uptimeSeconds } from '../state.js';

/**
 * Logger do turno. Fora de produção usamos pino-pretty, e cada transport do
 * pino sobe uma worker thread e registra um `process.on('exit')` enquanto ela
 * não fica pronta (pino/lib/transport.js: buildStream). Com UM servidor por
 * processo isso é irrelevante - o próprio pino remove o listener no 'ready'.
 * Em teste, porém, cada caso constrói um servidor novo, e os listeners se
 * acumulam mais rápido do que as threads ficam prontas: era daí que vinha o
 * MaxListenersExceededWarning ("11 exit listeners added to [process]").
 * Por isso a opção é injetável: o teste passa `false` e não sobe transport
 * nenhum. Ninguém lê log bonito no meio de uma suíte.
 */
export type OttoServerLogger = NonNullable<FastifyServerOptions['logger']>;

function defaultLogger(): OttoServerLogger {
  const level = process.env.LOG_LEVEL ?? 'info';
  if (process.env.NODE_ENV === 'production') return { level };
  return {
    level,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  };
}

export function buildServer(
  config: OttoNodeConfig,
  deps: OttoNodeDeps = createDefaultDeps(config),
  logger: OttoServerLogger = defaultLogger(),
): FastifyInstance {
  const app = Fastify({ logger });

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
      // RASTREABILIDADE (§23): sem isto, saber se a máquina roda o código
      // novo virava arqueologia de `ls -la dist`. Injetado no build; em dev
      // fica 'dev'. NUNCA carrega segredo: só SHA, data, modelo e host do
      // backend de inferência.
      release_sha: process.env.RELEASE_SHA ?? 'dev',
      build_time: process.env.BUILD_TIME ?? 'dev',
      model: config.otto.model,
      inference_backend: new URL(config.otto.ollamaUrl).host,
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
