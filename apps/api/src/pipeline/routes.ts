import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { PIPELINE_STAGE_COLORS, PIPELINE_TIPOS } from '@desigual-os/types';
import { credenciaisClickUpDaEmpresa, findMemberByEmail, listStatusDetailsForList, queryOperationTasks, updateTask, type ClickUpConfig, type OperationTask } from '@desigual-os/tool-gateway';
import { separarCarteira } from '@desigual-os/context-engine';
import { requireAuth } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';
import { auditarAcao } from '../lib/auditoria';
import { ehFechado, estagioPeloStatus, estagiosDasTarefas, juntarFluxos, statusInvalidosParaALista, type EstagioDoClickUp } from './estagios';
import { garantirEmailDoClickUp } from '../lib/vinculo-clickup';
import { CATEGORIAS_GERAIS, categoriaDoCliente, categoriaDoStatus, ehTarefaDeTeste, estagioDaCategoria, estagiosIguais, garantirEstagiosGerais, rotuloDaCategoria, statusDaListaParaCategoria } from './quadro-geral';

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
  categoria: z.enum(CATEGORIAS_GERAIS).optional(),
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
        responsavel_avatar: c.responsavelAvatar,
        prazo: c.prazo ? c.prazo.toISOString() : null,
        prioridade: c.prioridade,
        valor: c.valor,
        nota: c.nota,
        anexos: c.anexos,
        posicao: c.posicao,
        atualizado_em: c.updatedAt.toISOString(),
      })),
  };
}

/**
 * STATUS REAIS DE UMA LISTA, com a saída de emergência que a operação pediu
 * (14/10/2026): se o ClickUp não devolver o workflow da lista (vazio, ou erro
 * na leitura da lista), os status vêm das tarefas que estão nela. Só falha
 * quando nem a lista nem as tarefas respondem.
 */
async function estagiosDaLista(credenciais: ClickUpConfig, listId: string): Promise<EstagioDoClickUp[]> {
  const daLista = await listStatusDetailsForList(credenciais, listId).catch(() => [] as EstagioDoClickUp[]);
  if (daLista.length > 0) return daLista;
  const pagina = await queryOperationTasks(credenciais, { listIds: [listId], includeClosed: true, subtasks: true });
  return estagiosDasTarefas(pagina.tasks);
}

/**
 * TAREFAS ATRIBUÍDAS A ESTA PESSOA no ClickUp da empresa. O id do membro é
 * por workspace, então é procurado pelo e-mail do ClickUp da pessoa (que
 * `garantirEmailDoClickUp` vincula sozinho quando dá pra saber quem é).
 * `null` quando a pessoa não é membro do workspace — quem chama diz isso,
 * nunca devolve "zero tarefas" como se fosse verdade.
 */
async function tarefasDaPessoa(
  credenciais: ClickUpConfig,
  userId: string,
  porLista: Map<string, { id: string }>,
): Promise<{ tarefas: OperationTask[]; cortada: boolean } | null> {
  const email = await garantirEmailDoClickUp(userId).catch(() => null);
  if (!email) return null;
  const membro = await findMemberByEmail(credenciais, email);
  if (!membro) return null;
  const pagina = await queryOperationTasks(credenciais, { assigneeIds: [membro.id], includeClosed: true, subtasks: true });
  /**
   * SÓ LISTAS DE CLIENTES DE PRODUÇÃO (15/10/2026, pedido do Pedro: "tira
   * tudo de QA, que é coisa de testes internos — quero um sistema de
   * produção real"). A busca por responsável varre o workspace INTEIRO, e o
   * quadro pessoal enchia de "QA Gate Bento", "Cliente Teste 7", "[ENXAME]".
   * Tarefa sem lista ou em lista de cliente de QA/outra empresa não é trabalho
   * da operação — não entra no quadro e o cartão velho dela sai no sync.
   */
  return { tarefas: pagina.tasks.filter((t) => t.listId && porLista.has(t.listId) && !ehTarefaDeTeste(t.name)), cortada: pagina.truncated };
}

/** O que o cartão espelha da tarefa do ClickUp, além da coluna. */
function camposDaTarefa(t: OperationTask): { name: string; responsavel: string | null; responsavelAvatar: string | null; prazo: Date | null; prioridade: string | null } {
  return {
    name: t.name,
    responsavel: t.assignees[0] ?? null,
    responsavelAvatar: t.assigneeAvatars?.[0] ?? null,
    prazo: t.dueDate ? new Date(t.dueDate) : null,
    prioridade: t.priority,
  };
}

/** Só grava quando algo mudou de verdade — senão toda sincronização reescreveria
 * `updated_at` de todos os cartões e o "há X min" da tela deixaria de significar algo. */
function camposMudaram(cartao: { name: string; responsavel: string | null; responsavelAvatar: string | null; prazo: Date | null; prioridade: string | null }, novo: ReturnType<typeof camposDaTarefa>): boolean {
  const prazoAtual = cartao.prazo?.getTime() ?? null;
  return (
    cartao.name !== novo.name ||
    cartao.responsavel !== novo.responsavel ||
    cartao.responsavelAvatar !== novo.responsavelAvatar ||
    cartao.prioridade !== novo.prioridade ||
    prazoAtual !== (novo.prazo?.getTime() ?? null)
  );
}

/**
 * Colunas do quadro "atribuídas a mim": o FLUXO das listas em que as tarefas
 * da pessoa estão (ver `juntarFluxos`), não só os status que elas têm hoje.
 * Lista mais frequente primeiro, porque é a ordem dela que a pessoa
 * reconhece. Teto de listas lidas pra não estourar o rate limit do ClickUp
 * com quem tem tarefa espalhada pela agência inteira.
 */
const MAX_LISTAS_DO_FLUXO = 15;
async function estagiosDasMinhasTarefas(credenciais: ClickUpConfig, tarefas: readonly OperationTask[]): Promise<EstagioDoClickUp[]> {
  const frequencia = new Map<string, number>();
  for (const t of tarefas) if (t.listId) frequencia.set(t.listId, (frequencia.get(t.listId) ?? 0) + 1);
  const listas = [...frequencia.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LISTAS_DO_FLUXO).map(([id]) => id);
  const fluxos: EstagioDoClickUp[][] = [];
  for (let i = 0; i < listas.length; i += 5) {
    const lote = await Promise.all(listas.slice(i, i + 5).map((id) => listStatusDetailsForList(credenciais, id).catch(() => [] as EstagioDoClickUp[])));
    fluxos.push(...lote);
  }
  return juntarFluxos([...fluxos, estagiosDasTarefas(tarefas)]);
}

/** `fechados` vêm desmarcados na tela: tarefa encerrada não é trabalho em andamento. */
function paraATela(estagios: EstagioDoClickUp[]) {
  return { status: estagios.map((e) => e.status), fechados: estagios.filter(ehFechado).map((e) => e.status) };
}

const SEM_VINCULO_CLICKUP = 'Não achei você entre os membros do ClickUp da empresa. Confira se o seu e-mail do ClickUp está vinculado no seu perfil.';

/** Quadro de tarefas da AGÊNCIA: sem cliente e sem dono — mostra a operação inteira por categoria geral. */
function ehQuadroGeralDeTarefas(quadro: { tipo: string; clientId: string | null; ownerId: string | null }): boolean {
  return quadro.tipo === 'tarefas' && !quadro.clientId && !quadro.ownerId;
}

/** Clientes de produção da empresa que têm lista no ClickUp, e de qual lista é cada um. */
async function listasDosClientes(organizationId: string): Promise<Map<string, { id: string; name: string }>> {
  const linhas = await db
    .select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.organizationId, organizationId),
        inArray(schema.clients.status, ['active', 'pontual']),
        eq(schema.clients.environment, 'production'),
        isNull(schema.clients.deletedAt),
        isNotNull(schema.clients.clickupListId),
      ),
    );
  return new Map(linhas.map((c) => [c.clickupListId!, { id: c.id, name: c.name }]));
}

/**
 * Tarefas ABERTAS de todas as listas de cliente da empresa, cada uma com o
 * cliente dela. Sem as encerradas e sem subtarefa: são milhares, e o quadro
 * geral é sobre o que está em curso (1.239 abertas em 15/10/2026).
 */
async function tarefasDaAgencia(
  credenciais: ClickUpConfig,
  porLista: Map<string, { id: string }>,
): Promise<{ tarefas: Array<OperationTask & { clientId: string }>; cortada: boolean }> {
  if (porLista.size === 0) return { tarefas: [], cortada: false };
  const pagina = await queryOperationTasks(credenciais, { listIds: [...porLista.keys()], includeClosed: false, subtasks: false });
  return {
    tarefas: pagina.tasks
      .filter((t) => t.listId && porLista.has(t.listId) && !ehTarefaDeTeste(t.name))
      .map((t) => ({ ...t, clientId: porLista.get(t.listId!)!.id })),
    cortada: pagina.truncated,
  };
}

/**
 * Os status reais de onde um quadro de tarefas tira as colunas: a lista do
 * cliente, ou as tarefas do dono no quadro "atribuídas a mim". Quadro antigo
 * da agência, sem cliente e sem dono, não tem de onde tirar.
 */
async function statusReaisDoQuadro(
  quadro: { clientId: string | null; ownerId: string | null },
  organizationId: string,
): Promise<{ status: string[] } | { erro: string; codigo: number }> {
  if (!quadro.clientId && !quadro.ownerId) {
    return { erro: 'Este quadro da agência não está vinculado a um cliente, então não há status do ClickUp para acrescentar. Crie um quadro novo escolhendo o cliente.', codigo: 400 };
  }
  const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
  if (!resolucao?.credentials) return { erro: 'Não consegui falar com o ClickUp para conferir os status.', codigo: 502 };
  try {
    if (quadro.clientId) {
      const [cliente] = await db
        .select({ clickupListId: schema.clients.clickupListId })
        .from(schema.clients)
        .where(and(eq(schema.clients.id, quadro.clientId), isNull(schema.clients.deletedAt)));
      if (!cliente?.clickupListId) return { erro: 'O cliente deste quadro não tem lista do ClickUp vinculada.', codigo: 400 };
      return { status: (await estagiosDaLista(resolucao.credentials, cliente.clickupListId)).map((e) => e.status) };
    }
    const resultado = await tarefasDaPessoa(resolucao.credentials, quadro.ownerId!, await listasDosClientes(organizationId));
    if (!resultado) return { erro: SEM_VINCULO_CLICKUP, codigo: 409 };
    return { status: (await estagiosDasMinhasTarefas(resolucao.credentials, resultado.tarefas)).map((e) => e.status) };
  } catch (erro) {
    return { erro: `O ClickUp recusou devolver os status: ${erro instanceof Error ? erro.message : String(erro)}`, codigo: 502 };
  }
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

    const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
    if (!resolucao?.credentials) {
      reply.code(502);
      return { error: 'Não consegui falar com o ClickUp.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
    }

    try {
      return paraATela(await estagiosDaLista(resolucao.credentials, cliente.clickupListId));
    } catch (erro) {
      reply.code(502);
      return { error: 'O ClickUp recusou devolver os status desta lista.', detalhe: erro instanceof Error ? erro.message : String(erro) };
    }
  });

  /**
   * STATUS DAS TAREFAS ATRIBUÍDAS A MIM — o quadro "minhas tarefas" junta
   * tarefas de listas diferentes, então as colunas são os status que essas
   * tarefas carregam de verdade.
   */
  app.get('/pipelines/minhas/status-clickup', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const organizationId = request.tenantContext!.organizationId;
    const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
    if (!resolucao.credentials) {
      reply.code(502);
      return { error: 'Não consegui falar com o ClickUp.', detalhe: resolucao.error ?? 'Empresa sem ClickUp conectado.' };
    }
    try {
      const resultado = await tarefasDaPessoa(resolucao.credentials, request.authUser!.id, await listasDosClientes(organizationId));
      if (!resultado) {
        reply.code(409);
        return { error: SEM_VINCULO_CLICKUP };
      }
      return { ...paraATela(await estagiosDasMinhasTarefas(resolucao.credentials, resultado.tarefas)), tarefas: resultado.tarefas.length };
    } catch (erro) {
      reply.code(502);
      return { error: 'O ClickUp recusou listar as suas tarefas.', detalhe: erro instanceof Error ? erro.message : String(erro) };
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
    if (body.tipo === 'tarefas' && !body.client_id) {
      /**
       * "ATRIBUÍDAS A MIM" (14/10/2026): quadro de tarefas sem cliente é o
       * das tarefas da própria pessoa, e por isso só existe pessoal — um
       * quadro da agência com as tarefas de quem o criou não faz sentido pra
       * mais ninguém.
       */
      if (body.escopo !== 'pessoal') {
        reply.code(400);
        return { error: 'Quadro da agência precisa de um cliente. "Atribuídas a mim" é sempre um quadro pessoal.' };
      }
      const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
      if (!resolucao.credentials) {
        reply.code(502);
        return { error: 'Não consegui falar com o ClickUp para conferir os seus status.', detalhe: resolucao.error ?? 'Empresa sem ClickUp conectado.' };
      }
      let statusReais: string[];
      try {
        const resultadoTarefas = await tarefasDaPessoa(resolucao.credentials, user.id, await listasDosClientes(organizationId));
        if (!resultadoTarefas) {
          reply.code(409);
          return { error: SEM_VINCULO_CLICKUP };
        }
        statusReais = (await estagiosDasMinhasTarefas(resolucao.credentials, resultadoTarefas.tarefas)).map((e) => e.status);
      } catch (erro) {
        reply.code(502);
        return { error: 'O ClickUp recusou listar as suas tarefas.', detalhe: erro instanceof Error ? erro.message : String(erro) };
      }
      const invalidos = statusInvalidosParaALista(body.stages, statusReais);
      if (invalidos.length > 0) {
        reply.code(400);
        return { error: `Os status "${invalidos.join('", "')}" não aparecem em nenhuma tarefa sua.`, detalhe: `Status reais: ${statusReais.join(', ')}` };
      }
    } else if (body.tipo === 'tarefas' && body.client_id) {
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
      const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
      if (!resolucao?.credentials) {
        reply.code(502);
        return { error: 'Não consegui falar com o ClickUp para conferir os status desta lista.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
      }
      let statusReais: string[];
      try {
        statusReais = (await estagiosDaLista(resolucao.credentials, cliente.clickupListId)).map((e) => e.status);
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

  /**
   * SINCRONIZAR É ESPELHAR, NÃO ALTERAR (15/10/2026). Quadro da agência só o
   * administrador edita — nome, colunas, cartões. Sincronizar não mexe em nada
   * que alguém escreveu: traz o ClickUp e põe cada coisa na coluna do status
   * dela. Então qualquer pessoa da empresa que VÊ o quadro pode sincronizar, e
   * o quadro da agência fica organizado para todo mundo, não só quando um
   * administrador abre. Quadro pessoal de outra pessoa continua 404.
   */
  async function quadroParaSincronizar(request: Parameters<typeof requireTenant>[0], reply: Parameters<typeof requireTenant>[1], boardId: string) {
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
    return quadro!;
  }

  app.patch<{ Params: { id: string } }>('/pipelines/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    await requireTenant(request, reply);
    if (reply.sent) return;
    const quadro = await quadroParaEscrita(request, reply, request.params.id);
    if (!quadro) return;
    const body = atualizarQuadroSchema.parse(request.body);

    /**
     * ESTÁGIOS DE QUADRO DE TAREFAS (15/10/2026, pedido do Pedro: criar,
     * editar, excluir e colorir estágios em qualquer quadro).
     *
     * Renomear, recolorir, reordenar e excluir não tocam o ClickUp: o rótulo é
     * da tela, o vínculo é o `clickupStatus`, que fica como estava. O que
     * precisa de conferência é coluna com status NOVO — ela só serve se o
     * status existir de verdade na lista, senão nenhuma tarefa cai nela e
     * arrastar para ela falha no ClickUp. Mesma regra do POST.
     */
    if (body.stages !== undefined && ehQuadroGeralDeTarefas(quadro)) {
      const semCategoria = body.stages.filter((s) => !s.categoria).map((s) => s.label);
      if (semCategoria.length > 0) {
        reply.code(400);
        return { error: `No quadro geral da agência toda coluna é uma categoria geral. Sem categoria: "${semCategoria.join('", "')}".` };
      }
    } else if (body.stages !== undefined && quadro.tipo === 'tarefas') {
      const semStatus = body.stages.filter((s) => !s.clickupStatus).map((s) => s.label);
      if (semStatus.length > 0) {
        reply.code(400);
        return { error: `Num quadro de tarefas toda coluna é um status do ClickUp. Sem status: "${semStatus.join('", "')}".` };
      }
      const jaTinha = new Set((quadro.stages as Array<{ clickupStatus?: string }>).map((s) => s.clickupStatus?.toLowerCase()).filter(Boolean));
      const novos = body.stages.filter((s) => !jaTinha.has(s.clickupStatus!.toLowerCase()));
      if (novos.length > 0) {
        const reais = await statusReaisDoQuadro(quadro, request.tenantContext!.organizationId);
        if ('erro' in reais) {
          reply.code(reais.codigo);
          return { error: reais.erro };
        }
        const invalidos = statusInvalidosParaALista(novos, reais.status);
        if (invalidos.length > 0) {
          reply.code(400);
          return { error: `Os status "${invalidos.join('", "')}" não existem no ClickUp deste quadro.`, detalhe: `Status reais: ${reais.status.join(', ')}` };
        }
      }
    }

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
    const quadro = await quadroParaSincronizar(request, reply, request.params.id);
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
          // 'pontual' é cliente de verdade (21 em produção, 14/10/2026) —
          // ficava de fora e o quadro parecia não sincronizar.
          inArray(schema.clients.status, ['active', 'pontual']),
          // QA nunca entra num quadro operacional — mesma regra do resto do
          // produto (client-context.ts, listasDeClickUpDaOrganizacao...).
          eq(schema.clients.environment, 'production'),
          isNull(schema.clients.deletedAt),
        ),
      );
    const { carteira } = separarCarteira(todos);

    /**
     * ORGANIZAR PELOS STATUS (15/10/2026, pedido do Pedro: "se a pipeline for
     * de cliente, organiza os clientes; se for de agência, de forma geral; se
     * for do colaborador, apenas o que estiver atribuído a ele").
     *
     * Cada cliente vai para a coluna do estado geral das tarefas dele
     * (categoriaDoCliente): da agência inteira no quadro da agência, só as
     * atribuídas ao dono no quadro pessoal — e no pessoal entram só os
     * clientes em que ele tem tarefa. Sem ClickUp, o quadro da agência ainda
     * recebe os clientes (sem organizar); o pessoal não tem como saber quais
     * são dele, e diz isso.
     */
    const porLista = await listasDosClientes(organizationId);
    const tarefasPorCliente = new Map<string, OperationTask[]>();
    let organizar = false;
    let avisoClickUp: string | null = null;
    const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
    if (resolucao?.credentials) {
      try {
        const daAgencia = quadro.ownerId ? null : await tarefasDaAgencia(resolucao.credentials, porLista);
        const daPessoa = quadro.ownerId ? await tarefasDaPessoa(resolucao.credentials, quadro.ownerId, porLista) : null;
        const tarefas: OperationTask[] | null = quadro.ownerId ? (daPessoa?.tarefas ?? null) : daAgencia!.tarefas;
        if (tarefas === null) {
          avisoClickUp = SEM_VINCULO_CLICKUP;
        } else if (daAgencia?.cortada || daPessoa?.cortada) {
          // Consulta cortada: cliente cujas tarefas não vieram pareceria "em
          // dia". Melhor não reorganizar do que reorganizar errado.
          avisoClickUp = 'O ClickUp devolveu só parte das tarefas; não reorganizei para não pôr cliente na coluna errada.';
        } else {
          for (const t of tarefas) {
            const cliente = t.listId ? porLista.get(t.listId) : undefined;
            if (!cliente) continue;
            const lista = tarefasPorCliente.get(cliente.id) ?? [];
            lista.push(t);
            tarefasPorCliente.set(cliente.id, lista);
          }
          organizar = true;
        }
      } catch (erro) {
        avisoClickUp = `O ClickUp não respondeu: ${erro instanceof Error ? erro.message : String(erro)}`;
      }
    } else {
      avisoClickUp = resolucao?.error ?? 'Empresa sem ClickUp conectado.';
    }
    if (quadro.ownerId && !organizar) {
      reply.code(502);
      return { error: 'Não consegui ver quais clientes têm tarefa atribuída a você, então não sei quais pôr no seu quadro.', detalhe: avisoClickUp };
    }
    const daPessoa = quadro.ownerId ? carteira.filter((c) => tarefasPorCliente.has(c.id)) : carteira;

    let stages = quadro.stages;
    if (organizar) {
      const comCategorias = garantirEstagiosGerais(quadro.stages);
      if (!estagiosIguais(comCategorias, quadro.stages)) {
        await db.update(schema.pipelineBoards).set({ stages: comCategorias }).where(eq(schema.pipelineBoards.id, quadro.id));
        stages = comCategorias;
      }
    }
    const colunaDoCliente = (clientId: string) =>
      organizar ? estagioDaCategoria(stages, categoriaDoCliente(tarefasPorCliente.get(clientId) ?? [])) : null;

    const existentes = await db
      .select({ id: schema.pipelineCards.id, clientId: schema.pipelineCards.clientId, stageId: schema.pipelineCards.stageId })
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)));
    const jaRepresentados = new Set(existentes.map((c) => c.clientId).filter((id): id is string => id !== null));

    const faltando = clientesSemCartao(daPessoa, jaRepresentados);
    const primeiraColuna = stages[0]!.id;
    const criados =
      faltando.length > 0
        ? await db
            .insert(schema.pipelineCards)
            .values(
              faltando.map((c) => ({
                boardId: quadro.id,
                stageId: colunaDoCliente(c.id)?.id ?? primeiraColuna,
                name: c.name,
                clientId: c.id,
                responsavel: null,
                valor: null,
                nota: '',
              })),
            )
            .returning()
        : [];

    // Reorganiza quem já estava: só cartão que está numa coluna geral (ou numa
    // coluna que sumiu). Cliente que a pessoa pôs numa coluna própria, como
    // "Proposta", fica onde ela pôs.
    let movidos = 0;
    if (organizar) {
      const daCategoria = new Set(stages.filter((st) => st.categoria).map((st) => st.id));
      const existentesIds = new Set(stages.map((st) => st.id));
      for (const cartao of existentes) {
        if (!cartao.clientId) continue;
        if (existentesIds.has(cartao.stageId) && !daCategoria.has(cartao.stageId)) continue;
        const destino = colunaDoCliente(cartao.clientId);
        if (destino && destino.id !== cartao.stageId) {
          await db.update(schema.pipelineCards).set({ stageId: destino.id }).where(eq(schema.pipelineCards.id, cartao.id));
          movidos++;
        }
      }
    }

    await auditarAcao(request, {
      organizationId,
      action: 'pipeline.board.clients_synced',
      resourceType: 'pipeline_board',
      resourceId: quadro.id,
      metadata: { criados: criados.length, movidos, organizado: organizar },
    });

    return { criados: criados.length, movidos, organizado: organizar, aviso: organizar ? null : avisoClickUp, cards: wireQuadro({ ...quadro, stages }, criados).cards };
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
    const quadro = await quadroParaSincronizar(request, reply, request.params.id);
    if (!quadro) return;

    if (quadro.tipo !== 'tarefas') {
      reply.code(400);
      return { error: 'Sincronizar tarefas só existe em quadro do tipo "tarefas".' };
    }
    /**
     * Sem cliente e com dono: é o quadro "atribuídas a mim" — as tarefas são
     * as do DONO do quadro, nunca de quem clicou (só o dono enxerga quadro
     * pessoal, mas a regra fica explícita). Sem cliente e sem dono é um
     * quadro da agência antigo, de antes de o cliente ser obrigatório.
     */
    /**
     * SEM CLIENTE E SEM DONO: o quadro geral da agência (15/10/2026). Antes
     * respondia 400 ("não está vinculado a um cliente"); agora junta as
     * tarefas abertas de todos os clientes, cada uma na categoria geral do
     * status dela, porque cada lista tem um fluxo próprio.
     */
    if (ehQuadroGeralDeTarefas(quadro)) {
      const organizationId = request.tenantContext!.organizationId;
      const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
      if (!resolucao?.credentials) {
        reply.code(502);
        return { error: 'Não consegui falar com o ClickUp para buscar as tarefas.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
      }
      let tarefas: Array<OperationTask & { clientId: string }>;
      let cortada = false;
      try {
        ({ tarefas, cortada } = await tarefasDaAgencia(resolucao.credentials, await listasDosClientes(organizationId)));
      } catch (erro) {
        reply.code(502);
        return { error: 'O ClickUp recusou listar as tarefas.', detalhe: erro instanceof Error ? erro.message : String(erro) };
      }

      // As colunas viram as quatro categorias; coluna antiga com nome de status
      // ("Para fazer", "Revisão"...) vira a categoria equivalente, mantendo id.
      const stages = garantirEstagiosGerais(quadro.stages, { soCategorias: true });
      if (!estagiosIguais(stages, quadro.stages)) {
        await db.update(schema.pipelineBoards).set({ stages }).where(eq(schema.pipelineBoards.id, quadro.id));
      }
      const concluido = estagioDaCategoria(stages, 'concluido')!;

      const existentes = await db
        .select()
        .from(schema.pipelineCards)
        .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)));
      const porTarefa = new Map(existentes.filter((c) => c.clickupTaskId).map((c) => [c.clickupTaskId!, c]));
      const abertas = new Set(tarefas.map((t) => t.id));

      const paraCriar: Array<Record<string, unknown> & { boardId: string; stageId: string; clickupTaskId: string; clientId: string; name: string }> = [];
      const mover = new Map<string, string[]>();
      const moverPara = (stageId: string, cardId: string) => mover.set(stageId, [...(mover.get(stageId) ?? []), cardId]);
      let atualizados = 0;
      for (const t of tarefas) {
        const destino = estagioDaCategoria(stages, categoriaDoStatus(t.status, t.statusType))!;
        const cartao = porTarefa.get(t.id);
        if (cartao) {
          const espelho = camposDaTarefa(t);
          const mudouColuna = cartao.stageId !== destino.id;
          if (mudouColuna) moverPara(destino.id, cartao.id);
          if (!mudouColuna && camposMudaram(cartao, espelho)) {
            await db.update(schema.pipelineCards).set(espelho).where(eq(schema.pipelineCards.id, cartao.id));
            atualizados++;
          }
          continue;
        }
        paraCriar.push({ boardId: quadro.id, stageId: destino.id, clickupTaskId: t.id, clientId: t.clientId, ...camposDaTarefa(t) });
      }
      // Tarefa que saiu das abertas foi encerrada (ou apagada) no ClickUp: o
      // cartão vai para Concluído em vez de ficar parado numa coluna mentindo.
      // Só com a consulta COMPLETA: cortada, "não veio" não quer dizer "encerrou".
      if (!cortada) {
        for (const c of existentes) {
          if (c.clickupTaskId && !abertas.has(c.clickupTaskId) && c.stageId !== concluido.id) moverPara(concluido.id, c.id);
        }
      }
      for (const [stageId, ids] of mover) {
        await db.update(schema.pipelineCards).set({ stageId }).where(inArray(schema.pipelineCards.id, ids));
      }
      const criados: Array<typeof schema.pipelineCards.$inferSelect> = [];
      for (let i = 0; i < paraCriar.length; i += 500) {
        criados.push(...(await db.insert(schema.pipelineCards).values(paraCriar.slice(i, i + 500)).onConflictDoNothing().returning()));
      }
      const movidos = [...mover.values()].reduce((n, ids) => n + ids.length, 0);

      await auditarAcao(request, {
        organizationId,
        action: 'pipeline.board.tasks_synced',
        resourceType: 'pipeline_board',
        resourceId: quadro.id,
        metadata: { criados: criados.length, movidos, atualizados, geral: true },
      });
      return { criados: criados.length, movidos, atualizados, sem_coluna: 0, cards: wireQuadro({ ...quadro, stages }, criados).cards };
    }

    const organizationId = request.tenantContext!.organizationId;
    let listId: string | null = null;
    if (quadro.clientId) {
      const [cliente] = await db
        .select({ id: schema.clients.id, clickupListId: schema.clients.clickupListId })
        .from(schema.clients)
        .where(and(eq(schema.clients.id, quadro.clientId), isNull(schema.clients.deletedAt)));
      if (!cliente?.clickupListId) {
        reply.code(400);
        return { error: 'O cliente deste quadro não tem lista do ClickUp vinculada.' };
      }
      listId = cliente.clickupListId;
    }

    const resolucao = await credenciaisClickUpDaEmpresa(organizationId);
    if (!resolucao?.credentials) {
      reply.code(502);
      return { error: 'Não consegui falar com o ClickUp para buscar as tarefas.', detalhe: resolucao?.error ?? 'Empresa sem ClickUp conectado.' };
    }

    let tarefas: OperationTask[] | null;
    let cortada = false;
    try {
      if (listId) {
        tarefas = (await queryOperationTasks(resolucao.credentials, { listIds: [listId], includeClosed: true, subtasks: true })).tasks;
      } else {
        const pessoal = await tarefasDaPessoa(resolucao.credentials, quadro.ownerId!, await listasDosClientes(organizationId));
        tarefas = pessoal?.tarefas ?? null;
        cortada = pessoal?.cortada ?? false;
      }
    } catch (erro) {
      reply.code(502);
      return { error: 'O ClickUp recusou listar as tarefas.', detalhe: erro instanceof Error ? erro.message : String(erro) };
    }
    if (!tarefas) {
      reply.code(409);
      return { error: SEM_VINCULO_CLICKUP };
    }
    const pagina = { tasks: tarefas };

    const existentes = await db
      .select()
      .from(schema.pipelineCards)
      .where(and(eq(schema.pipelineCards.boardId, quadro.id), isNull(schema.pipelineCards.deletedAt)));
    const cartaoDaTarefa = new Map(existentes.filter((c) => c.clickupTaskId).map((c) => [c.clickupTaskId!, c]));

    const paraCriar: Array<{
      boardId: string;
      stageId: string;
      clickupTaskId: string;
      name: string;
      responsavel: string | null;
      responsavelAvatar: string | null;
      prazo: Date | null;
      prioridade: string | null;
    }> = [];
    let semColuna = 0;
    let movidos = 0;
    let atualizados = 0;
    const vistas = new Set<string>();
    for (const task of pagina.tasks) {
      vistas.add(task.id);
      const jaTem = cartaoDaTarefa.get(task.id);
      if (jaTem) {
        // Sincronizar também REORGANIZA (15/10/2026): antes só criava cartão
        // novo, e a tarefa que mudou de status no ClickUp continuava na coluna
        // antiga para sempre.
        const destino = estagioPeloStatus(quadro.stages, task.status);
        const espelho = camposDaTarefa(task);
        const mudouColuna = destino && destino.id !== jaTem.stageId;
        if (mudouColuna || camposMudaram(jaTem, espelho)) {
          await db
            .update(schema.pipelineCards)
            .set({ ...(mudouColuna ? { stageId: destino.id } : {}), ...espelho })
            .where(eq(schema.pipelineCards.id, jaTem.id));
          if (mudouColuna) movidos++;
          else atualizados++;
        }
        continue;
      }
      const estagio = estagioPeloStatus(quadro.stages, task.status);
      if (!estagio) {
        // Encerrada sem coluna é escolha da pessoa (os encerrados vêm
        // desmarcados), não tarefa perdida — não entra no aviso de "ficou de fora".
        if (task.statusType !== 'closed' && task.statusType !== 'done') semColuna++;
        continue;
      }
      paraCriar.push({ boardId: quadro.id, stageId: estagio.id, clickupTaskId: task.id, ...camposDaTarefa(task) });
    }

    /**
     * LIMPEZA (15/10/2026): cartão cuja tarefa NÃO veio mais na busca saiu do
     * escopo do quadro — apagada no ClickUp, movida pra outra lista ou, no
     * quadro pessoal, de lista de QA/teste (o filtro de produção de
     * tarefasDaPessoa). Sem isto o "to do" do Pedro ficava cheio de
     * "QA Gate Bento" pra sempre. Só com a busca COMPLETA: cortada, "não
     * veio" não quer dizer "saiu".
     */
    let removidos = 0;
    if (!cortada) {
      const sairam = existentes.filter((c) => c.clickupTaskId && !vistas.has(c.clickupTaskId)).map((c) => c.id);
      if (sairam.length > 0) {
        await db.update(schema.pipelineCards).set({ deletedAt: new Date() }).where(inArray(schema.pipelineCards.id, sairam));
        removidos = sairam.length;
      }
    }

    const criados = paraCriar.length > 0 ? await db.insert(schema.pipelineCards).values(paraCriar).returning() : [];

    await auditarAcao(request, {
      organizationId,
      action: 'pipeline.board.tasks_synced',
      resourceType: 'pipeline_board',
      resourceId: quadro.id,
      metadata: { criados: criados.length, sem_coluna: semColuna, movidos, atualizados, removidos },
    });

    return { criados: criados.length, sem_coluna: semColuna, movidos, atualizados, removidos, cards: wireQuadro(quadro, criados).cards };
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
          const resolucao = await credenciaisClickUpDaEmpresa(quadro.organizationId);
          if (!resolucao?.credentials) {
            reply.code(502);
            return {
              error: 'Não consegui falar com o ClickUp para mudar o status desta tarefa.',
              detalhe: resolucao?.error ?? 'A empresa não tem ClickUp conectado. O cartão não foi movido.',
            };
          }
          try {
            /**
             * VÁLVULA DE HUMANO AUTENTICADO (ver write-scope.ts): arrastar o
             * cartão é uma pessoa logada, com permissão de escrita no quadro —
             * a cerca de lista de QA (CLICKUP_WRITE_SCOPE_LIST_ID, da época do
             * gate do Bento) não pode barrar o quadro, senão "mover muda o
             * status" vira mentira em produção. Agentes e automações continuam
             * cercados: só quem passa por requireAuth + quadroParaEscrita chega aqui.
             */
            await updateTask({ ...resolucao.credentials, writeScope: { authorizedForProduction: true } }, cartaoAtual.clickupTaskId, { status: estagioNovo.clickupStatus });
          } catch (erro) {
            reply.code(502);
            return {
              error: `O ClickUp recusou mudar o status para "${estagioNovo.clickupStatus}".`,
              detalhe: `${erro instanceof Error ? erro.message : String(erro)} O cartão continua onde estava.`,
            };
          }
        }
      }

      /**
       * QUADRO GERAL DA AGÊNCIA: a coluna é uma CATEGORIA, não um status. O
       * status escrito é o primeiro da lista desta tarefa que cai na
       * categoria de destino. Lista sem status dessa categoria: recusa, e o
       * cartão fica onde está — mesma regra de cima, o ClickUp vem primeiro.
       */
      if (quadro.tipo === 'tarefas' && estagioNovo?.categoria && !estagioNovo.clickupStatus) {
        const [cartaoAtual] = await db
          .select({ clickupTaskId: schema.pipelineCards.clickupTaskId, clientId: schema.pipelineCards.clientId })
          .from(schema.pipelineCards)
          .where(and(eq(schema.pipelineCards.id, request.params.cardId), eq(schema.pipelineCards.boardId, quadro.id)));
        if (cartaoAtual?.clickupTaskId) {
          const [cliente] = cartaoAtual.clientId
            ? await db.select({ clickupListId: schema.clients.clickupListId }).from(schema.clients).where(eq(schema.clients.id, cartaoAtual.clientId))
            : [];
          if (!cliente?.clickupListId) {
            reply.code(400);
            return { error: 'Não sei de qual lista do ClickUp é esta tarefa, então não consigo mudar o status dela. O cartão continua onde estava.' };
          }
          const resolucao = await credenciaisClickUpDaEmpresa(quadro.organizationId);
          if (!resolucao?.credentials) {
            reply.code(502);
            return { error: 'Não consegui falar com o ClickUp para mudar o status desta tarefa.', detalhe: 'O cartão não foi movido.' };
          }
          let status: string | null;
          try {
            status = statusDaListaParaCategoria(await estagiosDaLista(resolucao.credentials, cliente.clickupListId), estagioNovo.categoria);
          } catch (erro) {
            reply.code(502);
            return { error: 'O ClickUp recusou devolver os status desta lista.', detalhe: `${erro instanceof Error ? erro.message : String(erro)} O cartão continua onde estava.` };
          }
          if (!status) {
            reply.code(400);
            return { error: `A lista desta tarefa no ClickUp não tem nenhum status de "${rotuloDaCategoria(estagioNovo.categoria)}". O cartão continua onde estava.` };
          }
          try {
            // Mesma válvula do quadro com cliente, comentada ali em cima.
            await updateTask({ ...resolucao.credentials, writeScope: { authorizedForProduction: true } }, cartaoAtual.clickupTaskId, { status });
          } catch (erro) {
            reply.code(502);
            return { error: `O ClickUp recusou mudar o status para "${status}".`, detalhe: `${erro instanceof Error ? erro.message : String(erro)} O cartão continua onde estava.` };
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
