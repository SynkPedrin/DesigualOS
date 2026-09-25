import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { readWorkerHealth } from '@desigual-os/orchestrator';
import { isOpenAICredentialConfigured } from '@desigual-os/openai-provider';

/**
 * /ready — readiness operacional (P1-06 da auditoria de 25/09/2026, seção 28
 * da missão de release OpenAI + ClickUp MCP).
 *
 * Regra que não se negocia: esta rota NUNCA chama a OpenAI nem o ClickUp
 * MCP. Ela só verifica PRESENÇA de configuração/credencial e saúde de
 * dependências que já respondem por si mesmas (DB, fila, worker) — zero
 * custo, zero chamada paga, apropriada para health-check de infra
 * (load balancer, orquestrador de deploy) que roda a cada poucos segundos.
 *
 * Difere de /health: /health é liveness (o processo está de pé); /ready é
 * "este processo pode atender tráfego real de operação agora".
 */
export async function registerReadyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, boolean> = {};
    let overallOk = true;

    try {
      await db.execute(sql`select 1`);
      checks.database = true;
    } catch {
      checks.database = false;
      overallOk = false;
    }

    let worker: Awaited<ReturnType<typeof readWorkerHealth>> | null = null;
    try {
      worker = await readWorkerHealth();
      checks.queue = true;
      checks.worker_heartbeat = worker.online;
      if (!worker.online) overallOk = false;
    } catch {
      checks.queue = false;
      checks.worker_heartbeat = false;
      overallOk = false;
    }

    // Presença de credencial, não validade contra o provedor real (isso
    // custaria uma chamada). Sem OPENAI_API_KEY o sistema ainda pode estar
    // "pronto" para tráfego que não depende de OpenAI (ex: rollback pra
    // Ollama via feature flag) — por isso este check NÃO derruba overallOk
    // sozinho; ele é informativo para o gate de release.
    checks.openai_credential_configured = isOpenAICredentialConfigured();

    // ClickUp MCP OAuth: o servidor MCP usa client PÚBLICO com registration
    // dinâmica (RFC 7591) — não há client_id/secret fixo pra checar
    // presença. O único pré-requisito de infra é NODE_SECRET (assina o
    // state do fluxo, ver apps/api/src/integrations/clickup-mcp-routes.ts);
    // a autorização em si é por colaborador e não bloqueia o /ready do
    // serviço como um todo.
    checks.clickup_mcp_oauth_infra_ready = Boolean(process.env.NODE_SECRET?.trim());

    // Fallback compartilhado do ClickUp (gateway legado) segue contando como
    // "ClickUp está acessível", independente do MCP ainda não estar
    // autorizado — ver packages/tool-gateway/src/clickup-oauth.ts e a regra
    // de missão "manter gateway existente como fallback temporário".
    checks.clickup_shared_access_configured = Boolean(
      process.env.CLICKUP_API_KEY?.trim() && process.env.CLICKUP_TEAM_ID?.trim(),
    );

    const featureFlags = {
      otto_motion_enabled: process.env.OTTO_MOTION_ENABLED === 'true',
      bento_multi_action_write: process.env.BENTO_MULTI_ACTION_WRITE === 'true',
    };

    reply.code(overallOk ? 200 : 503);
    return {
      ready: overallOk,
      checks,
      feature_flags: featureFlags,
      timestamp: new Date().toISOString(),
    };
  });
}
