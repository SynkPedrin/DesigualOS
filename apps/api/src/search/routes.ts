import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';

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

function matchesIgnoringAccents(column: PgColumn, pattern: string): SQL {
  return sql`translate(${column}, ${ACCENTED_CHARS}, ${PLAIN_CHARS}) ILIKE translate(${pattern}, ${ACCENTED_CHARS}, ${PLAIN_CHARS})`;
}

/**
 * Busca geral (pedido do usuário): usuários, clientes e agentes num só
 * lugar. Sem full-text search dedicado por enquanto, ILIKE cobre o volume
 * atual de dados da agência.
 */
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q: string } }>('/search', { preHandler: requireAuth }, async (request) => {
    const { q } = searchQuerySchema.parse(request.query);
    const pattern = `%${escapeLikePattern(q)}%`;

    const [users, clients, agents] = await Promise.all([
      db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl })
        .from(schema.users)
        .where(and(isNull(schema.users.deletedAt), matchesIgnoringAccents(schema.users.name, pattern)))
        .limit(10),
      db
        .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
        .from(schema.clients)
        .where(
          and(
            isNull(schema.clients.deletedAt),
            // Slug também: quem cola o slug do ClickUp ("abitte-urbanismo")
            // estava recebendo "nenhum resultado" com o cliente na frente.
            or(
              matchesIgnoringAccents(schema.clients.name, pattern),
              matchesIgnoringAccents(schema.clients.slug, pattern),
            ),
          ),
        )
        .limit(10),
      db
        .select({ id: schema.agents.id, name: schema.agents.name, displayName: schema.agents.displayName })
        .from(schema.agents)
        .where(and(eq(schema.agents.active, true), ilike(schema.agents.displayName, pattern)))
        .limit(10),
    ]);

    return {
      users: users.map((user) => ({ id: user.id, name: user.name, email: user.email, avatar_url: user.avatarUrl })),
      clients: clients.map((client) => ({ id: client.id, name: client.name, slug: client.slug })),
      agents: agents.map((agent) => ({ id: agent.id, name: agent.name, display_name: agent.displayName })),
    };
  });
}
