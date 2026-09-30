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
     * A BASE do servidor, pro navegador poder falar direto com ele.
     *
     * O MCP expõe `/health` e `/tools` públicos e com CORS aberto pra origem do
     * front (verificado ao vivo: o header volta com o domínio da Vercel). Então
     * o painel chama aquilo direto, sem proxy, e o estado que ele mostra é um
     * PING de verdade — não o eco da variável de ambiente daqui.
     *
     * A diferença importa: `MCP_PUBLIC_URL` configurada diz que alguém escreveu
     * um endereço, não que existe servidor no outro lado. Dizer "Publicado" com
     * base nisso é a mesma classe de erro que dizer "não publicado" com base em
     * constante — as duas afirmam sem ler.
     */
    const base = endpoint ? endpoint.replace(/\/mcp\/?$/, '') : null;

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

    /**
     * CONEXÕES RECENTES, do evento que o próprio MCP emite.
     *
     * `CONNECTION_CREATED` chega em `operational_events` com source='mcp', só
     * na criação de sessão nova (não a cada chamada). É o que alimenta o aviso
     * de "novo Claude conectado".
     *
     * NÃO existe CONNECTION_DISCONNECTED, e isso é decisão do servidor, não
     * esquecimento: o transporte HTTP do MCP não tem despedida de protocolo, e
     * fabricar uma a partir de silêncio seria inventar dado. "Offline" se
     * deriva de a sessão ficar velha — o que esta rota NÃO faz ainda, e por
     * isso não afirma que ninguém está offline.
     */
    /**
     * CHAMADAS POR PESSOA, contadas no banco — não na fatia de 200 linhas que
     * a listagem acima traz.
     *
     * A primeira versão contava filtrando `chamadas` em memória. Com 14
     * chamadas dá o mesmo número, e por isso passaria despercebido: no dia em
     * que a operação passar de 200 chamadas em 24h, o total da tela continuaria
     * certo e o número por pessoa começaria a encolher sozinho, sem erro,
     * sem aviso. Número que degrada em silêncio é pior que número ausente.
     */
    const chamadasPorPessoa = await db
      .select({ userId: schema.auditLogs.userId, total: sql<number>`count(*)::int` })
      .from(schema.auditLogs)
      .where(and(gte(schema.auditLogs.timestamp, desde24h), sql`${schema.auditLogs.tool} is not null`))
      .groupBy(schema.auditLogs.userId);

    const totalPorPessoa = new Map(chamadasPorPessoa.filter((c) => c.userId).map((c) => [c.userId!, c.total]));

    const conexoesRecentes = await db
      .select({
        id: schema.operationalEvents.id,
        actor: schema.operationalEvents.actor,
        summary: schema.operationalEvents.summary,
        userId: schema.operationalEvents.userId,
        occurredAt: schema.operationalEvents.occurredAt,
        sessionId: schema.operationalEvents.entityId,
      })
      .from(schema.operationalEvents)
      .where(eq(schema.operationalEvents.type, 'CONNECTION_CREATED'))
      .orderBy(desc(schema.operationalEvents.occurredAt))
      .limit(20);

    return {
      // `null` quando a variável não está configurada. A tela decide o que
      // dizer — nunca um endereço plausível inventado aqui.
      endpoint,
      base,
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
      conexoes_recentes: conexoesRecentes.map((c) => {
        /**
         * O QUE DÁ PRA APURAR sobre quem acabou de conectar, e só isso.
         *
         * O release pediu um briefing com "3 clientes, 27 memórias, 4
         * decisões". Os escopos concedidos e as chamadas dela eu tenho aqui; o
         * resto (clientes, memórias, decisões relevantes) é consolidação do
         * Brain, que é outro workstream — e enquanto não existir, não é
         * estimado aqui.
         */
        const pessoa = c.userId ? porPessoa.get(c.userId) : undefined;
        /**
         * `0` aqui é um zero MEDIDO, e dá pra afirmar isso porque a atribuição
         * foi conferida: as 14 chamadas de MCP das últimas 24h têm todas
         * `user_id` preenchido (30/09/2026). Se um dia elas passarem a chegar
         * sem dono, este campo vira "não atribuído" — zero seria mentira.
         */
        const chamadasDela = c.userId ? (totalPorPessoa.get(c.userId) ?? 0) : null;
        return {
          id: c.id,
          session_id: c.sessionId,
          user_id: c.userId,
          nome: c.actor ?? pessoa?.nome ?? null,
          summary: c.summary,
          at: c.occurredAt?.toISOString() ?? null,
          scopes: pessoa?.scopes ?? [],
          // `null` = o evento não trouxe dono, então não há o que contar.
          chamadas_24h: chamadasDela,
          conexao_viva: Boolean(pessoa),
        };
      }),
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
