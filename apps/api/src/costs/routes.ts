import type { FastifyInstance } from 'fastify';
import { and, gte, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth, requirePermission } from '../auth/middleware';
import { escopoDeOrganizacao, organizacaoProvedora, recorteViaClienteOuPessoa } from '../lib/escopo-de-organizacao';
import { organizacaoDeTrabalhoDe } from '../organizations/contexto';

function rangeToDate(range: string | undefined): Date {
  const days = range?.endsWith('d') ? Number(range.slice(0, -1)) : 30;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
}

export async function registerCostRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { range?: string } }>(
    '/costs/overview',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request, reply) => {
      const usuario = request.authUser;
      if (!usuario) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const since = rangeToDate(request.query.range);
      /**
       * QUANTO A MINHA EMPRESA GASTOU, não quanto todas gastaram.
       *
       * `cost_records` ganhou `organization_id` na migração 0049 (escrita +
       * backfill), mas a fronteira aqui continua saindo do vínculo — cliente
       * ou pessoa: é o que mantém visíveis as linhas antigas sem vínculo
       * nenhum e compatível o recorte de quem já dependia dele. Sem isto, uma
       * empresa enxerga o volume de uso da outra — que é vazamento por
       * agregação, o mesmo padrão que já apareceu três vezes em lugares
       * diferentes. Custo por empresa com subárvore (white label) tem rota
       * própria: GET /organizations/:id/costs.
       */
      const daMinhaEmpresa = recorteViaClienteOuPessoa(
        usuario,
        schema.costRecords.clientId,
        schema.costRecords.userId,
      );

      const [totals] = await db
        .select({
          totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
          eventCount: sql<number>`count(*)`,
        })
        .from(schema.costRecords)
        .where(and(gte(schema.costRecords.createdAt, since), daMinhaEmpresa));

      const [tokenTotals] = await db
        .select({
          inputTokens: sql<string>`coalesce(sum(${schema.tokenUsage.inputTokens}), 0)`,
          outputTokens: sql<string>`coalesce(sum(${schema.tokenUsage.outputTokens}), 0)`,
        })
        .from(schema.tokenUsage)
        /**
         * `token_usage` ganhou `organization_id` na 0049, mas linhas antigas
         * sem vínculo continuam existindo — então a fronteira aqui segue pela
         * execution, que é o vínculo que SEMPRE existiu. Execução sem dono
         * continua entrando: sumir com número hoje confundiria mais do que
         * protege.
         */
        .where(
          and(
            gte(schema.tokenUsage.createdAt, since),
            sql`(
              ${schema.tokenUsage.executionId} is null
              or exists (
                select 1 from executions e
                where e.id = ${schema.tokenUsage.executionId}
                  and (e.organization_id is null or e.organization_id in (
                    select organization_id from organization_members where user_id = ${usuario.id}::uuid
                  ))
              )
            )`,
          ),
        );

      return {
        range_days: Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
        total_cost_usd: Number(totals?.totalCost ?? 0),
        cost_events: totals?.eventCount ?? 0,
        total_input_tokens: Number(tokenTotals?.inputTokens ?? 0),
        total_output_tokens: Number(tokenTotals?.outputTokens ?? 0),
        note:
          'Custo aproximado: modelo real usado pelo OpenClaw ainda não é reportado (ver Fase 04). ' +
          'Bento, Jarbas e Suzy usam contagem de tokens estimada por caracteres (o bento-qa e o susy-service ' +
          'não reportam usage de verdade); Otto e Studio usam contagem real. Ver packages/token-engine.',
      };
    },
  );

  app.get<{ Querystring: { range?: string } }>(
    '/costs/by-agent',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request, reply) => {
      const usuario = request.authUser;
      if (!usuario) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const since = rangeToDate(request.query.range);
      /**
       * QUANTO A MINHA EMPRESA GASTOU, não quanto todas gastaram.
       *
       * `cost_records` ganhou `organization_id` na migração 0049 (escrita +
       * backfill), mas a fronteira aqui continua saindo do vínculo — cliente
       * ou pessoa: é o que mantém visíveis as linhas antigas sem vínculo
       * nenhum e compatível o recorte de quem já dependia dele. Sem isto, uma
       * empresa enxerga o volume de uso da outra — que é vazamento por
       * agregação, o mesmo padrão que já apareceu três vezes em lugares
       * diferentes. Custo por empresa com subárvore (white label) tem rota
       * própria: GET /organizations/:id/costs.
       */
      const daMinhaEmpresa = recorteViaClienteOuPessoa(
        usuario,
        schema.costRecords.clientId,
        schema.costRecords.userId,
      );
      const rows = await db
        .select({
          agent: schema.costRecords.agent,
          totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
          eventCount: sql<number>`count(*)`,
        })
        .from(schema.costRecords)
        .where(and(gte(schema.costRecords.createdAt, since), daMinhaEmpresa))
        .groupBy(schema.costRecords.agent);

      return {
        by_agent: rows.map((row) => ({
          agent: row.agent,
          total_cost_usd: Number(row.totalCost),
          events: row.eventCount,
        })),
      };
    },
  );

  app.get<{ Querystring: { range?: string } }>(
    '/costs/by-client',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request, reply) => {
      const usuario = request.authUser;
      if (!usuario) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const since = rangeToDate(request.query.range);
      /**
       * QUANTO A MINHA EMPRESA GASTOU, não quanto todas gastaram.
       *
       * `cost_records` ganhou `organization_id` na migração 0049 (escrita +
       * backfill), mas a fronteira aqui continua saindo do vínculo — cliente
       * ou pessoa: é o que mantém visíveis as linhas antigas sem vínculo
       * nenhum e compatível o recorte de quem já dependia dele. Sem isto, uma
       * empresa enxerga o volume de uso da outra — que é vazamento por
       * agregação, o mesmo padrão que já apareceu três vezes em lugares
       * diferentes. Custo por empresa com subárvore (white label) tem rota
       * própria: GET /organizations/:id/costs.
       */
      const daMinhaEmpresa = recorteViaClienteOuPessoa(
        usuario,
        schema.costRecords.clientId,
        schema.costRecords.userId,
      );
      const rows = await db
        .select({
          clientId: schema.costRecords.clientId,
          clientName: schema.clients.name,
          totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
        })
        .from(schema.costRecords)
        .leftJoin(schema.clients, sql`${schema.costRecords.clientId} = ${schema.clients.id}`)
        .where(and(gte(schema.costRecords.createdAt, since), daMinhaEmpresa))
        .groupBy(schema.costRecords.clientId, schema.clients.name);

      return {
        by_client: rows.map((row) => ({
          client_id: row.clientId,
          client_name: row.clientName ?? null,
          total_cost_usd: Number(row.totalCost),
        })),
      };
    },
  );

  // economy_records passou a ser escrito de verdade em 08/09/2026
  // (finalizeExecutionCost, ver cost-service.ts) - antes disso a tabela
  // existia migrada no banco desde a Fase 11, mas nada escrevia nela.
  app.get<{ Querystring: { range?: string } }>(
    '/costs/economy',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request, reply) => {
      const usuario = request.authUser;
      if (!usuario) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const since = rangeToDate(request.query.range);
      /**
       * ESTA ERA A ÚNICA ROTA DE CUSTO SEM RECORTE NENHUM — agregava
       * `economy_records` do banco INTEIRO para qualquer conta com
       * `costs:read`. Correção de 05/10/2026, do mesmo vazamento cross-tenant
       * de `/memories`: vazamento por agregação continua vazamento (o tamanho
       * da operação do outro tenant já entrega carteira e volume).
       *
       * `economy_records` não tem `organization_id` própria; o vínculo é o que
       * sempre existiu: `execution_id -> executions.organization_id` (a coluna
       * é NOT NULL — toda linha tem execution). A regra de NULL (legado
       * pré-0045, visível SOMENTE no contexto da provedora) vale sobre a org
       * da EXECUTION, como no resto do produto.
       */
      const escopo = await escopoDeOrganizacao(usuario);
      const deTrabalho = await organizacaoDeTrabalhoDe(usuario, { escopo });
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }
      const legadoVisivel = organizacaoProvedora() === deTrabalho.id;
      const [totals] = await db
        .select({
          estimatedCost: sql<string>`coalesce(sum(${schema.economyRecords.estimatedCost}), 0)`,
          actualCost: sql<string>`coalesce(sum(${schema.economyRecords.actualCost}), 0)`,
          savedAmount: sql<string>`coalesce(sum(${schema.economyRecords.savedAmount}), 0)`,
          executionCount: sql<number>`count(*)`,
        })
        .from(schema.economyRecords)
        .where(
          and(
            gte(schema.economyRecords.createdAt, since),
            sql`exists (
              select 1 from executions e
              where e.id = ${schema.economyRecords.executionId}
                and (e.organization_id = ${deTrabalho.id}::uuid
                     or (${legadoVisivel} and e.organization_id is null))
            )`,
          ),
        );

      const estimatedCost = Number(totals?.estimatedCost ?? 0);
      const savedAmount = Number(totals?.savedAmount ?? 0);

      return {
        range_days: Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
        executions_compared: totals?.executionCount ?? 0,
        estimated_cost_usd: estimatedCost,
        actual_cost_usd: Number(totals?.actualCost ?? 0),
        saved_amount_usd: savedAmount,
        saved_percentage:
          estimatedCost > 0 ? Number(((savedAmount / estimatedCost) * 100).toFixed(2)) : 0,
        note: 'Estimativa pré-execução aproximada por caracteres (ver estimateCost em @desigual-os/token-engine), comparada ao custo real medido depois. Só cobre execuções criadas após 08/09/2026 (estimatedCost não existia antes disso).',
      };
    },
  );

  app.get<{ Querystring: { range?: string } }>(
    '/costs/by-user',
    { preHandler: [requireAuth, requirePermission('costs', 'read')] },
    async (request, reply) => {
      const usuario = request.authUser;
      if (!usuario) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      const since = rangeToDate(request.query.range);
      /**
       * QUANTO A MINHA EMPRESA GASTOU, não quanto todas gastaram.
       *
       * `cost_records` ganhou `organization_id` na migração 0049 (escrita +
       * backfill), mas a fronteira aqui continua saindo do vínculo — cliente
       * ou pessoa: é o que mantém visíveis as linhas antigas sem vínculo
       * nenhum e compatível o recorte de quem já dependia dele. Sem isto, uma
       * empresa enxerga o volume de uso da outra — que é vazamento por
       * agregação, o mesmo padrão que já apareceu três vezes em lugares
       * diferentes. Custo por empresa com subárvore (white label) tem rota
       * própria: GET /organizations/:id/costs.
       */
      const daMinhaEmpresa = recorteViaClienteOuPessoa(
        usuario,
        schema.costRecords.clientId,
        schema.costRecords.userId,
      );
      const rows = await db
        .select({
          userId: schema.costRecords.userId,
          userName: schema.users.name,
          totalCost: sql<string>`coalesce(sum(${schema.costRecords.amount}), 0)`,
        })
        .from(schema.costRecords)
        .leftJoin(schema.users, sql`${schema.costRecords.userId} = ${schema.users.id}`)
        .where(and(gte(schema.costRecords.createdAt, since), daMinhaEmpresa))
        .groupBy(schema.costRecords.userId, schema.users.name);

      return {
        by_user: rows.map((row) => ({
          user_id: row.userId,
          user_name: row.userName ?? null,
          total_cost_usd: Number(row.totalCost),
        })),
      };
    },
  );
}
