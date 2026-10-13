import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { PIPELINE_STAGE_COLORS, PIPELINE_TIPOS } from '@desigual-os/types';
import { listStatusesForList, queryOperationTasks, resolveClickUpCredentialsForOrganizations, updateTask } from '@desigual-os/tool-gateway';
import { separarCarteira } from '@desigual-os/context-engine';
import { requireAuth } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import { estagioPeloStatus, statusInvalidosParaALista } from './estagios';

/**
 * QUEM PODE ESCREVER NUM QUADRO — a escada inteira, sem banco e sem Fastify.
 *
 * Separada da rota de propósito: são quatro regras que interagem, e uma delas
 * é uma decisão de SEGURANÇA que não aparece em teste de integração feliz. Em
 * função pura ela é exercitável nas dezesseis combinações, e é.
 *
 * A escolha entre 404 e 403 não é cosmética:
 *
 *   empresa errada            -> 404. Responder 403 confirmaria que aquele id
 *                                existe em ALGUMA empresa, que é informação
 *                                de outra pessoa.
 *   quadro pessoal alheio     -> 404, pelo mesmo motivo, e vale inclusive pra
 *                                administrador: "é da agência" é um papel,
 *                                não uma chave mestra do quadro de ninguém.
 *   quadro da agência sem ser -> 403, porque aqui a existência NÃO é segredo
 *   administrador                (a pessoa vê o quadro na tela dela) e o que
 *                                falta é permissão. Dizer 404 mandaria ela
 *                                procurar um quadro que está bem ali.
 */
/**
 * OS QUADROS QUE ESTA PESSOA VÊ: os da agência da empresa dela, mais os dela.
 *
 * Isolada numa função por causa do `isNull`. Em SQL, `owner_id = $1` nunca é
 * verdadeiro numa linha com NULL — então trocar isto por um `eq` sozinho, numa
 * "simplificação", faz TODO quadro da agência desaparecer da tela de todo
 * mundo, sem erro, sem log e sem ninguém perceber até alguém perguntar onde
 * foi parar o funil. É a mesma armadilha que já escondeu cliente inteiro neste
 * repositório, e o teste ao lado existe pra que ela não volte.
 */
/**
 * TABELA QUE AINDA NÃO FOI MIGRADA NÃO É "ERRO INTERNO".
 *
 * `42P01` é o código do Postgres para "relação não existe". Ele acontece numa
 * janela específica e perfeitamente previsível: o código novo subiu e a
 * migration ainda não rodou. Nessa janela, cada rota daqui devolvia 500
 * "Internal Server Error" — e quem recebe isso vai procurar bug no código,
 * que é o lugar onde ele não está.
 *
 * Dizer o comando que resolve custa uma linha e economiza a hora que eu mesmo
 * teria gastado procurando. 503 e não 500: o servidor está bem, falta um
 * passo de implantação.
 */
function respondeuTabelaAusente(erro: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }): boolean {
  if ((erro as { code?: string })?.code !== '42P01') return false;
  reply.code(503).send({
    error: 'As tabelas de pipeline ainda não existem neste banco.',
    detalhe: 'A migration que as cria não foi aplicada. Rode: pnpm --filter @desigual-os/database db:migrate',
  });
  return true;
}

export function quadrosVisiveisPara(userId: string, organizationId: string) {
  return and(
    eq(schema.pipelineBoards.organizationId, organizationId),
    isNull(schema.pipelineBoards.deletedAt),
    or(isNull(schema.pipelineBoards.ownerId), eq(schema.pipelineBoards.ownerId, userId)),
  );
}

export type AcessoAoQuadro = 'pode' | 'nao-encontrado' | 'so-administrador';

export function decidirAcessoAoQuadro(
  quadro: { organizationId: string; ownerId: string | null } | null,
  quem: { userId: string; roles: readonly string[]; organizationId: string },
): AcessoAoQuadro {
  if (!quadro) return 'nao-encontrado';
  if (quadro.organizationId !== quem.organizationId) return 'nao-encontrado';
  if (quadro.ownerId === null) return quem.roles.includes('master') ? 'pode' : 'so-administrador';
  return quadro.ownerId === quem.userId ? 'pode' : 'nao-encontrado';
}

const estagioSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.enum(PIPELINE_STAGE_COLORS),
  clickupStatus: z.string().min(1).optional(),
});

const criarQuadroSchema = z.object({
  nome: z.string().min(1),
  tipo: z.enum(PIPELINE_TIPOS),
  /**
   * 'agencia' = quadro da casa, de todo mundo. 'pessoal' = só de quem criou.
   * Explícito no corpo, nunca inferido do papel: um master criando o quadro
   * dele não quer que ele vire da agência sem ter pedido.
   */
  escopo: z.enum(['agencia', 'pessoal']).default('pessoal'),
  stages: z.array(estagioSchema).min(1),
  /**
   * Só pra `tipo='tarefas'`: QUAL cliente este quadro espelha — obrigatório
   * nesse tipo porque status do ClickUp é por lista (ver `pipeline.ts`,
   * coluna `client_id`). Validado no handler, não aqui: zod não enxerga o
   * `tipo` de uma chave pra exigir condicionalmente a outra sem perder a
   * mensagem de erro específica que o handler dá.
   */
  client_id: z.string().uuid().nullable().optional(),
});

const atualizarQuadroSchema = z.object({
  nome: z.string().min(1).optional(),
  stages: z.array(estagioSchema).min(1).optional(),
  posicao: z.number().int().optional(),
});

const criarCartaoSchema = z.object({
  stage_id: z.string().min(1),
  name: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  clickup_task_id: z.string().min(1).nullable().optional(),
  responsavel: z.string().nullable().optional(),
  valor: z.string().nullable().optional(),
  nota: z.string().optional(),
});

const anexoSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  url: z.string().url(),
  tipo: z.string(),
});

const atualizarCartaoSchema = z.object({
  anexos: z.array(anexoSchema).optional(),
  stage_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  client_id: z.string().uuid().nullable().optional(),
  responsavel: z.string().nullable().optional(),
  valor: z.string().nullable().optional(),
  nota: z.string().optional(),
  posicao: z.number().int().optional(),
});

/**
 * SINCRONIZAR CLIENTES — quem da carteira ainda não tem cartão neste quadro.
 *
 * Pura de propósito (mesmo padrão de `quadrosVisiveisPara`/`decidirAcessoAoQuadro`
 * acima): dado quem já é carteira real (fixture/interno já filtrados por quem
 * chama, via `separarCarteira`) e quais client_id já viraram cartão, devolve
 * só quem falta. Nunca cria cartão duplicado pro mesmo cliente no mesmo
 * quadro — reimportar é idempotente, igual todo importador deste repositório.
 */
export function clientesSemCartao(
  clientesDaCarteira: ReadonlyArray<{ id: string; name: string }>,
  clientIdsJaRepresentados: ReadonlySet<string>,
): Array<{ id: string; name: string }> {
  return clientesDaCarteira.filter((c) => !clientIdsJaRepresentados.has(c.id));
}

// statusInvalidosParaALista / estagioPeloStatus vivem em ./estagios — o
// webhook do ClickUp (clickup/routes.ts) também precisa delas, e rota não
// importa de rota neste repositório.

function wireQuadro(
  b: typeof schema.pipelineBoards.$inferSelect,
  cartoes: (typeof schema.pipelineCards.$inferSelect)[],
) {
  return {
    id: b.id,
    nome: b.nome,
    tipo: b.tipo,
    escopo: b.ownerId === null ? ('agencia' as const) : ('pessoal' as const),
    client_id: b.clientId,
    stages: b.stages,
    posicao: b.posicao,
    cards: cartoes
      .filter((c) => c.boardId === b.id)
      .map((c) => ({
        id: c.id,
        board_id: c.boardId,
        stage_id: c.stageId,
        name: c.name,
        client_id: c.clientId,
        clickup_task_id: c.clickupTaskId,
        responsavel: c.responsavel,
        valor: c.valor,
        nota: c.nota,
        anexos: c.anexos,
        posicao: c.posicao,
        atualizado_em: c.updatedAt.toISOString(),
      })),
  };
}

export async function registerPipelineRoutes(app: FastifyInstance): Promise<void> {
  /**
   * O QUE EU VEJO: os quadros da minha empresa que são da AGÊNCIA, mais os
   * MEUS.
   *
   * O `or(isNull(ownerId), eq(ownerId, user.id))` é a linha inteira do
   * requisito, e o `isNull` não é detalhe de estilo: em SQL, `owner_id = $1`
   * nunca é verdadeiro numa linha com NULL. Sem ele, o quadro da agência
   * sumiria para todo mundo — sem erro, sem log, só uma tela a menos. É o
   * mesmo tipo de nulo que já escondeu cliente inteiro neste repositório.
   */
  app.get('/pipelines', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const user = request.authUser!;
    const organizationId = request.tenantContext!.organizationId;

    try {
      const quadros = await db
        .select()
        .from(schema.pipelineBoards)
        .where(quadrosVisiveisPara(user.id, organizationId))
        .orderBy(asc(schema.pipelineBoards.posicao), asc(schema.pipelineBoards.createdAt));

      if (quadros.length === 0) return { boards: [] };

      const cartoes = await db
        .select()
        .from(schema.pipelineCards)
        .where(
          and(
            inArray(schema.pipelineCards.boardId, quadros.map((q) => q.id)),
            isNull(schema.pipelineCards.deletedAt),
          ),
        )
        .orderBy(asc(schema.pipelineCards.posicao), asc(schema.pipelineCards.createdAt));

      return { boards: quadros.map((q) => wireQuadro(q, cartoes)) };
    } catch (erro) {
      if (respondeuTabelaAusente(erro, reply)) return;
      throw erro;
    }
  });

  /**
   * STATUS REAIS DE UM CLIENTE, pra montar as colunas de um quadro de
   * tarefas ANTES de criar — sem isto a tela só tinha os 4 status inventados
   * (`CLICKUP_STATUSES_DISPONIVEIS`) pra oferecer. Status é por lista, nunca
   * universal (13/10/2026, confirmado pela operação).
   */
  app.get<{ Params: { clientId: string } }>('/pipelines/clientes/:clientId/status-clickup', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const organizationId = request.tenantContext!.organizationId;

    const [cliente] = await db
      .select({ id: schema.clients.id, clickupListId: schema.clients.clickupListId })
      .from(schema.clients)
      .where(and(eq(schema.clients.id, request.params.clientId), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)));
    if (!cliente) {
      reply.code(404);
      return { error: 'Cliente não encontrado.' };
    }
    if (!cliente.clickupListId) {
      reply.code(400);
      return { error: 'Este cliente não tem lista do ClickUp vinculada.' };
    }

    const credenciais = await resolveClickUpCredentialsForOrganizations([organizationId]);
    const resolucao = credenciais.get(organizationId);
    if (!resolucao?.credentials) {
      reply.code(502);
      return { error: 'Não consegui falar com o ClickUp.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
    }

    try {
      const status = await listStatusesForList(resolucao.credentials, cliente.clickupListId);
      return { status };
    } catch (erro) {
      reply.code(502);
      return { error: 'O ClickUp recusou devolver os status desta lista.', detalhe: erro instanceof Error ? erro.message : String(erro) };
    }
  });

  app.post('/pipelines', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const user = request.authUser!;
    const organizationId = request.tenantContext!.organizationId;
    const body = criarQuadroSchema.parse(request.body);

    /**
     * Quadro da AGÊNCIA é de administrador; quadro PESSOAL é de qualquer um.
     *
     * Não é hierarquia por hierarquia: o quadro da agência é o único que
     * aparece na tela de outras pessoas, e reorganizar as colunas dele muda o
     * trabalho de quem não foi consultado. O pessoal não tem esse efeito —
     * por isso ele é livre, que é exatamente o ponto dele.
     */
    if (body.escopo === 'agencia' && !(user.roles ?? []).includes('master')) {
      reply.code(403);
      return {
        error: 'Só um administrador cria quadro da agência.',
        detalhe: 'Você pode criar quantos quadros pessoais quiser, eles são seus e ninguém mais vê.',
      };
    }

    /**
     * QUADRO DE TAREFAS PRECISA SABER DE QUAL CLIENTE — status do ClickUp é
     * por lista (13/10/2026, confirmado pela operação), então sem saber a
     * lista não dá pra saber que status são reais nem onde encaixar task nova
     * que chegar pelo webhook. Confere aqui, não só no zod: a mensagem certa
     * ("esse cliente não tem ClickUp conectado") é mais útil que um 400 genérico.
     */
    if (body.tipo === 'tarefas') {
      if (!body.client_id) {
        reply.code(400);
        return { error: 'Quadro de tarefas precisa de um cliente — os status são da lista dele no ClickUp.' };
      }
      const [cliente] = await db
        .select({ id: schema.clients.id, clickupListId: schema.clients.clickupListId })
        .from(schema.clients)
        .where(and(eq(schema.clients.id, body.client_id), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)));
      if (!cliente) {
        reply.code(404);
        return { error: 'Cliente não encontrado.' };
      }
      if (!cliente.clickupListId) {
        reply.code(400);
        return { error: 'Este cliente não tem lista do ClickUp vinculada — não dá pra saber os status reais dele.' };
      }
      const credenciais = await resolveClickUpCredentialsForOrganizations([organizationId]);
      const resolucao = credenciais.get(organizationId);
      if (!resolucao?.credentials) {
        reply.code(502);
        return { error: 'Não consegui falar com o ClickUp para conferir os status desta lista.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
      }
      let statusReais: string[];
      try {
        statusReais = await listStatusesForList(resolucao.credentials, cliente.clickupListId);
      } catch (erro) {
        reply.code(502);
        return { error: 'O ClickUp recusou devolver os status desta lista.', detalhe: erro instanceof Error ? erro.message : String(erro) };
      }
      const invalidos = statusInvalidosParaALista(body.stages, statusReais);
      if (invalidos.length > 0) {
        reply.code(400);
        return {
          error: `Os status "${invalidos.join('", "')}" não existem nesta lista do ClickUp.`,
          detalhe: `Status reais: ${statusReais.join(', ')}`,
        };
      }
    }

    const [criado] = await db
      .insert(schema.pipelineBoards)
      .values({
        organizationId,
        ownerId: body.escopo === 'agencia' ? null : user.id,
        nome: body.nome,
        tipo: body.tipo,
        clientId: body.tipo === 'tarefas' ? (body.client_id ?? null) : null,
        stages: body.stages,
      })
      .returning();

    await auditarAcao(request, {
      organizationId,
      action: 'pipeline.board.created',
      resourceType: 'pipeline_board',
      resourceId: criado!.id,
      metadata: { escopo: body.escopo, tipo: body.tipo },
    });

    reply.code(201);
    return wireQuadro(criado!, []);
  });

  async function quadroParaEscrita(request: Parameters<typeof requireTenant>[0], reply: Parameters<typeof requireTenant>[1], boardId: string) {
    const user = request.authUser!;
    const organizationId = request.tenantContext!.organizationId;
    const [quadro] = await db
      .select()
      .from(schema.pipelineBoards)
      .where(and(eq(schema.pipelineBoards.id, boardId), isNull(schema.pipelineBoards.deletedAt)));

    const decisao = decidirAcessoAoQuadro(
      quadro ? { organizationId: quadro.organizationId, ownerId: quadro.ownerId } : null,
      { userId: user.id, roles: user.roles ?? [], organizationId },
    );

    if (decisao === 'nao-encontrado') {
      reply.code(404).send({ error: 'Quadro não encontrado.' });
      return null;
    }
    if (decisao === 'so-administrador') {
      reply.code(403).send({
        error: 'Este quadro é da agência; só um administrador pode alterá-lo.',
        detalhe: 'Seus quadros pessoais continuam livres.',
      });
      return null;
    }
    return quadro!;
  }

  app.patch<{ Params: { id: string } }>('/pipelines/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const quadro = await quadroParaEscrita(request, reply, request.params.id);
    if (!quadro) return;
    const body = atualizarQuadroSchema.parse(request.body);

    const [atualizado] = await db
      .update(schema.pipelineBoards)
      .set({
        ...(body.nome !== undefined ? { nome: body.nome } : {}),
        ...(body.stages !== undefined ? { stages: body.stages } : {}),
        ...(body.posicao !== undefined ? { posicao: body.posicao } : {}),
      })
      .where(eq(schema.pipelineBoards.id, quadro.id))
      .returning();

    /**
     * Coluna apagada deixa cartão apontando pro nada — e cartão invisível é
     * pior que cartão no lugar errado, porque some sem avisar. Os órfãos vão
     * pra primeira coluna que sobrou.
     */
    if (body.stages !== undefined) {
      const idsValidos = new Set(body.stages.map((s) => s.id));
      const primeira = body.stages[0]!.id;
      const doQuadro = await db
        .select({ id: schema.pipelineCards.id, stageId: schema.pipelineCards.stageId })
        .from(schema.pipelineCards)
        .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)));
      const orfaos = doQuadro.filter((c) => !idsValidos.has(c.stageId)).map((c) => c.id);
      if (orfaos.length > 0) {
        await db.update(schema.pipelineCards).set({ stageId: primeira }).where(inArray(schema.pipelineCards.id, orfaos));
      }
    }

    const cartoes = await db
      .select()
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)))
      .orderBy(asc(schema.pipelineCards.posicao));

    return wireQuadro(atualizado!, cartoes);
  });

  app.delete<{ Params: { id: string } }>('/pipelines/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const quadro = await quadroParaEscrita(request, reply, request.params.id);
    if (!quadro) return;

    // Soft delete: um quadro apagado por engano é trabalho de organização
    // perdido, e isso não precisa ser irreversível.
    await db.update(schema.pipelineBoards).set({ deletedAt: new Date() }).where(eq(schema.pipelineBoards.id, quadro.id));
    await auditarAcao(request, {
      organizationId: request.tenantContext!.organizationId,
      action: 'pipeline.board.deleted',
      resourceType: 'pipeline_board',
      resourceId: quadro.id,
      metadata: { nome: quadro.nome },
    });
    reply.code(204);
    return null;
  });

  app.post<{ Params: { id: string } }>('/pipelines/:id/cards', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const quadro = await quadroParaEscrita(request, reply, request.params.id);
    if (!quadro) return;
    const body = criarCartaoSchema.parse(request.body);

    if (!quadro.stages.some((s) => s.id === body.stage_id)) {
      reply.code(400);
      return { error: `A coluna "${body.stage_id}" não existe neste quadro.` };
    }

    const [criado] = await db
      .insert(schema.pipelineCards)
      .values({
        boardId: quadro.id,
        stageId: body.stage_id,
        name: body.name,
        clientId: body.client_id ?? null,
        clickupTaskId: body.clickup_task_id ?? null,
        responsavel: body.responsavel ?? null,
        valor: body.valor ?? null,
        nota: body.nota ?? '',
      })
      .returning();

    reply.code(201);
    return wireQuadro(quadro, [criado!]).cards[0];
  });

  /**
   * SINCRONIZAR CLIENTES — um cartão por cliente real da carteira que ainda
   * não está neste quadro, todos na PRIMEIRA coluna (igual chegaria se
   * alguém criasse o cartão à mão e não tivesse decidido ainda em que
   * estágio ele está). Fixture/interno nunca entram — `separarCarteira` já
   * exclui os dois, mesma régua operacional usada em panorama/qualidade de
   * dado.
   */
  app.post<{ Params: { id: string } }>('/pipelines/:id/sincronizar-clientes', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const quadro = await quadroParaEscrita(request, reply, request.params.id);
    if (!quadro) return;

    if (quadro.tipo !== 'cliente') {
      reply.code(400);
      return { error: 'Sincronizar clientes só existe em quadro do tipo "cliente".' };
    }
    if (quadro.stages.length === 0) {
      reply.code(400);
      return { error: 'Este quadro não tem nenhuma coluna ainda.' };
    }

    const organizationId = request.tenantContext!.organizationId;
    const todos = await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.organizationId, organizationId),
          eq(schema.clients.status, 'active'),
          // QA nunca entra num quadro operacional — mesma regra do resto do
          // produto (client-context.ts, listasDeClickUpDaOrganizacao...).
          eq(schema.clients.environment, 'production'),
          isNull(schema.clients.deletedAt),
        ),
      );
    const { carteira } = separarCarteira(todos);

    const existentes = await db
      .select({ clientId: schema.pipelineCards.clientId })
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)));
    const jaRepresentados = new Set(existentes.map((c) => c.clientId).filter((id): id is string => id !== null));

    const faltando = clientesSemCartao(carteira, jaRepresentados);
    if (faltando.length === 0) {
      return { criados: 0, cards: [] };
    }

    const primeiraColuna = quadro.stages[0]!.id;
    const criados = await db
      .insert(schema.pipelineCards)
      .values(
        faltando.map((c) => ({
          boardId: quadro.id,
          stageId: primeiraColuna,
          name: c.name,
          clientId: c.id,
          responsavel: null,
          valor: null,
          nota: '',
        })),
      )
      .returning();

    await auditarAcao(request, {
      organizationId,
      action: 'pipeline.board.clients_synced',
      resourceType: 'pipeline_board',
      resourceId: quadro.id,
      metadata: { criados: criados.length },
    });

    return { criados: criados.length, cards: wireQuadro(quadro, criados).cards };
  });

  /**
   * SINCRONIZAR TAREFAS — puxa as tasks REAIS da lista do cliente deste
   * quadro e cria um cartão pra cada uma que ainda não tem (dedup por
   * `clickup_task_id`, mesmo índice único que o banco já garante). Cobre o
   * backfill: task que já existia no ClickUp antes do quadro nascer não
   * chega sozinha — só task NOVA chega via webhook (ver clickup/routes.ts).
   *
   * Task cujo status real não bate com NENHUMA coluna deste quadro fica DE
   * FORA, de propósito: a pessoa escolheu quais status viram coluna ao criar
   * o quadro, e inventar uma coluna ou cair na primeira por acaso
   * representaria a task num lugar que não é o dela.
   */
  app.post<{ Params: { id: string } }>('/pipelines/:id/sincronizar-tarefas', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const quadro = await quadroParaEscrita(request, reply, request.params.id);
    if (!quadro) return;

    if (quadro.tipo !== 'tarefas') {
      reply.code(400);
      return { error: 'Sincronizar tarefas só existe em quadro do tipo "tarefas".' };
    }
    if (!quadro.clientId) {
      reply.code(400);
      return { error: 'Este quadro de tarefas não está vinculado a um cliente.' };
    }

    const organizationId = request.tenantContext!.organizationId;
    const [cliente] = await db
      .select({ id: schema.clients.id, clickupListId: schema.clients.clickupListId })
      .from(schema.clients)
      .where(and(eq(schema.clients.id, quadro.clientId), isNull(schema.clients.deletedAt)));
    if (!cliente?.clickupListId) {
      reply.code(400);
      return { error: 'O cliente deste quadro não tem lista do ClickUp vinculada.' };
    }

    const credenciais = await resolveClickUpCredentialsForOrganizations([organizationId]);
    const resolucao = credenciais.get(organizationId);
    if (!resolucao?.credentials) {
      reply.code(502);
      return { error: 'Não consegui falar com o ClickUp para buscar as tarefas.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
    }

    const pagina = await queryOperationTasks(resolucao.credentials, { listIds: [cliente.clickupListId], includeClosed: true, subtasks: true }).catch(
      (erro: unknown) => {
        reply.code(502).send({ error: 'O ClickUp recusou listar as tarefas desta lista.', detalhe: erro instanceof Error ? erro.message : String(erro) });
        return null;
      },
    );
    if (!pagina) return;

    const existentes = await db
      .select({ clickupTaskId: schema.pipelineCards.clickupTaskId })
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)));
    const jaTemCartao = new Set(existentes.map((c) => c.clickupTaskId).filter((id): id is string => id !== null));

    const paraCriar: Array<{ boardId: string; stageId: string; name: string; clickupTaskId: string }> = [];
    let semColuna = 0;
    for (const task of pagina.tasks) {
      if (jaTemCartao.has(task.id)) continue;
      const estagio = estagioPeloStatus(quadro.stages, task.status);
      if (!estagio) {
        semColuna++;
        continue;
      }
      paraCriar.push({ boardId: quadro.id, stageId: estagio.id, name: task.name, clickupTaskId: task.id });
    }

    const criados = paraCriar.length > 0 ? await db.insert(schema.pipelineCards).values(paraCriar).returning() : [];

    await auditarAcao(request, {
      organizationId,
      action: 'pipeline.board.tasks_synced',
      resourceType: 'pipeline_board',
      resourceId: quadro.id,
      metadata: { criados: criados.length, sem_coluna: semColuna },
    });

    return { criados: criados.length, sem_coluna: semColuna, cards: wireQuadro(quadro, criados).cards };
  });

  app.patch<{ Params: { id: string; cardId: string } }>(
    '/pipelines/:id/cards/:cardId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      await requireTenant(request, reply);
      if (reply.sent) return;
      const quadro = await quadroParaEscrita(request, reply, request.params.id);
      if (!quadro) return;
      const body = atualizarCartaoSchema.parse(request.body);

      if (body.stage_id !== undefined && !quadro.stages.some((s) => s.id === body.stage_id)) {
        reply.code(400);
        return { error: `A coluna "${body.stage_id}" não existe neste quadro.` };
      }

      /**
       * QUADRO DE TAREFAS: O CLICKUP VEM PRIMEIRO.
       *
       * Num quadro `tipo='tarefas'` a coluna NÃO é um rótulo nosso — ela é o
       * status real da tarefa no ClickUp (`stage.clickupStatus`). Arrastar o
       * cartão é, literalmente, mudar o status lá.
       *
       * Até 08/10/2026 isso era mentira declarada: a tela mostrava "status
       * atualizado no ClickUp" num toast verde e nada era escrito. A pessoa
       * fechava o quadro achando que tinha movido a tarefa do time.
       *
       * O ClickUp é escrito ANTES do nosso banco, e a ordem é a decisão: se a
       * escrita lá falhar, o cartão NÃO se move aqui. Um quadro que mostra a
       * tarefa em "Concluído" enquanto o ClickUp a tem em "Revisão" é pior que
       * um cartão que não se mexeu — porque o segundo a pessoa percebe.
       */
      const estagioNovo = body.stage_id !== undefined ? quadro.stages.find((s) => s.id === body.stage_id) : undefined;
      if (quadro.tipo === 'tarefas' && estagioNovo?.clickupStatus) {
        const [cartaoAtual] = await db
          .select({ clickupTaskId: schema.pipelineCards.clickupTaskId })
          .from(schema.pipelineCards)
          .where(and(eq(schema.pipelineCards.id, request.params.cardId), eq(schema.pipelineCards.boardId, quadro.id)));

        if (cartaoAtual?.clickupTaskId) {
          const credenciais = await resolveClickUpCredentialsForOrganizations([quadro.organizationId]);
          const resolucao = credenciais.get(quadro.organizationId);
          if (!resolucao?.credentials) {
            reply.code(502);
            return {
              error: 'Não consegui falar com o ClickUp para mudar o status desta tarefa.',
              detalhe: resolucao?.error ?? 'A empresa não tem ClickUp conectado. O cartão não foi movido.',
            };
          }
          try {
            await updateTask(resolucao.credentials, cartaoAtual.clickupTaskId, { status: estagioNovo.clickupStatus });
          } catch (erro) {
            reply.code(502);
            return {
              error: `O ClickUp recusou mudar o status para "${estagioNovo.clickupStatus}".`,
              detalhe: `${erro instanceof Error ? erro.message : String(erro)} O cartão continua onde estava.`,
            };
          }
        }
      }

      const [atualizado] = await db
        .update(schema.pipelineCards)
        .set({
          ...(body.stage_id !== undefined ? { stageId: body.stage_id } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.client_id !== undefined ? { clientId: body.client_id } : {}),
          ...(body.responsavel !== undefined ? { responsavel: body.responsavel } : {}),
          ...(body.valor !== undefined ? { valor: body.valor } : {}),
          ...(body.nota !== undefined ? { nota: body.nota } : {}),
          ...(body.posicao !== undefined ? { posicao: body.posicao } : {}),
          ...(body.anexos !== undefined ? { anexos: body.anexos } : {}),
        })
        .where(
          and(
            eq(schema.pipelineCards.id, request.params.cardId),
            eq(schema.pipelineCards.boardId, quadro.id),
            isNull(schema.pipelineCards.deletedAt),
          ),
        )
        .returning();

      if (!atualizado) {
        reply.code(404);
        return { error: 'Cartão não encontrado neste quadro.' };
      }
      return wireQuadro(quadro, [atualizado]).cards[0];
    },
  );

  app.delete<{ Params: { id: string; cardId: string } }>(
    '/pipelines/:id/cards/:cardId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      await requireTenant(request, reply);
      if (reply.sent) return;
      const quadro = await quadroParaEscrita(request, reply, request.params.id);
      if (!quadro) return;

      await db
        .update(schema.pipelineCards)
        .set({ deletedAt: new Date() })
        .where(and(eq(schema.pipelineCards.id, request.params.cardId), eq(schema.pipelineCards.boardId, quadro.id)));
      reply.code(204);
      return null;
    },
  );
}
