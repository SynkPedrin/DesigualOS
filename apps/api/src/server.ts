import './env.js';
import Fastify from 'fastify';
import corsPlugin from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import multipartPlugin from '@fastify/multipart';
import { z } from 'zod';
import { createLogger } from '@desigual-os/logging';
import { registerNodeRoutes } from './nodes/routes';
import { registerHealthRoutes } from './health/routes';
import { startHealthSweep } from './health/scheduler';
import { startAgentProbe } from './health/probe-scheduler';
import { registerAuthRoutes } from './auth/routes';
import { registerChatRoutes } from './chat/routes';
import { registerExecutionRoutes } from './executions/routes';
import { registerStudioRoutes } from './studio/routes';
import { registerWsRoutes } from './ws/routes';
import { registerCostRoutes } from './costs/routes';
import { registerClientRoutes } from './clients/routes';
import { registerConversationRoutes } from './conversations/routes';
import { registerProjectRoutes } from './projects/routes';
import { registerAdminRoutes } from './admin/routes';
import { registerClickUpRoutes } from './clickup/routes';
import { registerIntegrationRoutes } from './integrations/routes';
import { registerNotificationRoutes } from './notifications/routes';
import { registerMessageRoutes } from './messages/routes';
import { registerTeamRoutes } from './team/routes';
import { registerSearchRoutes } from './search/routes';
import { registerToolCallRoutes } from './tool-calls/routes';
import { registerAutomationRoutes } from './automations/routes';

const logger = createLogger({ service: 'orchestrator-api' });
const isProd = process.env.NODE_ENV === 'production';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('desigual-os-api'),
  timestamp: z.string(),
});

// Fastify usa seu próprio logger interno (pino) para logs de request/response.
// createLogger acima é usado para logs de aplicação fora do ciclo de request.
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

// Sem isso, um schema.parse() que falha (input inválido de verdade, não bug
// nosso) virava 500 "Internal Server Error" pro cliente, escondendo que o
// problema era só validação. Toda entrada de rota usa Zod (regra da casa),
// então um ZodError aqui sempre significa 400, nunca 500.
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    reply.code(400).send({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  logger.error({ error }, 'Unhandled request error');
  reply.code(error.statusCode ?? 500).send({ error: error.message || 'Internal Server Error' });
});

app.get('/health', async () => {
  return healthResponseSchema.parse({
    status: 'ok',
    service: 'desigual-os-api',
    timestamp: new Date().toISOString(),
  });
});

const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  // First plugin registered so preflight is covered for every route below too (websocket,
  // multipart uploads included). Bearer token in Authorization, never cookies — no
  // credentials:true needed.
  await app.register(corsPlugin, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  await app.register(websocketPlugin);
  // 25 MB cobre foto de perfil, print de tela, áudio curto e PDF/doc/pptx
  // pequenos anexados no chat. Arquivo maior (vídeo) deve ir direto pro
  // Supabase Storage pelo frontend, não passar pela API.
  await app.register(multipartPlugin, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(registerNodeRoutes);
  await app.register(registerHealthRoutes);
  await app.register(registerAuthRoutes);
  await app.register(registerChatRoutes);
  await app.register(registerExecutionRoutes);
  await app.register(registerStudioRoutes);
  await app.register(registerWsRoutes);
  await app.register(registerCostRoutes);
  await app.register(registerClientRoutes);
  await app.register(registerConversationRoutes);
  await app.register(registerProjectRoutes);
  await app.register(registerAdminRoutes);
  await app.register(registerClickUpRoutes);
  await app.register(registerIntegrationRoutes);
  await app.register(registerNotificationRoutes);
  await app.register(registerMessageRoutes);
  await app.register(registerTeamRoutes);
  await app.register(registerSearchRoutes);
  await app.register(registerToolCallRoutes);
  await app.register(registerAutomationRoutes);
  await app.listen({ port, host: '0.0.0.0' });
  startHealthSweep(logger);
  // Sem isto o sweep acima derruba tudo pra offline em 60s: nossos agentes
  // não mandam heartbeat, é o Orchestrator que vai até eles.
  startAgentProbe(logger);
  logger.info({ port }, 'Orchestrator API listening');
}

start().catch((error: unknown) => {
  logger.error({ error }, 'Failed to start Orchestrator API');
  process.exit(1);
});
