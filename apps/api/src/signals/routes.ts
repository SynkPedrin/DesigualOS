import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { tenantSharingScope } from '../lib/access';
import { RECUSA_DE_STATUS, ehDesfechoDePessoa } from './tratamento';

/**
 * OS SINAIS PROATIVOS — o que o sistema percebeu sozinho e quer contar.
 *
 * `proactive_signals` é onde caem os avisos que ninguém pediu: prazo que vai
 * estourar, criativo rejeitado, decisão de cliente registrada, erro achado. O
 * event bus os escreve; o MCP sabe lê-los pelo `get_signals`.
 *
 * ESTA ROTA EXISTE PORQUE FALTAVA O LEITOR DE GENTE. Conferido em 30/09/2026:
 * `proactiveSignals` não aparecia UMA vez em apps/api, apps/worker ou
 * tool-gateway fora de teste. Só o Claude, via MCP, conseguia ver. Quem abre o
 * Desigual OS no navegador — que é onde a operação vive — não tinha como saber
 * que o sistema tinha percebido alguma coisa.
 *
 * Sinal que só um agente lê é o mesmo defeito do `CONNECTION_CREATED` que
 * morria no banco, numa roupa mais cara: ali o sistema deixava de AVISAR; aqui
 * ele deixa de entregar justamente a percepção que é a razão de ele existir.
 *
 * O NÚMERO QUE DIMENSIONA ISSO, e que vale registrar pra ninguém exagerar
 * depois: a tabela tinha UMA linha quando esta rota foi escrita, criada no
 * mesmo dia por um teste. Não havia acervo represado. O sistema de sinal
 * simplesmente nunca tinha disparado em produção — feature nunca ligada, não
 * vazamento.
 */
export async function registerSignalsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string; client_id?: string; limit?: string } }>(
    '/signals',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      /**
       * Mesma fronteira das outras listagens: sem recorte de organização,
       * qualquer colaborador leria sinal de cliente que não é dele — e sinal
       * carrega justamente o que está dando errado numa conta.
       */
      const isMaster = user.roles.includes('master');
      const scope = isMaster ? null : await tenantSharingScope(user.id);
      const recorteDeTenant: SQL | undefined =
        scope === null
          ? undefined
          : or(
              scope.allowedClientIds.length > 0
                ? inArray(schema.proactiveSignals.clientId, scope.allowedClientIds)
                : undefined,
              // Sinal sem cliente é da operação inteira: todo mundo vê.
              isNull(schema.proactiveSignals.clientId),
            );

      /**
       * `pending` por padrão. Sinal tratado continua na tabela (o histórico
       * importa), mas misturá-lo com o que está aberto faria a tela apresentar
       * como pendência o que alguém já resolveu — e uma lista que mente sobre
       * o que falta fazer é pior que lista nenhuma.
       */
      const status = request.query.status ?? 'pending';
      const limite = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 300);

      const filtros = and(
        recorteDeTenant,
        status === 'all' ? undefined : eq(schema.proactiveSignals.status, status),
        request.query.client_id ? eq(schema.proactiveSignals.clientId, request.query.client_id) : undefined,
      );

      const linhas = await db
        .select({
          sinal: schema.proactiveSignals,
          clienteNome: schema.clients.name,
        })
        .from(schema.proactiveSignals)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.proactiveSignals.clientId))
        .orderBy(desc(schema.proactiveSignals.createdAt))
        .where(filtros)
        .limit(limite);

      // Mesmos filtros da listagem: total que conta outra coisa que a lista é
      // como a tela de Memória passou a dizer "150" havendo 396.
      const [contagem] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.proactiveSignals)
        .where(filtros);

      return {
        total: contagem?.total ?? 0,
        mostrando: linhas.length,
        signals: linhas.map(({ sinal: s, clienteNome }) => ({
          id: s.id,
          rule: s.rule,
          agent: s.agent,
          severity: s.severity,
          title: s.title,
          body: s.body,
          recommended_action: s.recommendedAction,
          client_id: s.clientId,
          client_name: clienteNome,
          entity: s.entityType && s.entityId ? `${s.entityType}:${s.entityId}` : null,
          /** `null` quando a regra não declarou confiança. Nunca 0, que seria "tenho certeza que não". */
          confidence: s.confidence === null ? null : Number(s.confidence),
          status: s.status,
          created_at: s.createdAt?.toISOString() ?? null,
        })),
      };
    },
  );

  /**
   * TRATAR UM SINAL — o que fecha o ciclo.
   *
   * O schema já previa `dismissed` e `resolved` e ninguém nunca escreveu neles.
   * Sem isto, a lista só cresce: quem lê não tem como dizer "vi, cuidei", e na
   * terceira visita a tela vira ruído que se aprende a ignorar — que é como um
   * painel de alertas morre.
   */
  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    '/signals/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      // A regra de QUAIS valores uma pessoa pode escrever mora em
      // ./tratamento.ts, com teste. Aqui ela só é aplicada — é a parte que
      // alguém "amplia" sem pensar, então vale ter guarda própria.
      const novo = request.body?.status;
      if (!ehDesfechoDePessoa(novo)) {
        reply.code(400);
        return { error: RECUSA_DE_STATUS };
      }

      const [atualizado] = await db
        .update(schema.proactiveSignals)
        .set({ status: novo })
        .where(eq(schema.proactiveSignals.id, request.params.id))
        .returning({ id: schema.proactiveSignals.id, status: schema.proactiveSignals.status });

      if (!atualizado) {
        reply.code(404);
        return { error: 'Sinal não encontrado' };
      }
      return atualizado;
    },
  );
}
