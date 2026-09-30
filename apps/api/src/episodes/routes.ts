import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { tenantSharingScope } from '../lib/access';

/**
 * O QUE A OPERAÇÃO DECIDIU, PREFERIU E CORRIGIU.
 *
 * Os episódios (`agent_episodes`) são o registro do que foi FECHADO numa
 * conversa: uma decisão ("tá decidido, vamos com o conceito B"), uma
 * preferência durável ("esse cliente não usa promessa de resultado"), um
 * retorno sobre entrega, uma mudança de estado da operação.
 *
 * POR QUE ESTA ROTA EXISTE, e o erro que ela corrige: a tela de Decisões que
 * publiquei lia `memories` com `kind = 'decision'`. Esse kind NÃO EXISTE — a
 * consulta sempre voltava vazia, e a tela dizia "nenhuma decisão registrada
 * ainda" com toda a confiança, sobre um banco que tem 11 decisões, 9
 * preferências, 8 feedbacks e 3 mudanças operacionais.
 *
 * É o mesmo defeito do dia em outra roupa: uma tela afirmando ausência que ela
 * nunca verificou na fonte certa. "Não achei" e "não procurei no lugar certo"
 * parecem iguais pra quem lê, e pedem reações opostas.
 *
 * O RECORTE é o mesmo das outras listagens: sem ele, qualquer colaborador
 * autenticado leria decisão de qualquer organização — e decisão carrega mais
 * contexto de negócio que uma execução.
 */
export async function registerEpisodeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { type?: string; client_id?: string; limit?: string } }>(
    '/episodes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      const isMaster = user.roles.includes('master');
      const scope = isMaster ? null : await tenantSharingScope(user.id);
      const recorteDeTenant: SQL | undefined =
        scope === null
          ? undefined
          : or(
              scope.allowedClientIds.length > 0
                ? inArray(schema.agentEpisodes.clientId, scope.allowedClientIds)
                : undefined,
              and(
                isNull(schema.agentEpisodes.clientId),
                inArray(schema.agentEpisodes.userId, scope.teammateUserIds),
              ),
            );

      const limite = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 300);

      const linhas = await db
        .select({
          episodio: schema.agentEpisodes,
          clienteNome: schema.clients.name,
          autorNome: schema.users.name,
          autorEmail: schema.users.email,
        })
        .from(schema.agentEpisodes)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.agentEpisodes.clientId))
        .leftJoin(schema.users, eq(schema.users.id, schema.agentEpisodes.userId))
        .where(
          and(
            recorteDeTenant,
            // Episódio de QA não vira decisão de produção, pelo mesmo motivo que
            // vale pra memória: um "tá decidido" de teste vira regra real na
            // semana seguinte e ninguém acha a origem.
            eq(schema.agentEpisodes.environment, 'production'),
            request.query.type ? eq(schema.agentEpisodes.eventType, request.query.type) : undefined,
            request.query.client_id ? eq(schema.agentEpisodes.clientId, request.query.client_id) : undefined,
          ),
        )
        .orderBy(desc(schema.agentEpisodes.occurredAt))
        .limit(limite);

      return {
        episodes: linhas.map(({ episodio: e, clienteNome, autorNome, autorEmail }) => ({
          id: e.id,
          event_type: e.eventType,
          summary: e.summary,
          /**
           * O que foi decidido, os fatos que sustentam e o retorno, cada um na
           * sua lista. Vêm separados de propósito: colapsar tudo num texto só
           * apagaria a diferença entre "isto foi acordado" e "isto foi
           * observado", que é a diferença entre regra e contexto.
           */
          decisions: e.decisions,
          facts: e.facts,
          feedback: e.feedback,
          client_id: e.clientId,
          client_name: clienteNome,
          author_name: autorNome ?? autorEmail ?? null,
          agent: e.agent,
          conversation_id: e.conversationId,
          occurred_at: e.occurredAt?.toISOString() ?? null,
        })),
      };
    },
  );

  /** Os tipos que EXISTEM, com quantos de cada — pro filtro mostrar só o que há. */
  app.get('/episodes/types', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const linhas = await db
      .select({ eventType: schema.agentEpisodes.eventType })
      .from(schema.agentEpisodes)
      .where(eq(schema.agentEpisodes.environment, 'production'));

    const contagem = new Map<string, number>();
    for (const l of linhas) contagem.set(l.eventType, (contagem.get(l.eventType) ?? 0) + 1);

    return {
      types: [...contagem.entries()].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total),
    };
  });
}
