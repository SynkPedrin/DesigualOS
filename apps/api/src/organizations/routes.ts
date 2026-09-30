import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { ehPapelDePlataforma, organizacaoProvedora } from '../lib/escopo-de-organizacao';

/**
 * AS EMPRESAS — a tela que a seção 60 do briefing pede para o Master.
 *
 * Responde "como está cada empresa que eu atendo": quantas pessoas, quanto da
 * carteira, quando foi a última atividade. É o ponto de entrada do provedor
 * para abrir um tenant.
 *
 * QUEM VÊ: só quem opera no nível da plataforma. E "nível da plataforma" NÃO é
 * "tem papel forte" — é papel forte E pertencer à organização provedora, as
 * duas condições juntas. Sem isso, o administrador de um cliente enxergaria a
 * lista de todos os clientes do provedor, que é a carteira comercial inteira.
 *
 * Quem não é provider recebe 403, e não uma lista com a própria empresa: uma
 * lista de um item não é uma tela de empresas, é um espelho que sugere um poder
 * que a pessoa não tem.
 *
 * TUDO NUMA CONSULTA SÓ, e é decisão medida: o pool desta API tem três
 * conexões, e eu já derrubei o /panorama duas vezes hoje somando perguntas
 * antes da principal. Uma tela de N empresas com uma consulta por empresa seria
 * a mesma armadilha, multiplicada por N.
 */
export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/organizations', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const provedora = organizacaoProvedora();
    if (!ehPapelDePlataforma(user.roles) || !provedora) {
      reply.code(403);
      return { error: 'Só o provedor enxerga a lista de empresas' };
    }

    const pertence = await db
      .execute(
        sql`select 1 from organization_members where user_id = ${user.id}::uuid and organization_id = ${provedora}::uuid limit 1`,
      )
      .then((r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])).length > 0)
      .catch(() => false);

    if (!pertence) {
      reply.code(403);
      return { error: 'Só o provedor enxerga a lista de empresas' };
    }

    const bruto: unknown = await db.execute(sql`
      select
        o.id,
        o.name,
        (select count(*)::int from organization_members om where om.organization_id = o.id) as pessoas,
        (select count(*)::int from clients c
          where c.organization_id = o.id and c.deleted_at is null) as clientes,
        (select max(m.created_at) from messages m where m.organization_id = o.id) as ultima_atividade,
        (select count(*)::int from memories mem
          where mem.organization_id = o.id and mem.status = 'active') as memorias,
        (o.id = ${provedora}::uuid) as eh_provedora
      from organizations o
      order by (o.id = ${provedora}::uuid) desc, o.name
    `);

    const linhas = ((bruto as { rows?: unknown[] }).rows ?? (bruto as unknown[])) as Array<{
      id: string;
      name: string;
      pessoas: number;
      clientes: number;
      ultima_atividade: string | null;
      memorias: number;
      eh_provedora: boolean;
    }>;

    return {
      organizations: linhas.map((o) => ({
        id: o.id,
        name: o.name,
        eh_provedora: o.eh_provedora,
        pessoas: o.pessoas,
        clientes: o.clientes,
        memorias: o.memorias,
        /**
         * `null` = nenhuma mensagem registrada para aquela empresa. A tela diz
         * "sem atividade ainda", nunca uma data inventada nem "agora".
         */
        ultima_atividade: o.ultima_atividade ? new Date(o.ultima_atividade).toISOString() : null,
      })),
      gerado_em: new Date().toISOString(),
    };
  });
}
