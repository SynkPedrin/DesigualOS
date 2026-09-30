import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';

/**
 * O ESTADO REAL DO MCP, pro Control Plane.
 *
 * Esta rota nasceu de um erro meu que vale registrar: escrevi a tela de MCP
 * dizendo "não publicado, sem endpoint, nenhuma conexão possível" — honesto
 * quando escrevi, e falso três horas depois, porque a outra sessão publicou o
 * servidor no Railway e a Tammy conectou. Uma tela que afirma ausência precisa
 * ler a ausência, não presumi-la; presumir envelhece.
 *
 * Tudo aqui sai de duas tabelas que já existem e já são escritas pelo próprio
 * MCP: `mcp_tokens` (quem autorizou, com quais escopos) e `audit_logs` (qual
 * ferramenta foi chamada, por quem, com que resultado).
 */

/** Conexão viva = token de refresh não revogado e não expirado. */
function conexaoViva() {
  return and(
    eq(schema.mcpTokens.kind, 'refresh'),
    isNull(schema.mcpTokens.revokedAt),
    gte(schema.mcpTokens.expiresAt, new Date()),
  );
}

export async function registerMcpStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mcp/status', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const endpoint = process.env.MCP_PUBLIC_URL ?? null;

    /**
     * CONEXÕES, por pessoa.
     *
     * Um refresh token por autorização, e a mesma pessoa pode autorizar mais de
     * uma vez (reconectou, trocou de máquina). Agrupar por usuário é o que
     * responde "quem está conectado" em vez de "quantos tokens existem" — que é
     * a pergunta que ninguém faz.
     */
    const tokens = await db
      .select({
        userId: schema.mcpTokens.userId,
        scopes: schema.mcpTokens.scopes,
        createdAt: schema.mcpTokens.createdAt,
        expiresAt: schema.mcpTokens.expiresAt,
        nome: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.mcpTokens)
      .leftJoin(schema.users, eq(schema.users.id, schema.mcpTokens.userId))
      .where(conexaoViva())
      .orderBy(desc(schema.mcpTokens.createdAt));

    const porPessoa = new Map<
      string,
      { user_id: string; nome: string | null; scopes: string[]; conexoes: number; desde: string | null }
    >();
    for (const t of tokens) {
      const atual = porPessoa.get(t.userId);
      if (atual) {
        atual.conexoes += 1;
        for (const s of t.scopes) if (!atual.scopes.includes(s)) atual.scopes.push(s);
      } else {
        porPessoa.set(t.userId, {
          user_id: t.userId,
          nome: t.nome ?? t.email ?? null,
          scopes: [...t.scopes],
          conexoes: 1,
          // A mais ANTIGA é "conectado desde"; a lista vem ordenada do mais
          // novo, então a última que chega de cada pessoa é a certa.
          desde: t.createdAt?.toISOString() ?? null,
        });
      }
      const registro = porPessoa.get(t.userId)!;
      if (t.createdAt && (!registro.desde || t.createdAt.toISOString() < registro.desde)) {
        registro.desde = t.createdAt.toISOString();
      }
    }

    /**
     * CHAMADAS DE FERRAMENTA, das últimas 24h.
     *
     * Só linha com `tool` preenchido: o audit_log guarda muita coisa que não é
     * chamada de MCP (login, mudança de permissão), e misturar inflaria o
     * número que esta tela existe pra mostrar.
     */
    const desde24h = new Date(Date.now() - 24 * 3_600_000);
    const chamadas = await db
      .select({
        tool: schema.auditLogs.tool,
        result: schema.auditLogs.result,
        timestamp: schema.auditLogs.timestamp,
        userId: schema.auditLogs.userId,
        clientId: schema.auditLogs.clientId,
        requestId: schema.auditLogs.requestId,
        nome: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
      .where(and(gte(schema.auditLogs.timestamp, desde24h), sql`${schema.auditLogs.tool} is not null`))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(200);

    const porFerramenta = new Map<string, { total: number; sucesso: number }>();
    for (const c of chamadas) {
      if (!c.tool) continue;
      const atual = porFerramenta.get(c.tool) ?? { total: 0, sucesso: 0 };
      atual.total += 1;
      if (c.result === 'success') atual.sucesso += 1;
      porFerramenta.set(c.tool, atual);
    }

    const sucessos = chamadas.filter((c) => c.result === 'success').length;

    return {
      // `null` quando a variável não está configurada. A tela decide o que
      // dizer — nunca um endereço plausível inventado aqui.
      endpoint,
      // "Conectado" é sobre haver conexão viva, não sobre o servidor responder:
      // quem sabe se o servidor responde é o próprio servidor, e ele não é este.
      conexoes_vivas: tokens.length,
      pessoas_conectadas: porPessoa.size,
      pessoas: [...porPessoa.values()].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '')),
      chamadas_24h: chamadas.length,
      sucessos_24h: sucessos,
      por_ferramenta: [...porFerramenta.entries()]
        .map(([tool, v]) => ({ tool, total: v.total, sucesso: v.sucesso }))
        .sort((a, b) => b.total - a.total),
      ultimas: chamadas.slice(0, 30).map((c) => ({
        tool: c.tool,
        result: c.result,
        user_name: c.nome ?? c.email ?? null,
        client_id: c.clientId,
        request_id: c.requestId,
        at: c.timestamp?.toISOString() ?? null,
      })),
    };
  });
}
