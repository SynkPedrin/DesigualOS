import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { tenantSharingScope } from '../lib/access';
import { somenteMemoriaVisivel } from './visibilidade';

/**
 * A MEMÓRIA INSTITUCIONAL, exposta pra ser vista.
 *
 * A tabela `memories` guarda o que o sistema aprendeu — regra de briefing que
 * nasceu de uma correção, perfil de cliente importado do brain, fato ensinado
 * no chat, decisão registrada. Tudo isso já era ESCRITO e LIDO pelos agentes, e
 * nunca teve uma porta pra fora: não existia jeito de alguém abrir o sistema e
 * ver o que ele acha que sabe.
 *
 * Isso é o oposto do que um Control Plane precisa ser. Memória que só o agente
 * enxerga não é conhecimento institucional, é caixa-preta — e quando ela erra,
 * ninguém descobre pela memória, descobre pelo briefing errado três dias
 * depois.
 *
 * TRÊS COISAS QUE ESTA ROTA NÃO FAZ, e a primeira é uma correção de vazamento
 * que a própria rota causou:
 *
 * 0. NÃO devolve memória privada de outra pessoa. O MCP tem um escopo
 *    `USER_PRIVATE` cuja regra é absoluta — "nem SUPER_ADMIN atravessa, porque
 *    um administrador que lê tudo transforma o escopo privado em teatro"
 *    (packages/mcp-domain/src/memory-scope.ts). A primeira versão desta rota
 *    não sabia que esse escopo existia, e a conta de QA lia anotações da conta
 *    de atendimento cujo próprio texto dizia "que ninguém mais pode ver".
 *
 *    O filtro é SQL, não pós-consulta: filtrar depois de buscar ainda vaza pelo
 *    total, e um contador que conta o que a lista esconde é uma forma mais
 *    silenciosa do mesmo defeito.
 *
 * 2. Não devolve memória de QA. O campo `environment` existe justamente porque
 *    uma preferência inventada num teste vira regra de marca real na semana
 *    seguinte e ninguém acha a origem. Produção lê produção.
 *
 * 3. Não devolve o que foi aposentado por padrão. Fato superseded continua na
 *    tabela (o histórico importa), mas mostrar tudo junto faria a tela
 *    apresentar como verdade o que o sistema já corrigiu. Quem quiser o
 *    histórico pede com `?status=all`.
 */
export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { client_id?: string; kind?: string; status?: string; q?: string; limit?: string };
  }>('/memories', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    /**
     * MESMA FRONTEIRA DAS OUTRAS LISTAGENS (P0-02, 22/09/2026): sem recorte de
     * organização, qualquer colaborador autenticado leria a memória de qualquer
     * outra. Aqui doeria mais que em execuções: memória carrega preferência,
     * restrição e decisão de cliente.
     */
    const isMaster = user.roles.includes('master');
    const scope = isMaster ? null : await tenantSharingScope(user.id);
    const recorteDeTenant: SQL | undefined =
      scope === null
        ? undefined
        : or(
            scope.allowedClientIds.length > 0 ? inArray(schema.memories.clientId, scope.allowedClientIds) : undefined,
            // Memória da agência (sem cliente) é do time: quem compartilha
            // organização com quem escreveu, lê.
            and(isNull(schema.memories.clientId), inArray(schema.memories.userId, scope.teammateUserIds)),
          );

    const status = request.query.status ?? 'active';
    const limite = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 300);

    // PRIVADO É PRIVADO. Ver a nota 0 no topo e ./visibilidade.ts, onde a
    // condição vive sozinha justamente pra ter teste.
    const naoEhPrivadoDeOutro = somenteMemoriaVisivel(user.id);

    const filtros: Array<SQL | undefined> = [
      recorteDeTenant,
      naoEhPrivadoDeOutro,
      eq(schema.memories.environment, 'production'),
      status === 'all' ? undefined : eq(schema.memories.status, status),
      request.query.client_id ? eq(schema.memories.clientId, request.query.client_id) : undefined,
      request.query.kind ? eq(schema.memories.kind, request.query.kind) : undefined,
      // Busca simples por conteúdo. `like` e não busca vetorial de propósito:
      // o volume aqui é de centenas, e um índice de texto pediria migration.
      request.query.q ? like(schema.memories.content, `%${request.query.q}%`) : undefined,
    ];

    const linhas = await db
      .select({
        memoria: schema.memories,
        clienteNome: schema.clients.name,
        autorNome: schema.users.name,
        autorEmail: schema.users.email,
      })
      .from(schema.memories)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.memories.clientId))
      .leftJoin(schema.users, eq(schema.users.id, schema.memories.userId))
      .where(and(...filtros))
      .orderBy(desc(schema.memories.createdAt))
      .limit(limite);

    /**
     * QUANTOS EXISTEM, além dos que couberam.
     *
     * Achado ao reconciliar tela x API x banco (30/09/2026): a tela pedia 150,
     * recebia 150 e se intitulava "150 registro(s)". Havia 396 visíveis àquela
     * conta. Ninguém mentiu numa linha de código — a tela contou o que tinha na
     * mão e chamou de total, e quem lesse concluiria que o sistema sabe 150
     * coisas quando ele sabe 396.
     *
     * É a mesma família de 58-x-49 e 812-x-146: número certo sobre a pergunta
     * errada. Por isso o total sai daqui, com EXATAMENTE os mesmos filtros —
     * contar com regra diferente da listagem é como o vazamento de privacidade
     * desta rota começou.
     */
    const [contagem] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.memories)
      .where(and(...filtros));

    return {
      total: contagem?.total ?? 0,
      /** Quantos couberam nesta resposta. A tela precisa dos dois pra ser honesta. */
      mostrando: linhas.length,
      memories: linhas.map(({ memoria: m, clienteNome, autorNome, autorEmail }) => ({
        id: m.id,
        kind: m.kind,
        content: m.content,
        client_id: m.clientId,
        client_name: clienteNome,
        // Nome, e-mail, ou nada. Nunca um nome aproximado.
        author_name: autorNome ?? autorEmail ?? null,
        source_type: m.sourceType,
        status: m.status,
        superseded_by: m.supersededBy,
        superseded_at: m.supersededAt?.toISOString() ?? null,
        confidence: m.confidence,
        importance: m.importance,
        metadata: m.metadata,
        /**
         * O escopo do MCP, quando a memória veio por lá. A tela mostra isso
         * porque "quem mais vê isto" é a primeira pergunta de quem lê memória
         * institucional — e sem o rótulo, uma anotação de cliente e uma regra
         * da agência inteira parecem a mesma coisa.
         */
        mcp_scope: (m.metadata as { mcp_scope?: unknown } | null)?.mcp_scope ?? null,
        created_at: m.createdAt?.toISOString() ?? null,
      })),
    };
  });

  /**
   * Os tipos que EXISTEM no banco, com quantos de cada.
   *
   * Serve pro filtro da tela e, principalmente, pra que ele mostre só o que há.
   * Um seletor com dez tipos fixos, dos quais oito nunca retornam nada, ensina
   * a pessoa a não confiar no filtro.
   */
  app.get('/memories/kinds', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    // A contagem por tipo segue a MESMA regra de privacidade da listagem:
    // um número que inclui o que a lista esconde denuncia a existência do que
    // deveria estar escondido.
    const linhas = await db
      .select({ kind: schema.memories.kind, id: schema.memories.id })
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.environment, 'production'),
          eq(schema.memories.status, 'active'),
          somenteMemoriaVisivel(user.id),
        ),
      );

    const contagem = new Map<string, number>();
    for (const l of linhas) contagem.set(l.kind, (contagem.get(l.kind) ?? 0) + 1);

    return {
      kinds: [...contagem.entries()]
        .map(([kind, total]) => ({ kind, total }))
        .sort((a, b) => b.total - a.total),
    };
  });
}
