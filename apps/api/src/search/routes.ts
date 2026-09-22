import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { tenantSharingScope } from '../lib/access';

const searchQuerySchema = z.object({ q: z.string().min(1).max(100) });

// Sem isso, `%`/`_` digitados pelo usuário viram wildcard de LIKE em vez de
// caractere literal (mesmo padrão de studio/routes.ts).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Ninguém digita acento na pressa: quem procurava "agencia" não achava
 * "Agência Desigual", e "paineis" não achava "Sonhar Painéis" — a busca
 * parecia simplesmente quebrada (medido em 14/09/2026 contra o banco real).
 * ILIKE do Postgres é sensível a acento; `unaccent` resolveria, mas exige
 * extensão no banco (migration + permissão), e `translate()` faz o mesmo
 * trabalho aqui sem tocar no schema.
 *
 * As duas listas PRECISAM ter o mesmo número de caracteres: `translate()`
 * descarta silenciosamente o que sobrar na primeira, o que viraria uma busca
 * errando resultado sem erro nenhum. Travado por teste.
 */
export const ACCENTED_CHARS = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
export const PLAIN_CHARS = 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN';

/**
 * Erro de digitação (14/09/2026, reproduzido em produção): "consentino" não
 * achava "Cosentino" e a tela dizia "Nenhum resultado encontrado" com o
 * cliente visível atrás. `word_similarity` do pg_trgm compara o termo com o
 * melhor TRECHO do nome — indispensável aqui, onde o nome é longo
 * ("🔥 Construtora e Imobiliária Cosentino Ltda. — Enterprise") e o termo é
 * uma palavra só; `similarity()` puro afundaria por causa do resto do nome.
 *
 * Limiares medidos contra a carteira real, não chutados:
 *   "consentino" -> Cosentino 0.615 | melhor falso positivo 0.364
 *   "jonh deere" -> John Deere 0.571 | próximo 0.182
 *   "xyzabc"     -> 0.000 em toda a base
 * 0.45 aceita os dois erros reais com folga e recusa o falso positivo.
 */
const FUZZY_THRESHOLD = 0.45;
/**
 * Abaixo disso o fuzzy só adiciona ruído: "a" tem similaridade 0.5 com meia
 * carteira, e termo curto já é bem servido pelo casamento por substring.
 */
const FUZZY_MIN_LENGTH = 4;

function folded(value: PgColumn | string): SQL {
  return sql`translate(${value}, ${ACCENTED_CHARS}, ${PLAIN_CHARS})`;
}

/**
 * Busca geral (pedido do usuário): usuários, clientes e agentes num só
 * lugar. Sem full-text search dedicado por enquanto, ILIKE + trigrama cobrem
 * o volume atual da agência (dezenas de registros).
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q: string } }>('/search', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const { q } = searchQuerySchema.parse(request.query);
    const pattern = `%${escapeLikePattern(q)}%`;
    const useFuzzy = q.trim().length >= FUZZY_MIN_LENGTH;

    /**
     * P0-02 (auditoria de release readiness, 22/09/2026): `/search` lia
     * usuário/cliente de QUALQUER organização, sem filtro nenhum — mesma
     * falha estrutural já fechada em `/conversations`/`/executions`. Master
     * mantém o alcance amplo que já tinha; demais usuários só encontram
     * colega de organização e cliente da própria organização.
     */
    const isMaster = user.roles.includes('master');
    const scope = isMaster ? null : await tenantSharingScope(user.id);
    const userScopeCondition = scope === null ? undefined : scope.teammateUserIds.length > 0 ? inArray(schema.users.id, scope.teammateUserIds) : sql`false`;
    const clientScopeCondition = scope === null ? undefined : scope.allowedClientIds.length > 0 ? inArray(schema.clients.id, scope.allowedClientIds) : sql`false`;

    /** Casa por substring (ignorando acento) em qualquer uma das colunas. */
    const substringMatch = (...columns: PgColumn[]): SQL =>
      sql.join(
        columns.map((column) => sql`${folded(column)} ILIKE ${folded(pattern)}`),
        sql` OR `,
      );

    const similarityTo = (column: PgColumn): SQL => sql`word_similarity(${folded(q)}, ${folded(column)})`;

    /** Substring primeiro, depois o mais parecido: o melhor resultado fica no topo. */
    const ranked = (column: PgColumn, ...matchOn: PgColumn[]): SQL =>
      sql`CASE WHEN (${substringMatch(...matchOn)}) THEN 0 ELSE 1 END, ${similarityTo(column)} DESC, ${column} ASC`;

    const matches = (column: PgColumn, ...matchOn: PgColumn[]): SQL =>
      useFuzzy
        ? sql`((${substringMatch(...matchOn)}) OR ${similarityTo(column)} >= ${FUZZY_THRESHOLD})`
        : sql`(${substringMatch(...matchOn)})`;

    const [users, clients, agents] = await Promise.all([
      db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl })
        .from(schema.users)
        .where(and(isNull(schema.users.deletedAt), matches(schema.users.name, schema.users.name), userScopeCondition))
        .orderBy(ranked(schema.users.name, schema.users.name))
        .limit(10),
      db
        .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
        .from(schema.clients)
        // Slug também: quem cola o slug do ClickUp ("abitte-urbanismo")
        // estava recebendo "nenhum resultado" com o cliente na frente.
        .where(and(isNull(schema.clients.deletedAt), matches(schema.clients.name, schema.clients.name, schema.clients.slug), clientScopeCondition))
        .orderBy(ranked(schema.clients.name, schema.clients.name, schema.clients.slug))
        .limit(10),
      db
        .select({ id: schema.agents.id, name: schema.agents.name, displayName: schema.agents.displayName })
        .from(schema.agents)
        .where(and(eq(schema.agents.active, true), matches(schema.agents.displayName, schema.agents.displayName)))
        .orderBy(ranked(schema.agents.displayName, schema.agents.displayName))
        .limit(10),
    ]);

    return {
      users: users.map((user) => ({ id: user.id, name: user.name, email: user.email, avatar_url: user.avatarUrl })),
      clients: clients.map((client) => ({ id: client.id, name: client.name, slug: client.slug })),
      agents: agents.map((agent) => ({ id: agent.id, name: agent.name, display_name: agent.displayName })),
    };
  });
}
