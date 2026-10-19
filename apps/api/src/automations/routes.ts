import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { proximasExecucoes, registerAutomationJob, removeAutomationJob, runAutomationNow } from '@desigual-os/orchestrator';
import { AGENT_NAMES, type AgentName } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { requireModule } from '../auth/require-module';
import { clientBelongsToTenant, requireTenant } from '../lib/tenant-context';

const agentNameSchema = z.enum([...AGENT_NAMES] as [AgentName, ...AgentName[]]);

const createAutomationSchema = z.object({
  name: z.string().min(1),
  agent: agentNameSchema,
  prompt: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  schedule: z.string().min(1),
  schedule_label: z.string().min(1),
});

const updateAutomationSchema = z.object({
  name: z.string().min(1).optional(),
  agent: agentNameSchema.optional(),
  prompt: z.string().min(1).optional(),
  client_id: z.string().uuid().nullable().optional(),
  estimated_minutes_saved: z.number().int().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
  schedule: z.string().min(1).optional(),
  schedule_label: z.string().min(1).optional(),
});

/**
 * `proximaExecucao` em ms vem de FORA: é o `next` do repeatable job do BullMQ,
 * ou seja, a hora que o agendador realmente vai disparar — não um recálculo
 * nosso do cron, que viraria uma segunda opinião e divergiria no momento em
 * que alguém editasse o schedule. `null` quando a automação não tem repeatable
 * registrado, e essa ausência é informação: ela está no banco e não está
 * agendada em lugar nenhum.
 */
function serializeAutomation(row: typeof schema.automations.$inferSelect, proximaExecucaoMs?: number | undefined) {
  return {
    id: row.id,
    name: row.name,
    agent: row.agent,
    prompt: row.prompt,
    client_id: row.clientId,
    conversation_id: row.conversationId,
    schedule: row.schedule,
    schedule_label: row.scheduleLabel,
    enabled: row.enabled,
    estimated_minutes_saved: row.estimatedMinutesSaved,
    last_run_at: row.lastRunAt?.toISOString() ?? null,
    next_run_at: proximaExecucaoMs !== undefined ? new Date(proximaExecucaoMs).toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Automação agendada (pedido do usuário, 2026-09-03): "todo dia às 8h o
 * Bento analisa o ClickUp...". Compartilhada pela equipe, igual ao chat -
 * qualquer master/colaborador com `chat:write` cria, vê e gerencia
 * qualquer automação, não só as próprias.
 */
export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    await requireAuth(request, reply);
    if (!reply.sent) await requireTenant(request, reply);
  });
  app.get('/automations', { preHandler: requireModule('automations') }, async (request, reply) => {
    if (!request.authUser) { reply.code(401); return { error: 'Not authenticated' }; }
    const rows = await db.select().from(schema.automations)
      .where(eq(schema.automations.organizationId, request.tenantContext!.organizationId))
      .orderBy(desc(schema.automations.createdAt));
    /**
     * O REDIS PRECISA DESISTIR SOZINHO, e `.catch()` não dá conta disso.
     *
     * Falha ao falar com o Redis não pode derrubar a listagem: sem o mapa,
     * cada automação sai com `next_run_at: null`, que a tela já sabe
     * apresentar. Mas tratar só a REJEIÇÃO deixa passar o caso mais comum —
     * Redis fora do ar não rejeita rápido, o ioredis entra em retentativa e
     * demora muito mais do que uma tela pode esperar.
     *
     * Medido em 09/10/2026, na captura visual: a tela de Automações ficou com
     * seis esqueletos eternos num ambiente sem Redis local, enquanto todas as
     * outras carregaram. A listagem não estava quebrada — estava esperando.
     *
     * Um segundo e meio é folgado pra um Redis que existe (responde em
     * milissegundos) e curto pra um que não existe. O acessório nunca segura
     * o essencial.
     */
    const SEM_RESPOSTA = new Map<string, number>();
    const proximas = await Promise.race([
      proximasExecucoes().catch(() => SEM_RESPOSTA),
      new Promise<Map<string, number>>((r) => setTimeout(() => r(SEM_RESPOSTA), 1500)),
    ]);
    return { automations: rows.map((row) => serializeAutomation(row, proximas.get(row.id))) };
  });

  // Registrada antes das rotas com :id para não disputar matching com
  // /automations/:id/... (Fastify dá prioridade a rota estática, mas assim
  // a intenção fica explícita).
  app.get('/automations/metrics', { preHandler: requireModule('automations') }, async (request) => {
    const tenantFilter = eq(schema.automations.organizationId, request.tenantContext!.organizationId);
    const runFilter = inArray(schema.automationRuns.automationId,
      db.select({ id: schema.automations.id }).from(schema.automations).where(tenantFilter));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    // Janelas "hoje/ontem/mês" seguem o timezone do servidor, como combinado.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - DAY_MS);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);

    /**
     * DUAS IDAS AO BANCO, e não nove — mas o motivo NÃO é o número de idas.
     *
     * `/automations/metrics` levava 10,2s, medido no navegador em 09/10/2026.
     * A rota fazia nove consultas em série sobre as mesmas duas tabelas.
     *
     * A PRIMEIRA EXPLICAÇÃO QUE EU ESCREVI AQUI ESTAVA ERRADA, e fica
     * registrada porque o erro é instrutivo. Eu disse que paralelizar com
     * `Promise.all` tinha piorado por contenção no pool de três conexões.
     * Medido depois, contra o banco de verdade:
     *
     *   uma successRate, que trazia as linhas ....... 2045ms
     *   uma contagem simples .......................... 347ms
     *   oito contagens em série ...................... 2710ms
     *   oito contagens em paralelo (pool 3) .......... 2148ms
     *   um agregado com filter ........................ 295ms
     *
     * Paralelo era MAIS RÁPIDO que série, não mais lento. A minha leitura de
     * "paralelismo acima do pool troca fila por fila" não se sustenta DENTRO de
     * uma rota e não deve ser generalizada.
     *
     * Uma distinção que custou três retratações até ficar clara, e que vale
     * escrita: contenção de pool É REAL, mas no nível da TELA, não da rota. Uma
     * tela que dispara treze pedidos simultâneos contra um pool de três
     * serializa mesmo, e cada ida ao Supabase tem piso de ~270ms (medido no
     * responseTime da própria API; `/consent/fontes`, que não consulta nada,
     * responde em 1ms). O que NÃO acontece é oito consultas de uma mesma rota
     * ficarem mais lentas por serem paralelas.
     *
     * O pool é três por decisão, não por descuido: o Supabase trava o projeto
     * em quinze sessões divididas entre API, worker e nodes, e está escrito em
     * `packages/database/src/client.ts`. Aumentar tira conexão de outro
     * processo.
     *
     * O QUE DE FATO CUSTAVA: `successRate` trazia TODAS as linhas de execução
     * da janela para contar status no Node, e a rota fazia isso TRÊS vezes (30
     * dias, 7 dias, 7 anteriores). Dois segundos cada, seis no total, antes de
     * qualquer outra coisa. O ganho veio de parar de embarcar linha para contar
     * fora do banco, não de reduzir viagens: 2045ms viram 295ms na mesma
     * pergunta.
     *
     * Reduzir nove consultas a duas é consequência de usar
     * `count(*) filter (where ...)`, que resolve todas as janelas numa varredura
     * só. É bom, mas é o efeito menor.
     *
     * E os filtros usam os OPERADORES do drizzle (`gte`, `lt`, `eq`) em vez de
     * escrever a comparação dentro do `sql`. Não é estilo: um `Date` cru
     * interpolado num fragmento `sql` não é ligado como parâmetro e a consulta
     * morre com "The string argument must be of type string... Received an
     * instance of Date". A primeira versão disto devolveu 500 por exatamente
     * isso, e o 500 só apareceu no navegador — typecheck e build passaram.
     */
    const [resumoDasAutomacoes] = await db
      .select({
        ativas: sql<number>`count(*) filter (where ${eq(schema.automations.enabled, true)})::int`,
        criadasNoMes: sql<number>`count(*) filter (where ${gte(schema.automations.createdAt, startOfMonth)})::int`,
        comEstimativa: sql<number>`count(*) filter (where ${isNotNull(schema.automations.estimatedMinutesSaved)})::int`,
      })
      .from(schema.automations)
      .where(tenantFilter);

    const [resumoDasExecucoes] = await db
      .select({
        hoje: sql<number>`count(*) filter (where ${gte(schema.automationRuns.startedAt, startOfToday)})::int`,
        ontem: sql<number>`count(*) filter (where ${and(gte(schema.automationRuns.startedAt, startOfYesterday), lt(schema.automationRuns.startedAt, startOfToday))})::int`,
        total30: sql<number>`count(*) filter (where ${gte(schema.automationRuns.startedAt, thirtyDaysAgo)})::int`,
        ok30: sql<number>`count(*) filter (where ${and(gte(schema.automationRuns.startedAt, thirtyDaysAgo), eq(schema.automationRuns.status, 'dispatched'))})::int`,
        total7: sql<number>`count(*) filter (where ${gte(schema.automationRuns.startedAt, sevenDaysAgo)})::int`,
        ok7: sql<number>`count(*) filter (where ${and(gte(schema.automationRuns.startedAt, sevenDaysAgo), eq(schema.automationRuns.status, 'dispatched'))})::int`,
        totalAnteriores7: sql<number>`count(*) filter (where ${and(gte(schema.automationRuns.startedAt, fourteenDaysAgo), lt(schema.automationRuns.startedAt, sevenDaysAgo))})::int`,
        okAnteriores7: sql<number>`count(*) filter (where ${and(gte(schema.automationRuns.startedAt, fourteenDaysAgo), lt(schema.automationRuns.startedAt, sevenDaysAgo), eq(schema.automationRuns.status, 'dispatched'))})::int`,
        minutosNoMes: sql<number>`coalesce(sum(${schema.automations.estimatedMinutesSaved}) filter (where ${gte(schema.automationRuns.startedAt, startOfMonth)}), 0)::int`,
      })
      .from(schema.automationRuns)
      .innerJoin(schema.automations, eq(schema.automationRuns.automationId, schema.automations.id))
      .where(tenantFilter);

    /** Sem execução na janela não existe taxa. `null`, nunca 0% nem 100%. */
    function taxa(ok: number, total: number): number | null {
      return total === 0 ? null : Math.round((ok / total) * 1000) / 10;
    }

    const activeCount = resumoDasAutomacoes?.ativas ?? 0;
    const createdThisMonth = resumoDasAutomacoes?.criadasNoMes ?? 0;
    const runsToday = resumoDasExecucoes?.hoje ?? 0;
    const runsYesterday = resumoDasExecucoes?.ontem ?? 0;
    const rateLast30d = taxa(resumoDasExecucoes?.ok30 ?? 0, resumoDasExecucoes?.total30 ?? 0);
    const rateLast7d = taxa(resumoDasExecucoes?.ok7 ?? 0, resumoDasExecucoes?.total7 ?? 0);
    const ratePrev7d = taxa(resumoDasExecucoes?.okAnteriores7 ?? 0, resumoDasExecucoes?.totalAnteriores7 ?? 0);

    // Só faz sentido somar tempo economizado se ALGUMA automação tiver a
    // estimativa cadastrada; senão o campo sai null (não zero).
    const timeSavedMinutes =
      (resumoDasAutomacoes?.comEstimativa ?? 0) > 0 ? (resumoDasExecucoes?.minutosNoMes ?? 0) : null;

    return {
      active_count: activeCount,
      active_delta_month: createdThisMonth > 0 ? createdThisMonth : null,
      runs_today: runsToday,
      runs_today_delta: runsToday === 0 && runsYesterday === 0 ? null : runsToday - runsYesterday,
      success_rate: rateLast30d,
      success_delta_week:
        rateLast7d !== null && ratePrev7d !== null ? Math.round((rateLast7d - ratePrev7d) * 10) / 10 : null,
      time_saved_minutes: timeSavedMinutes,
    };
  });

  app.post(
    '/automations',
    { preHandler: [requireAuth, requirePermission('chat', 'write'), requireModule('automations')] },
    async (request, reply) => {
      const body = createAutomationSchema.parse(request.body);
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const tenant = request.tenantContext!;
      if (body.client_id && !(await clientBelongsToTenant(body.client_id, tenant.organizationId))) {
        reply.code(403); return { error: 'Client is outside your organization' };
      }

      const [conversation] = await db
        .insert(schema.conversations)
        .values({ userId: user.id, clientId: body.client_id ?? null, title: `Automação: ${body.name}` })
        .returning();

      const [automation] = await db
        .insert(schema.automations)
        .values({
          organizationId: tenant.organizationId,
          name: body.name,
          createdBy: user.id,
          agent: body.agent,
          prompt: body.prompt,
          clientId: body.client_id ?? null,
          conversationId: conversation?.id ?? null,
          schedule: body.schedule,
          scheduleLabel: body.schedule_label,
        })
        .returning();

      if (!automation) {
        reply.code(500);
        return { error: 'Failed to create automation' };
      }

      try {
        await registerAutomationJob(automation.id, automation.schedule);
      } catch (error) {
        // Cron inválido só é descoberto aqui (BullMQ/cron-parser validam o pattern
        // de verdade); sem isso a automação ficava salva mas nunca disparava.
        await db.delete(schema.automations).where(eq(schema.automations.id, automation.id));
        reply.code(400);
        return { error: `Agenda inválida: ${error instanceof Error ? error.message : String(error)}` };
      }

      reply.code(201);
      return serializeAutomation(automation);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/automations/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write'), requireModule('automations')] },
    async (request, reply) => {
      const body = updateAutomationSchema.parse(request.body);
      const [existing] = await db.select().from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }
      if (existing.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
      }
      if (body.client_id && !(await clientBelongsToTenant(body.client_id, request.tenantContext!.organizationId))) {
        reply.code(403); return { error: 'Client is outside your organization' };
      }

      const nextEnabled = body.enabled ?? existing.enabled;
      const nextSchedule = body.schedule ?? existing.schedule;
      const scheduleChanged = nextSchedule !== existing.schedule;

      // Se a agenda mudou (ou desativou), o repeatable job antigo precisa sumir -
      // BullMQ não troca o pattern de um job já registrado, só remove/recria.
      if (scheduleChanged || !nextEnabled) {
        await removeAutomationJob(existing.id, existing.schedule);
      }
      if (nextEnabled && (scheduleChanged || !existing.enabled)) {
        try {
          await registerAutomationJob(existing.id, nextSchedule);
        } catch (error) {
          reply.code(400);
          return { error: `Agenda inválida: ${error instanceof Error ? error.message : String(error)}` };
        }
      }

      const [updated] = await db
        .update(schema.automations)
        .set({
          name: body.name ?? existing.name,
          agent: body.agent ?? existing.agent,
          prompt: body.prompt ?? existing.prompt,
          clientId: body.client_id !== undefined ? body.client_id : existing.clientId,
          estimatedMinutesSaved:
            body.estimated_minutes_saved !== undefined ? body.estimated_minutes_saved : existing.estimatedMinutesSaved,
          enabled: nextEnabled,
          schedule: nextSchedule,
          scheduleLabel: body.schedule_label ?? existing.scheduleLabel,
          updatedAt: new Date(),
        })
        .where(eq(schema.automations.id, existing.id))
        .returning();

      return serializeAutomation(updated!);
    },
  );

  // "Executar agora": job único na fila (sem repeatable), disparado mesmo com
  // a automação desabilitada - o worker só pula enabled=false em disparo agendado.
  app.post<{ Params: { id: string } }>(
    '/automations/:id/run',
    { preHandler: [requireAuth, requirePermission('chat', 'write'), requireModule('automations')] },
    async (request, reply) => {
      const [existing] = await db
        .select({ id: schema.automations.id, organizationId: schema.automations.organizationId })
        .from(schema.automations)
        .where(eq(schema.automations.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }
      if (existing.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
      }

      await runAutomationNow(existing.id);

      reply.code(202);
      return { status: 'queued' };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/automations/:id',
    { preHandler: [requireAuth, requirePermission('chat', 'write'), requireModule('automations')] },
    async (request, reply) => {
      const [existing] = await db.select().from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!existing) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }
      if (existing.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
      }

      await removeAutomationJob(existing.id, existing.schedule);
      await db.delete(schema.automations).where(eq(schema.automations.id, existing.id));

      reply.code(204);
      return null;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/automations/:id/runs',
    { preHandler: [requireAuth, requireModule('automations')] },
    async (request, reply) => {
      const [automation] = await db.select({ id: schema.automations.id }).from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!automation) {
        reply.code(404);
        return { error: `Automation '${request.params.id}' not found` };
      }

      if (!request.authUser) { reply.code(401); return { error: 'Not authenticated' }; }
      const [scoped] = await db.select({ organizationId: schema.automations.organizationId }).from(schema.automations).where(eq(schema.automations.id, request.params.id));
      if (!scoped || scoped.organizationId !== request.tenantContext!.organizationId) {
        reply.code(403); return { error: 'Automation is outside your organization' };
      }

      const rows = await db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.automationId, request.params.id))
        .orderBy(desc(schema.automationRuns.startedAt))
        .limit(50);

      return {
        runs: rows.map((row) => ({
          id: row.id,
          status: row.status,
          error: row.error,
          started_at: row.startedAt.toISOString(),
          completed_at: row.completedAt?.toISOString() ?? null,
        })),
      };
    },
  );
}
