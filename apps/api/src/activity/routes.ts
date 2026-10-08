import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { escopoDeOrganizacao } from '../lib/escopo-de-organizacao';
import { organizacaoDeTrabalhoDe } from '../organizations/contexto';

/**
 * activity/routes.ts — a linha do tempo da operação.
 *
 * POR QUE PRECISOU EXISTIR: a tela de Atividade lia `/executions`, que são as
 * EXECUÇÕES de agente — "o Bento respondeu uma pergunta". Os acontecimentos da
 * operação de verdade vivem em `operational_events`, e em 02/10/2026 eram 902
 * linhas sem uma única rota que as lesse. A tabela crescia e ninguém via.
 *
 * O que ela guarda hoje, medido:
 *
 *   clickup / task.updated        541
 *   clickup / task.created        331
 *   mcp     / CONNECTION_CREATED   29
 *   chat    / CLIENT_DECISION       1
 *
 * A ROTA ENTREGA DADO DE APRESENTAÇÃO JÁ RESOLVIDO — nome do cliente junto,
 * não `client_id`. É deliberado: sem isso a tela faria uma consulta por evento
 * para descobrir de quem é, e com 902 eventos isso é o N+1 clássico. O nome sai
 * de um `left join`, numa consulta só.
 *
 * A FRONTEIRA É A MESMA DO RESTO: a empresa de trabalho da pessoa. Evento é
 * registro do que aconteceu dentro de uma empresa, e atravessar isso mostraria
 * a operação de um tenant para outro.
 */
export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string; client_id?: string; source?: string; entity_type?: string; entity_id?: string } }>(
    '/activity',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const escopo = await escopoDeOrganizacao(user);
      const deTrabalho = await organizacaoDeTrabalhoDe(user, { escopo });
      if (!deTrabalho) {
        reply.code(403);
        return { error: 'Sem empresa de trabalho definida.' };
      }

      const limite = Math.min(Math.max(Number(request.query.limit ?? 60), 1), 200);

      const filtros = [eq(schema.operationalEvents.organizationId, deTrabalho.id)];
      if (request.query.client_id) {
        filtros.push(eq(schema.operationalEvents.clientId, request.query.client_id));
      }
      if (request.query.source) {
        filtros.push(eq(schema.operationalEvents.source, request.query.source));
      }
      // Recorte por ENTIDADE (ex: uma campanha específica) — os dois vêm
      // juntos de propósito: entity_id sozinho pode colidir entre tabelas
      // diferentes que usam o mesmo formato de id.
      if (request.query.entity_type && request.query.entity_id) {
        filtros.push(eq(schema.operationalEvents.entityType, request.query.entity_type));
        filtros.push(eq(schema.operationalEvents.entityId, request.query.entity_id));
      }

      const linhas = await db
        .select({
          id: schema.operationalEvents.id,
          source: schema.operationalEvents.source,
          type: schema.operationalEvents.type,
          summary: schema.operationalEvents.summary,
          actor: schema.operationalEvents.actor,
          userId: schema.operationalEvents.userId,
          userName: schema.users.name,
          userAvatarUrl: schema.users.avatarUrl,
          clientId: schema.operationalEvents.clientId,
          clientName: schema.clients.name,
          payload: schema.operationalEvents.payload,
          occurredAt: schema.operationalEvents.occurredAt,
        })
        .from(schema.operationalEvents)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.operationalEvents.clientId))
        .leftJoin(schema.users, eq(schema.users.id, schema.operationalEvents.userId))
        .where(and(...filtros))
        .orderBy(desc(schema.operationalEvents.occurredAt))
        .limit(limite)
        .catch(() => []);

      /**
       * AS FONTES QUE DE FATO EXISTEM neste recorte, para a tela montar o
       * filtro sem oferecer opção vazia. Uma consulta a mais, mas sobre a
       * mesma tabela já quente — e evita a tela adivinhar quais fontes mostrar.
       */
      const fontes = await db
        .select({ source: schema.operationalEvents.source, total: sql<number>`count(*)::int` })
        .from(schema.operationalEvents)
        .where(eq(schema.operationalEvents.organizationId, deTrabalho.id))
        .groupBy(schema.operationalEvents.source)
        .catch(() => []);

      return {
        events: linhas.map((l) => ({
          id: l.id,
          source: l.source,
          type: l.type,
          summary: l.summary,
          actor: l.actor,
          user_id: l.userId,
          user_name: l.userName,
          user_avatar_url: l.userAvatarUrl,
          client_id: l.clientId,
          /** Já resolvido: a tela nunca mostra id, e nunca consulta por evento. */
          client_name: l.clientName,
          payload: l.payload,
          occurred_at: l.occurredAt ? new Date(l.occurredAt).toISOString() : null,
        })),
        sources: fontes,
        organizacao: { id: deTrabalho.id, name: deTrabalho.name },
      };
    },
  );
}
