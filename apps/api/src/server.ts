import './env.js';
import Fastify, { type FastifyRequest } from 'fastify';
import corsPlugin from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import multipartPlugin from '@fastify/multipart';
import rateLimitPlugin from '@fastify/rate-limit';
import helmetPlugin from '@fastify/helmet';
import { z } from 'zod';
import { createLogger, getReleaseInfo, redactTokenFromUrl } from '@desigual-os/logging';
import { getSchemaVersion } from '@desigual-os/database';
import { registerNodeRoutes } from './nodes/routes';
import { registerHealthRoutes } from './health/routes';
import { startHealthCheckRetention, startHealthSweep } from './health/scheduler';
import { startAgentProbe } from './health/probe-scheduler';
import { startWorkerWatchdog } from './health/worker-watchdog';
import { registerAuthRoutes } from './auth/routes';
import { registerChatRoutes } from './chat/routes';
import { registerExecutionRoutes } from './executions/routes';
import { registerStudioRoutes } from './studio/routes';
import { registerCanvasDocumentRoutes } from './studio/canvas-routes';
import { registerImageSearchRoutes } from './studio/image-search-routes';
import { registerFontRoutes } from './studio/font-routes';
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
import { registerCollaboratorRoutes } from './collaborators/routes';
import { registerSearchRoutes } from './search/routes';
import { registerToolCallRoutes } from './tool-calls/routes';
import { registerAutomationRoutes } from './automations/routes';
import { registerUploadRoutes } from './uploads/routes';
import { registerAgentRoutes } from './agents/routes';

const logger = createLogger({ service: 'orchestrator-api' });
const isProd = process.env.NODE_ENV === 'production';

// Sem isso, faltar FRONTEND_URL em produção caía silenciosamente no default
// de dev (http://localhost:3000) - CORS "funcionando" contra o localhost de
// ninguém, sem nenhum aviso no boot. Falha alto e explícito em vez de
// mascarar a variável ausente.
if (isProd && !process.env.FRONTEND_URL) {
  logger.error(
    'FRONTEND_URL não configurada em produção - recusando subir com o default de dev (localhost:3000)',
  );
  process.exit(1);
}

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('desigual-os-api'),
  timestamp: z.string(),
  release_sha: z.string(),
  build_time: z.string(),
  environment: z.string(),
  schema_version: z.string(),
});

// Fastify usa seu próprio logger interno (pino) para logs de request/response.
// createLogger acima é usado para logs de aplicação fora do ciclo de request.
// P0-03 (auditoria 22/09/2026): o serializer padrão do Fastify grava a URL
// INTEIRA da request, e `/ws?token=<jwt>` (handshake do WebSocket — o
// WebSocket nativo do browser não aceita header Authorization) ia pro log
// assim, credencial válida incluída. `req.url` é a ÚNICA coisa que muda:
// mesmo formato de sempre (method/url/hostname/remoteAddress/remotePort),
// só a query string do token mascarada antes do logger ver o valor.
const requestSerializer = (request: FastifyRequest) => ({
  method: request.method,
  url: redactTokenFromUrl(request.url),
  hostname: request.hostname,
  remoteAddress: request.socket?.remoteAddress ?? request.ip,
  remotePort: request.socket?.remotePort ?? 0,
});

const app = Fastify({
  logger: isProd
    ? { level: process.env.LOG_LEVEL ?? 'info', serializers: { req: requestSerializer } }
    : {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
        serializers: { req: requestSerializer },
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
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  // JSON malformado no corpo: o parser default do Fastify propaga o
  // SyntaxError cru (sem code FST próprio) com statusCode 400; o detalhe
  // ("Expected property name ...") é ruído técnico pra quem chama a API.
  if (error.statusCode === 400 && error instanceof SyntaxError) {
    reply.code(400).send({ error: 'Invalid JSON body' });
    return;
  }

  logger.error({ error }, 'Unhandled request error');
  // error.statusCode só existe quando uma rota lançou de propósito (ex:
  // reply.code(4xx) explícito antes); nesse caso a mensagem já foi escrita
  // pensando em quem chama a API. Qualquer erro sem statusCode é uma falha
  // não prevista (constraint do Postgres, bug) - devolver error.message cru
  // vazaria nome de tabela/coluna/schema pro cliente, então vira mensagem
  // genérica; o detalhe real já está no logger.error acima.
  if (error.statusCode) {
    reply.code(error.statusCode).send({ error: error.message || 'Internal Server Error' });
    return;
  }
  reply.code(500).send({ error: 'Internal Server Error' });
});

app.get('/health', async () => {
  // P1-04 (auditoria de release readiness, 22/09/2026): sem isto não dava
  // pra provar QUAL commit está rodando de verdade depois de um deploy, nem
  // comparar entre web/API/worker/nodes (Phase 11 da missão de release).
  const release = getReleaseInfo();
  return healthResponseSchema.parse({
    status: 'ok',
    service: 'desigual-os-api',
    timestamp: new Date().toISOString(),
    ...release,
    schema_version: getSchemaVersion(),
  });
});

const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  // First plugin registered so preflight is covered for every route below too (websocket,
  // multipart uploads included). Bearer token in Authorization, never cookies - no
  // credentials:true needed.
  await app.register(corsPlugin, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  // Private Network Access (14/09/2026, medido no smoke de produção): quando a
  // API é alcançada via Tailscale Funnel de DENTRO da tailnet, o hostname
  // resolve pro IP privado do nó (100.x) e o Chrome exige este header no
  // preflight, senão bloqueia com "Permission was denied". Quem está fora da
  // tailnet resolve o IP público do edge e nem nota. Sem ele, ninguém do
  // escritório conseguia usar o app publicado.
  app.addHook('onSend', (request, reply, _payload, done) => {
    if (request.headers.origin) {
      reply.header('Access-Control-Allow-Private-Network', 'true');
    }
    done();
  });
  // CSP desligado: a API não serve HTML nenhum (é puro JSON/WS), então a
  // única coisa que helmet precisa garantir aqui são os headers que fazem
  // sentido pra uma API pura (X-Content-Type-Options, X-Frame-Options,
  // Referrer-Policy etc) sem quebrar payload nenhum. HSTS só entra quando
  // já existe TLS na borda (ver docs/deploy) - forçar aqui sem TLS
  // configurado deixaria o browser recusando voltar pra HTTP puro em dev.
  await app.register(helmetPlugin, {
    contentSecurityPolicy: false,
    hsts: isProd,
  });
  // Global: teto generoso pra uso normal da equipe, alto o bastante pra
  // nunca incomodar um usuário real, baixo o bastante pra tornar flood
  // trivial (webhook do ClickUp, /chat disparando custo real) inviável sem
  // ser bloqueado. Rotas específicas mais sensíveis (ex: forgot-password)
  // recebem limite mais apertado no próprio arquivo de rota via `config.rateLimit`.
  await app.register(rateLimitPlugin, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
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
  await app.register(registerCanvasDocumentRoutes);
  await app.register(registerImageSearchRoutes);
  await app.register(registerFontRoutes);
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
  await app.register(registerCollaboratorRoutes);
  await app.register(registerSearchRoutes);
  await app.register(registerToolCallRoutes);
  await app.register(registerAutomationRoutes);
  await app.register(registerUploadRoutes);
  await app.register(registerAgentRoutes);
  await app.listen({ port, host: '0.0.0.0' });
  const healthSweepTimer = startHealthSweep(logger);
  // Sem isto o sweep acima derruba tudo pra offline em 60s: nossos agentes
  // não mandam heartbeat, é o Orchestrator que vai até eles.
  const agentProbeTimer = startAgentProbe(logger);
  // Vigia do worker: roda AQUI e não no worker, porque worker morto não avisa que morreu.
  const pararWatchdog = startWorkerWatchdog();
  // Sem isto `health_checks` cresce pra sempre (medido: +21 mil linhas/dia) e
  // a consulta do painel varre a tabela inteira, ficando mais lenta a cada dia.
  const retentionTimer = startHealthCheckRetention(logger);
  logger.info({ port }, 'Orchestrator API listening');

  // Sem isso, um restart/redeploy corta requisições em voo com SIGKILL e os
  // dois intervals acima seguem rodando até o processo morrer à força.
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down Orchestrator API');
    clearInterval(healthSweepTimer);
    clearInterval(agentProbeTimer);
    clearInterval(retentionTimer);
    pararWatchdog();
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ error }, 'Error during graceful shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error: unknown) => {
  logger.error({ error }, 'Failed to start Orchestrator API');
  process.exit(1);
});
