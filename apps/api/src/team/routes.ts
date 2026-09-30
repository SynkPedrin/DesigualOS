import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { recorteDePessoasVisiveis } from '../lib/escopo-de-organizacao';

/**
 * Diretório de pessoas da agência, usado pela mensageria (com quem posso
 * falar) e pela busca geral. Qualquer usuário autenticado pode ver, não é
 * dado sensível (nome, foto, cargo).
 */
export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/team/members', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    /**
     * SÓ A EQUIPE DA MINHA EMPRESA.
     *
     * A rota devolvia TODOS os usuários não deletados, sem recorte nenhum. Com
     * uma organização isso é o time da casa; com duas, é o time do concorrente
     * — nome, e-mail e papel de cada pessoa.
     *
     * O `EXISTS` fica DENTRO da consulta que já existia, em vez de resolver as
     * organizações antes e filtrar depois: somar uma pergunta antes da
     * principal custa uma conexão do pool, que aqui tem três. Aprendi isso
     * quebrando o /panorama duas vezes no mesmo dia.
     */
    const recorte = recorteDePessoasVisiveis(user, schema.users.id);

    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        avatarUrl: schema.users.avatarUrl,
        roleName: schema.roles.name,
      })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(isNull(schema.users.deletedAt), recorte))
      .orderBy(asc(schema.users.name));

    const byId = new Map<string, { id: string; name: string; email: string; avatar_url: string | null; roles: string[] }>();
    for (const row of rows) {
      const existing = byId.get(row.id);
      if (existing) {
        existing.roles.push(row.roleName);
      } else {
        byId.set(row.id, { id: row.id, name: row.name, email: row.email, avatar_url: row.avatarUrl, roles: [row.roleName] });
      }
    }

    return { members: [...byId.values()] };
  });
}
