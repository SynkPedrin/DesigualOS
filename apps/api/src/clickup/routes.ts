import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, resolverPessoaPorClickupUserId, resolverPessoaPorEmail } from '@desigual-os/database';
import {
  createAttributedTask,
  createTaskComment,
  deleteTask,
  findMemberByEmail,
  getTaskComments,
  getTaskListId,
  getTaskResumo,
  getTeamMembers,
  parseTaskChangedEvent,
  parseTaskCommentPostedEvent,
  queryOperationTasks,
  recordToolResult,
  replyToComment,
  requestToolCall,
  updateTask,
  uploadTaskAttachment,
  verifyClickUpSignature,
  resolveClickUpCredentials,
  resolveClickUpCredentialsForOrganizations,
  ConnectorConfigError,
  type OperationTask,
} from '@desigual-os/tool-gateway';
import { precisaResincronizar, sincronizarCampanhasDoCliente } from '@desigual-os/context-engine';
import { createLogger } from '@desigual-os/logging';
import { getRedisConnection, publishWsEvent, recordLearning, recordOperationalEvent } from '@desigual-os/orchestrator';
import { stripBlockMarkers, stripEmDashes } from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import type { AuthenticatedUser } from '../auth/middleware';
import { escopoDeOrganizacao, type EscopoDeOrganizacao } from '../lib/escopo-de-organizacao';
import { organizacaoDeTrabalhoDe } from '../organizations/contexto';
import { resolveClickUpAccess, resolveSharedClickUpAccess } from '../integrations/access';
import { hasClientAccess } from '../lib/access';
import { claimIdempotency, fulfillIdempotency, idempotencyKey, releaseIdempotency } from '../lib/idempotency';
import { extrairContextoDoHistoryItem } from './webhook-actor';
import { extrairMudancas, frasearEventoDeTarefa, mudancaDeStatus } from './webhook-mudancas';
import { respondAsBento } from '../lib/bento-mention';
import { detectMentionedAgent, respondAsAgent, respondAsOtto } from '../lib/agent-mention';

const logger = createLogger({ service: 'clickup-webhook' });

/**
 * Assinatura das respostas que NÓS postamos (o prefixo "🧠 X responde:" vem
 * do serviço do agente). Sem essa guarda o webhook dispara de novo no nosso
 * próprio comentário: a resposta do Bento contém "marcando @Bento" no texto
 * dele, o regex de menção casa, e vira loop infinito (aconteceu de verdade
 * em 04/09/2026: 15 respostas em cadeia na task de teste).
 */
const BOT_REPLY_MARKER = /^🧠\s*(Bento|Jarbas|Suzy)\s+responde/im;

/** TTL do registro de comentário respondido (7 dias) — cobre retries do ClickUp. */
const MENTION_DEDUP_TTL_S = 7 * 24 * 60 * 60;

function mentionDedupKey(commentId: string): string {
  return `clickup:mention-answered:${commentId}`;
}

const createTaskSchema = z.object({
  list_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  // BL-15: criação completa (prioridade 1-4 na escala do ClickUp, prazo em
  // epoch ms, tags por nome).
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  due_date: z.number().int().positive().optional(),
  tags: z.array(z.string().min(1)).max(10).optional(),
});

const updateTaskSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.string().min(1).optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    due_date: z.number().int().positive().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field to update is required',
  });

const createCommentSchema = z.object({
  comment_text: z.string().min(1).max(4000),
});

const attachmentSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(200),
});

const taskParamsSchema = z.object({
  id: z.string().min(1),
});

function getClickUpConfig(): { apiKey: string; teamId: string } | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Mapa lista-do-ClickUp -> cliente (id/nome), base de autorização de toda
 * consulta "agência inteira": `queryOperationTasks` SEMPRE recebe só as
 * listas daqui como `listIds` - nunca vazio/omitido nessas rotas, porque
 * omitir o filtro significa "todo o workspace do ClickUp", não "todos os
 * clientes cadastrados no Desigual OS" (ver nota de autorização no topo de
 * clickup-operation.ts). Cliente sem `clickup_list_id` fica de fora, o que é
 * o comportamento certo (nada pra buscar por ele ainda).
 */
/**
 * As listas do ClickUp que ESTA PESSOA pode ver, por empresa.
 *
 * Nasceu sem recorte: selecionava TODOS os clientes do banco e montava o mapa
 * com todas as listas. Com uma organização, isso é a carteira da casa. Com
 * duas, `/clickup/tasks/agency` devolveria as tarefas dos clientes do outro
 * tenant — e nada no código acusaria, porque a consulta ao ClickUp funciona
 * igual e devolve tarefas de verdade.
 *
 * O inventário forense de 30/09/2026 marcou este módulo como o mais grave da
 * categoria "só papel, sem organização": nove rotas, dez checagens de papel,
 * zero de empresa, e é a porta para a operação inteira.
 *
 * O recorte sai da fonte canônica (`lib/escopo-de-organizacao.ts`), não de um
 * `where` escrito à mão aqui — é a seção 82 do briefing: enforcement central.
 */
async function clientsByClickUpListId(
  user: AuthenticatedUser,
  /**
   * O escopo já resolvido pelo chamador. `escopoDeOrganizacao` é uma consulta
   * a `organization_members`, e as duas rotas agregadas passaram a precisar do
   * escopo por conta própria (para saber de quais organizações a pessoa é
   * MEMBRO) — sem este parâmetro, a mesma pergunta ia ao banco duas vezes por
   * request. Com `DATABASE_POOL_MAX=3`, consulta repetida não é desperdício,
   * é fila: é o mesmo defeito que o cabeçalho de `requireTenant` descreve.
   */
  escopoResolvido?: EscopoDeOrganizacao,
): Promise<Map<string, { id: string; name: string; organizationId: string }>> {
  const escopo = escopoResolvido ?? (await escopoDeOrganizacao(user));

  /**
   * Provider enxerga todas as empresas; qualquer outra pessoa só as suas. E
   * quem não pertence a organização nenhuma não vê lista alguma — restritivo
   * de propósito: sem vínculo, não há do que se derivar permissão.
   */
  const recorte = escopo.ehProvider
    ? undefined
    : escopo.organizationIds.length > 0
      ? inArray(schema.clients.organizationId, escopo.organizationIds)
      : sql`false`;

  const rows = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      clickupListId: schema.clients.clickupListId,
      organizationId: schema.clients.organizationId,
    })
    .from(schema.clients)
    .where(recorte);
  const map = new Map<string, { id: string; name: string; organizationId: string }>();
  for (const row of rows) {
    // Cliente sem organização (fixture interno, órfão de uma organização
    // apagada) não tem credencial nenhuma pra resolver — fica de fora do
    // agregado em vez de quebrar o agrupamento por organização.
    if (row.clickupListId && row.organizationId) {
      map.set(row.clickupListId, { id: row.id, name: row.name, organizationId: row.organizationId });
    }
  }
  return map;
}

/**
 * AGRUPA as listas do ClickUp visíveis por ORGANIZAÇÃO DONA do cliente —
 * a peça que faltava para consultas agregadas (ver nota de
 * `resolveClickUpCredentialsForOrganizations`). Cada organização é
 * consultada com a credencial DELA; uma credencial nunca substitui a de
 * outra organização, mesmo quando a dela está quebrada ou ausente.
 */
function agruparListIdsPorOrganizacao(
  clientByListId: Map<string, { id: string; name: string; organizationId: string }>,
): Map<string, string[]> {
  const porOrganizacao = new Map<string, string[]>();
  for (const [listId, cliente] of clientByListId) {
    const atual = porOrganizacao.get(cliente.organizationId) ?? [];
    atual.push(listId);
    porOrganizacao.set(cliente.organizationId, atual);
  }
  return porOrganizacao;
}

/**
 * Resolve a credencial de CADA organização dona de ao menos um cliente
 * agregado, caindo na chave compartilhada (`resolveSharedClickUpAccess`) só
 * para quem AINDA NÃO TEM conector próprio — nunca para quem tem um
 * conector quebrado (essa organização fica de fora do resultado, nunca lida
 * com a chave de outra). Devolve também os nomes dos clientes afetados por
 * organização sem credencial utilizável, para a resposta avisar sem nunca
 * expor um id de organização ao navegador.
 */
async function resolverCredenciaisPorOrganizacao(
  clientByListId: Map<string, { id: string; name: string; organizationId: string }>,
  /**
   * As organizações de que a pessoa é MEMBRO. Entram na resolução mesmo sem
   * nenhum cliente com lista vinculada — é justamente a agência que ainda não
   * vinculou cliente nenhum e, sem isto, ficava sem credencial e sem tarefa.
   */
  organizacoesProprias: readonly string[] = [],
): Promise<{
  configPorOrganizacao: Map<string, { apiKey: string; teamId: string }>;
  clientesIndisponiveis: string[];
}> {
  const porOrganizacao = agruparListIdsPorOrganizacao(clientByListId);
  const alvos = [...new Set([...porOrganizacao.keys(), ...organizacoesProprias])];
  const resolucoes = await resolveClickUpCredentialsForOrganizations(alvos);

  const configPorOrganizacao = new Map<string, { apiKey: string; teamId: string }>();
  const organizacoesSemCredencial = new Set<string>();

  for (const [organizationId, resolucao] of resolucoes) {
    if (resolucao.credentials) {
      configPorOrganizacao.set(organizationId, resolucao.credentials);
      continue;
    }
    // `error` preenchido = conector existe e está quebrado -> nunca cai no
    // compartilhado (mesma regra de resolveClickUpCredentials). `error` nulo
    // = organização ainda não configurou conector próprio -> chave da casa.
    if (resolucao.error) {
      organizacoesSemCredencial.add(organizationId);
      continue;
    }
    const compartilhada = resolveSharedClickUpAccess();
    if (compartilhada) {
      configPorOrganizacao.set(organizationId, { apiKey: compartilhada.token, teamId: compartilhada.teamId });
    } else {
      organizacoesSemCredencial.add(organizationId);
    }
  }

  const clientesIndisponiveis = [...clientByListId.values()]
    .filter((c) => organizacoesSemCredencial.has(c.organizationId))
    .map((c) => c.name);

  return { configPorOrganizacao, clientesIndisponiveis };
}

/**
 * ─── O PLANO DE CONSULTA DA CENTRAL DE TASKS ────────────────────────────
 *
 * O DEFEITO QUE ISTO CORRIGE (07/10/2026, relatado na tela): "Todas as
 * tarefas" nunca significou todas as tarefas. As duas rotas agregadas
 * consultavam EXCLUSIVAMENTE as listas vinculadas a algum cliente
 * (`clients.clickup_list_id`). Tudo que a agência faz e que não é de um
 * cliente — tarefa interna, financeiro, processo, comercial, e as listas dos
 * 6 clientes (de 58) que ainda não têm vínculo — simplesmente não existia na
 * tela. E "Minhas tarefas" herdava o mesmo buraco: uma tarefa atribuída a
 * você numa lista não vinculada não aparecia em lugar nenhum do produto.
 *
 * A REGRA NOVA, e o motivo de ela não ser "consultar tudo sempre":
 *
 *   organização de que a pessoa é MEMBRO  -> workspace inteiro.
 *       É a agência dela. "Todas as tarefas da agência" só quer dizer isso.
 *
 *   organização que ela apenas ENXERGA    -> só as listas dos clientes.
 *       É o caso do provedor olhando a conta de um cliente. Ver o trabalho
 *       dos clientes DAQUELA empresa é supervisão; varrer o workspace
 *       inteiro dela seria outra coisa, e ninguém pediu por isso. É a mesma
 *       régua de `hierarquia-de-organizacao.ts`: leitura desce, e descer não
 *       é virar acesso irrestrito.
 *
 * UM WORKSPACE, UMA CONSULTA. Sem isto, duas organizações que caem na mesma
 * chave compartilhada (o caso comum hoje) devolveriam o MESMO workspace duas
 * vezes, e a tela mostraria cada tarefa em duplicata. Quando um workspace é
 * alcançado por mais de uma organização, vale a consulta mais ampla das duas:
 * um recorte por lista não pode esconder o que a consulta do workspace já
 * traria.
 */
export interface ConsultaDeWorkspace {
  config: { apiKey: string; teamId: string };
  /** `undefined` = workspace inteiro. Array = só estas listas. */
  listIds: string[] | undefined;
}

export function planejarConsultas(
  configPorOrganizacao: Map<string, { apiKey: string; teamId: string }>,
  listIdsPorOrganizacao: Map<string, string[]>,
  organizacoesProprias: ReadonlySet<string>,
): ConsultaDeWorkspace[] {
  const porWorkspace = new Map<string, ConsultaDeWorkspace>();

  for (const [organizationId, config] of configPorOrganizacao) {
    const chave = `${config.teamId}|${config.apiKey}`;
    const inteiro = organizacoesProprias.has(organizationId);
    const existente = porWorkspace.get(chave);

    if (!existente) {
      porWorkspace.set(chave, { config, listIds: inteiro ? undefined : [...(listIdsPorOrganizacao.get(organizationId) ?? [])] });
      continue;
    }
    // Já é consulta de workspace inteiro: nada a somar.
    if (existente.listIds === undefined) continue;
    if (inteiro) {
      existente.listIds = undefined;
      continue;
    }
    existente.listIds.push(...(listIdsPorOrganizacao.get(organizationId) ?? []));
  }

  // Organização própria sem NENHUM cliente com lista também precisa entrar —
  // ela não aparece em `listIdsPorOrganizacao`, e é exatamente a agência que
  // ainda não vinculou cliente nenhum.
  return [...porWorkspace.values()].filter((c) => c.listIds === undefined || c.listIds.length > 0);
}

/** Mesma tarefa alcançada por dois caminhos conta uma vez só. */
export function semDuplicatas(tasks: OperationTask[]): OperationTask[] {
  const vistos = new Set<string>();
  const saida: OperationTask[] = [];
  for (const task of tasks) {
    if (vistos.has(task.id)) continue;
    vistos.add(task.id);
    saida.push(task);
  }
  return saida;
}

function wireOperationTask(
  task: OperationTask,
  clientByListId: Map<string, { id: string; name: string; organizationId: string }>,
) {
  const cliente = task.listId ? clientByListId.get(task.listId) : undefined;
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    status_type: task.statusType,
    priority: task.priority,
    url: task.url,
    due_date: task.dueDate,
    start_date: task.startDate,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    assignees: task.assignees,
    tags: task.tags,
    list_name: task.listName,
    // Nunca o organization_id no fio — vocabulário do produto não expõe
    // identificador de tenant ao navegador (ver CLAUDE.md).
    client: cliente ? { id: cliente.id, name: cliente.name } : null,
  };
}

/**
 * Task criada/editada/apagada no ClickUp (pedido do usuário, 09/09/2026:
 * "se eu criar uma nova task agora em um cliente dentro clickup ele vai
 * atualizar dentro do sistema automatico") - publica um evento leve no WS só
 * com o `client_id` (nunca o conteúdo da task) pro front invalidar a lista
 * de tarefas daquele cliente e refazer o GET /clients/:id/clickup/tasks
 * (fonte real, já existente). `list_id` às vezes não vem no payload (webhook
 * inscrito no escopo do Space inteiro em vez de por lista, ver
 * parseTaskChangedEvent) - nesse caso busca a lista da task na API antes de
 * descartar o evento como "não é de nenhum cliente conhecido".
 */
/**
 * Uma edição em lote no ClickUp vira vários webhooks da mesma tarefa em
 * segundos (um por campo alterado). Sem isto, cada um deles pagaria um GET.
 * 60s é curto de propósito: o nome de uma tarefa muda, e cache longo faria a
 * linha do tempo mostrar o nome velho — um erro silencioso e difícil de ver.
 */
/**
 * CACHE DA CONSULTA AO CLICKUP, COM REVALIDAÇÃO EM SEGUNDO PLANO.
 *
 * Medido em produção em 08/10/2026, mediana de três chamadas autenticadas:
 * `/clickup/tasks/agency` em 7,71s, contra menos de 1,6s de todo o resto do
 * sistema. É a espera mais longa que alguém encontra clicando numa tela, e ela
 * acontece de novo, inteira, a cada visita — a resposta nunca era reaproveitada.
 *
 * O caro não é nosso: são as chamadas ao ClickUp (a agência tem 1291 tarefas, e
 * a paginação já roda em paralelo). O que dá pra fazer é parar de repeti-las.
 *
 * Duas janelas em vez de um TTL, porque o pedido tinha duas metades que puxam
 * pra lados opostos — mais rápido E mais atualizado:
 *
 *   até 1min   serve do cache, sem tocar no ClickUp.
 *   até 10min  serve do cache NA HORA e dispara a releitura por trás. Quem
 *              pediu não espera, e a próxima pessoa já pega o dado novo.
 *   depois     busca de verdade, como antes.
 *
 * A chave é a CONSULTA, não a pessoa: o que o ClickUp devolve depende do
 * workspace, da credencial e das listas pedidas — nunca de quem perguntou. Duas
 * pessoas com escopos diferentes geram chaves diferentes, e o recorte por
 * cliente continua acontecendo depois, no `wireOperationTask`, com o mapa
 * daquela pessoa. A credencial entra como hash: chave de cache não é lugar de
 * carregar segredo em texto, mesmo em memória.
 */
const FRESCO_MS = 60_000;
const VALIDADE_MS = 10 * 60_000;
const LIMITE_CONSULTAS = 50;

type ResultadoDeConsulta = Awaited<ReturnType<typeof queryOperationTasks>>;
const consultasEmCache = new Map<string, { em: number; resultado: ResultadoDeConsulta; renovando: boolean }>();

export function chaveDaConsulta(consulta: ConsultaDeWorkspace): string {
  const credencial = createHash('sha256').update(consulta.config.apiKey).digest('hex').slice(0, 12);
  const listas = consulta.listIds ? [...consulta.listIds].sort().join(',') : '*';
  return `${consulta.config.teamId}|${credencial}|${listas}`;
}

async function consultarComCache(consulta: ConsultaDeWorkspace): Promise<ResultadoDeConsulta> {
  const chave = chaveDaConsulta(consulta);
  const agora = Date.now();
  const guardado = consultasEmCache.get(chave);
  const buscar = () =>
    queryOperationTasks(consulta.config, consulta.listIds ? { listIds: consulta.listIds } : {});

  if (guardado && agora - guardado.em < VALIDADE_MS) {
    if (agora - guardado.em >= FRESCO_MS && !guardado.renovando) {
      guardado.renovando = true;
      /**
       * `void` com `.catch` obrigatório: uma releitura que falha em segundo
       * plano não pode virar unhandled rejection e derrubar o processo. Falhou,
       * o cache continua com o valor velho e a próxima chamada tenta de novo —
       * nunca pior do que não ter cache.
       */
      void buscar()
        .then((resultado) => consultasEmCache.set(chave, { em: Date.now(), resultado, renovando: false }))
        .catch((error) => {
          guardado.renovando = false;
          logger.warn({ error }, 'Releitura em segundo plano das tarefas do ClickUp falhou; servindo o cache anterior');
        });
    }
    return guardado.resultado;
  }

  const resultado = await buscar();
  // Teto de memória, igual ao cache de resumos de webhook logo abaixo.
  if (consultasEmCache.size >= LIMITE_CONSULTAS) {
    const maisAntiga = consultasEmCache.keys().next().value;
    if (maisAntiga !== undefined) consultasEmCache.delete(maisAntiga);
  }
  consultasEmCache.set(chave, { em: Date.now(), resultado, renovando: false });
  return resultado;
}

/**
 * O webhook de tarefa alterada esvazia o cache: é o que torna "mais rápido" e
 * "mais atualizado" compatíveis de verdade. Sem isto, mexer numa tarefa no
 * ClickUp podia levar até um minuto pra aparecer aqui; com isto, a próxima
 * leitura já vai buscar. Esvazia tudo, não a entrada certa: descobrir quais
 * consultas contêm aquela tarefa custaria mais do que a releitura, e o evento é
 * raro perto do número de leituras.
 */
export function esquecerTarefasEmCache(): void {
  consultasEmCache.clear();
}

const TTL_RESUMO_MS = 60_000;
const LIMITE_RESUMOS = 500;
const resumosDeTarefa = new Map<string, { em: number; resumo: Awaited<ReturnType<typeof getTaskResumo>> }>();

async function resumoDaTarefa(config: Parameters<typeof getTaskResumo>[0], taskId: string) {
  const agora = Date.now();
  const guardado = resumosDeTarefa.get(taskId);
  if (guardado && agora - guardado.em < TTL_RESUMO_MS) return guardado.resumo;

  const resumo = await getTaskResumo(config, taskId);
  // Mapa com teto: um webhook público não pode virar vazamento de memória.
  if (resumosDeTarefa.size >= LIMITE_RESUMOS) {
    const maisAntiga = resumosDeTarefa.keys().next().value;
    if (maisAntiga !== undefined) resumosDeTarefa.delete(maisAntiga);
  }
  resumosDeTarefa.set(taskId, { em: agora, resumo });
  return resumo;
}

async function handleTaskChanged(
  changed: { event: string; taskId: string; listId: string | null },
  raw?: Record<string, unknown>,
): Promise<void> {
  // Tarefa mudou no ClickUp: o que estiver em cache está velho a partir de
  // agora. Primeira coisa do handler de propósito — vale mesmo que o resto
  // abaixo desista (sem config, evento de lista desconhecida), porque a mudança
  // aconteceu de qualquer jeito.
  esquecerTarefasEmCache();

  const config = getClickUpConfig();
  if (!config) return;

  /**
   * NOME DA TAREFA (02/10/2026). O webhook do ClickUp não manda o nome em
   * evento nenhum — só `task_id`. Sem buscá-lo, a linha do tempo escreve
   * "Atualizou uma tarefa" para sempre, que foi exatamente o estado medido nos
   * 872 eventos existentes.
   *
   * O GET já era feito quando faltava `list_id`; agora é feito também quando
   * vem, e o `resumoDaTarefa` segura o resultado por 60s para que uma edição
   * em lote (que o ClickUp entrega como vários webhooks da MESMA tarefa em
   * segundos) não vire várias chamadas. `taskDeleted` não busca: a tarefa não
   * existe mais, e o 404 seria garantido.
   */
  let listId = changed.listId;
  let nomeDaTarefa: string | null = null;
  if (changed.event !== 'taskDeleted') {
    try {
      const resumo = await resumoDaTarefa(config, changed.taskId);
      listId = listId ?? resumo.listId;
      nomeDaTarefa = resumo.name;
    } catch (error) {
      // Degrada, não desiste: sem o nome o evento ainda vale (ator, cliente,
      // mudança de status). Só desiste se a lista também ficou desconhecida.
      logger.warn({ error, taskId: changed.taskId }, 'ClickUp webhook: não consegui ler a tarefa alterada');
    }
  }
  if (!listId) {
    logger.warn({ taskId: changed.taskId }, 'ClickUp webhook: não achei a lista da task alterada');
    return;
  }

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
  if (!client) return;

  /**
   * ORGANIZAÇÃO + AUTOR (01/10/2026). Antes o evento nascia sem
   * `organization_id` (o get_recent_events do MCP precisava de um fallback
   * transicional por client_id pra enxergá-lo) e com `actor: null` — o payload
   * traz history_items[].user (id/username/email) e a gente jogava fora.
   * Agora: org vem do cliente resolvido, e o autor é resolvido pelo entity
   * graph (link ClickUp user id -> users.id), caindo pro e-mail quando o link
   * ainda não existe (e GRAVANDO o link nesse caso). Sem link e sem e-mail
   * casado, actor segue null — nunca inventado (regra do event store).
   */
  const organizationId = client.organizationId ?? null;
  const { autor: autorClickUp, ocorridoEm } = extrairContextoDoHistoryItem(raw);
  const mudancas = extrairMudancas(raw);
  const statusMudado = mudancaDeStatus(mudancas);
  let actor: string | null = null;
  let actorUserId: string | null = null;
  let actorEmployeeId: string | null = null;
  let actorResolution: 'link' | 'email' | 'nao_resolvido' = 'nao_resolvido';
  if (autorClickUp && organizationId) {
    try {
      const porLink = await resolverPessoaPorClickupUserId(organizationId, autorClickUp.clickupUserId);
      const pessoa =
        porLink ??
        (autorClickUp.email ? await resolverPessoaPorEmail(organizationId, autorClickUp.email, autorClickUp.clickupUserId) : null);
      if (pessoa) {
        actor = pessoa.name;
        actorUserId = pessoa.userId;
        actorEmployeeId = pessoa.employeeId;
        actorResolution = porLink ? 'link' : 'email';
      }
    } catch (error) {
      // Resolução de autor nunca derruba o webhook: pior caso é o comportamento
      // de antes (evento gravado sem ator).
      logger.warn({ error, taskId: changed.taskId }, 'ClickUp webhook: falha ao resolver autor do evento');
    }
  }

  // EVENT STORE (10/09/2026): antes disto o evento era usado pra invalidar a UI e
  // descartado. Nada ficava, então "o que mudou desde ontem?" era irrespondível. Agora
  // fica gravado de forma idempotente (índice único source+external_id, porque o ClickUp
  // reentrega evento em retry) e vira material de contexto e de proatividade.
  const stored = await recordOperationalEvent({
    source: 'clickup',
    // 'taskCreated' -> 'task.created'
    type: changed.event.replace(/^task/, 'task.').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
    externalId: `${changed.event}:${changed.taskId}:${(raw?.['webhook_id'] as string | undefined) ?? ''}`,
    organizationId,
    userId: actorUserId,
    employeeId: actorEmployeeId,
    clientId: client.id,
    entityType: 'task',
    entityId: changed.taskId,
    taskId: changed.taskId,
    actor,
    /**
     * O QUE MUDOU (02/10/2026). `history_items[].field/before/after` ia inteiro
     * para o lixo, e com ele a única resposta possível para "o que mudou de
     * status hoje?". Agora o evento nasce com a frase pronta e com as mudanças
     * estruturadas — a frase para a tela ler sem recalcular, as mudanças para
     * quem precisar filtrar por status sem reparsear texto.
     */
    summary: frasearEventoDeTarefa({ evento: changed.event, nomeDaTarefa, mudancas }),
    payload: {
      list_id: listId,
      event: changed.event,
      actor_resolution: actorResolution,
      task_name: nomeDaTarefa,
      changes: mudancas,
      ...(statusMudado ? { status_from: statusMudado.de, status_to: statusMudado.para } : {}),
    },
    ...(raw ? { raw } : {}),
    occurredAt: ocorridoEm ?? new Date(),
  });
  if (stored.status === 'duplicate') {
    logger.debug({ taskId: changed.taskId }, 'Evento reentregue pelo ClickUp, ignorado (idempotencia)');
  }

  // SYNC INCREMENTAL do registro de campanhas. O evento do ClickUp já chegava
  // aqui e só invalidava UI; agora ele mantém o conhecimento do agente vivo:
  // task nova/alterada re-deriva as campanhas daquele cliente. `precisaResincronizar`
  // segura a frequência (janela de 5 min por cliente), senão uma conta movimentada
  // como a D. Carvalho dispararia releitura de 900+ tasks a cada clique.
  if (await precisaResincronizar(client.id).catch(() => false)) {
    void sincronizarCampanhasDoCliente(client.id, listId, async (lista) => {
      const page = await queryOperationTasks(config, { listIds: [lista], includeClosed: true, subtasks: true }).catch(() => null);
      return (page?.tasks ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        status: t.status,
        closed: t.statusType === 'closed' || t.statusType === 'done',
        updatedAt: t.updatedAt ? new Date(t.updatedAt) : null,
      }));
    }).catch((error: unknown) => {
      logger.warn({ error, clientId: client.id }, 'Sync incremental de campanhas falhou');
    });
  }

  await publishWsEvent({
    type: 'clickup.task_changed',
    payload: { client_id: client.id, task_id: changed.taskId, event: changed.event },
  });
}

/**
 * Uma única chave de API do ClickUp compartilhada (decisão do usuário, mais
 * simples que OAuth por colaborador). Atribuição de tarefa por e-mail
 * (users.clickup_email), ver packages/tool-gateway. NÃO TESTADO CONTRA A
 * API REAL ainda: aguardando o usuário gerar e enviar CLICKUP_API_KEY e
 * CLICKUP_TEAM_ID.
 */
export async function registerClickUpRoutes(app: FastifyInstance): Promise<void> {
  app.post('/clickup/tasks', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const body = createTaskSchema.parse(request.body);
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    // Autorização de escopo (auditoria pré-deploy 14/09/2026): antes desta
    // checagem, qualquer autenticado com clickup:write criava tarefa em
    // QUALQUER lista do workspace do ClickUp, bastava adivinhar o list_id.
    // Mesmo padrão do POST /clickup/tasks/:id/comments abaixo: a lista precisa
    // pertencer a um cliente cadastrado e o usuário precisa de acesso a ele.
    // Vem antes da idempotência pra não consumir a janela de dedup com
    // chamada que nunca seria autorizada.
    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, body.list_id));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'List does not belong to any client known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    // Idempotência de intenção (auditoria 11/09/2026: double submit criou 2
    // tasks reais no ClickUp, ids 86bbz5h7q/86bbz5h7v). Janela curta contra
    // clique duplo e retry de rede; criar duas tasks com o mesmo nome de
    // propósito segue possível após os 15s da janela.
    const idemKey = idempotencyKey('clickup-task', [request.authUser?.id, body.list_id, body.name]);
    const existing = await claimIdempotency(idemKey);
    if (existing !== null) {
      if (existing !== 'pending') {
        try {
          const replay = JSON.parse(existing) as { id: string; url: string; assigned: boolean };
          reply.code(201);
          return { ...replay, deduplicated: true };
        } catch {
          // valor corrompido: cai no 409 abaixo
        }
      }
      reply.code(409);
      return { error: 'Uma tarefa idêntica já está sendo criada. Aguarde um instante.' };
    }

    try {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.authUser?.id ?? ''));

    const result = await createAttributedTask(config, {
      listId: body.list_id,
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      requesterName: user?.name ?? request.authUser?.email ?? 'desconhecido',
      requesterClickUpEmail: user?.clickupEmail ?? null,
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.due_date !== undefined ? { dueDate: body.due_date } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
    });

    await db.insert(schema.auditLogs).values({
      userId: request.authUser?.id ?? null,
      action: 'clickup.task_created',
      result: 'completed',
      metadata: { list_id: body.list_id, task_id: result.id, assigned: result.assigned },
    });

    await fulfillIdempotency(idemKey, JSON.stringify({ id: result.id, url: result.url, assigned: result.assigned }));

    reply.code(201);
    return { id: result.id, url: result.url, assigned: result.assigned };
    } catch (error) {
      await releaseIdempotency(idemKey);
      throw error;
    }
  });

  // Deletar tarefa é a ação crítica citada na seção 6.6 (Tool Gateway):
  // passa pela fila de aprovação humana em vez de executar na hora (ver
  // packages/tool-gateway/src/gateway.ts e apps/api/src/tool-calls/routes.ts).
  // Antes da fila, a mesma checagem de dono do comentário/anexo (auditoria
  // pré-deploy 14/09/2026): sem ela, qualquer autenticado enfileirava a
  // deleção de qualquer task do workspace só adivinhando o id.
  app.delete<{ Params: { id: string } }>('/clickup/tasks/:id', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    let listId: string;
    try {
      listId = await getTaskListId(config, request.params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: request.params.id }, 'Falha ao localizar a tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }

    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'Task does not belong to any client list known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    const outcome = await requestToolCall({
      agent: 'bento',
      tool: 'clickup.delete_task',
      input: { task_id: request.params.id },
    });

    if (outcome.status === 'denied') {
      reply.code(403);
      return { error: 'Agent has no access to clickup.delete_task', tool_call_id: outcome.toolCallId };
    }

    if (outcome.status === 'pending_approval') {
      reply.code(202);
      return { status: 'pending_approval', tool_call_id: outcome.toolCallId };
    }

    try {
      await deleteTask(config, request.params.id);
      await recordToolResult(outcome.toolCallId, 'completed', { task_id: request.params.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordToolResult(outcome.toolCallId, 'failed', null, message);
      reply.code(502);
      return { error: message };
    }

    return { status: 'completed', tool_call_id: outcome.toolCallId };
  });

  /**
   * BL-01 (auditoria forense 12/09/2026): editar task não existia. Segue o
   * mesmo padrão do DELETE: passa pela fila de aprovação humana do Tool
   * Gateway (clickup.update_task). A executor mora em tool-calls/routes.ts.
   * Mesma checagem de dono do DELETE antes de enfileirar (auditoria
   * pré-deploy 14/09/2026).
   */
  app.patch<{ Params: { id: string } }>('/clickup/tasks/:id', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const body = updateTaskSchema.parse(request.body);
    const config = getClickUpConfig();
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    let listId: string;
    try {
      listId = await getTaskListId(config, request.params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: request.params.id }, 'Falha ao localizar a tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }

    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'Task does not belong to any client list known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    const outcome = await requestToolCall({
      agent: 'bento',
      tool: 'clickup.update_task',
      input: { task_id: request.params.id, fields: body },
    });

    if (outcome.status === 'denied') {
      reply.code(403);
      return { error: 'Agent has no access to clickup.update_task', tool_call_id: outcome.toolCallId };
    }

    if (outcome.status === 'pending_approval') {
      reply.code(202);
      return { status: 'pending_approval', tool_call_id: outcome.toolCallId };
    }

    try {
      await updateTask(config, request.params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.due_date !== undefined ? { dueDate: body.due_date } : {}),
      });
      await recordToolResult(outcome.toolCallId, 'completed', { task_id: request.params.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordToolResult(outcome.toolCallId, 'failed', null, message);
      reply.code(502);
      return { error: message };
    }

    await db.insert(schema.auditLogs).values({
      userId: request.authUser?.id ?? null,
      action: 'clickup.task_updated',
      result: 'completed',
      metadata: { task_id: request.params.id, fields: Object.keys(body) },
    });

    return { status: 'completed', tool_call_id: outcome.toolCallId };
  });

  /**
   * BL-05: anexo real numa task do ClickUp. O arquivo já está no nosso
   * Storage (upload do chat via POST /uploads); baixamos e reenviamos como
   * multipart. Mesma proteção do comentário: a task precisa pertencer à
   * lista de um cliente cadastrado e o usuário precisa de acesso a ele.
   */
  app.post<{ Params: { id: string } }>('/clickup/tasks/:id/attachments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = attachmentSchema.parse(request.body);

    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }
    const config = { apiKey: access.token, teamId: access.teamId };

    let listId: string;
    try {
      listId = await getTaskListId(config, params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao localizar a tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }

    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'Task does not belong to any client list known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    try {
      const attached = await uploadTaskAttachment(config, params.id, body.url, body.filename);
      reply.code(201);
      return { status: 'attached', task_id: params.id, filename: body.filename, attachment_id: attached.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao anexar arquivo na tarefa do ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  /**
   * Auditoria P0-A (06/10/2026): esta rota devolvia o workspace INTEIRO
   * configurado por env global, ignorando `organization_connectors` — uma
   * empresa com ClickUp próprio receberia os membros do workspace de OUTRA
   * empresa (hoje sem efeito prático, uma organização só no banco; passa a
   * importar no dia em que a segunda existir). Resolve pela empresa em que o
   * chamador está TRABALHANDO (mesmo conceito de `request.tenantContext`,
   * só que esta rota ainda não passou por `requireTenant`) e só cai pro
   * fallback de env quando a empresa não tem conector próprio — nunca
   * quando ele existe e está quebrado (`ConnectorConfigError` vira 409,
   * nunca silenciosamente o workspace de outro tenant).
   */
  app.get('/clickup/members', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const organizacao = await organizacaoDeTrabalhoDe(user);
    let config: { apiKey: string; teamId: string } | null;
    try {
      const credenciais = await resolveClickUpCredentials(organizacao?.id ?? null);
      config = credenciais ?? getClickUpConfig();
    } catch (error) {
      reply.code(409);
      return { error: error instanceof ConnectorConfigError ? error.message : 'Conector do ClickUp desta empresa está indisponível.' };
    }
    if (!config) {
      reply.code(500);
      return { error: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator' };
    }

    const members = await getTeamMembers(config);
    return { members: members.map((member) => ({ id: member.id, email: member.email, username: member.username })) };
  });

  /**
   * "Central de Tasks" (pedido do usuário, 10/09/2026): todas as tarefas de
   * TODOS os clientes com lista vinculada no ClickUp, numa view só - antes só
   * existia por cliente (GET /clients/:id/clickup/tasks). Reusa
   * `queryOperationTasks` (GET /team/{id}/task, já existia só pro contexto de
   * chat dos agentes) - esta é a primeira rota que expõe isso pro navegador.
   *
   * REDESENHO MULTI-ORG (pré-release, 06/10/2026): antes, uma consulta que
   * agrega clientes de organizações DIFERENTES usava UMA credencial só — a
   * pessoal/compartilhada de quem perguntou, não a de cada organização dona
   * de cada cliente. Com uma organização isso é invisível; com duas, a
   * segunda organização silenciosamente não aparecia nenhuma tarefa dela
   * (ClickUp isola por workspace no próprio token — credencial errada
   * resulta em "não encontrado", nunca em vazamento de dado de outra
   * organização, mas o resultado agregado ficava incompleto sem aviso).
   * Agora: agrupa por organização, resolve a credencial de CADA uma,
   * consulta cada workspace com a credencial dele, mescla preservando a
   * proveniência por CLIENTE (nunca o id de organização no fio).
   */
  app.get('/clickup/tasks/agency', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const escopo = await escopoDeOrganizacao(user);
    const proprias = new Set(escopo.organizationIds);
    const clientByListId = await clientsByClickUpListId(user, escopo);

    const { configPorOrganizacao, clientesIndisponiveis } = await resolverCredenciaisPorOrganizacao(
      clientByListId,
      escopo.organizationIds,
    );
    if (configPorOrganizacao.size === 0) {
      /**
       * Lista vazia AQUI seria mentira: "nenhuma tarefa" e "não consegui
       * perguntar" são coisas diferentes, e só a segunda tem conserto. A tela
       * manda conferir o acesso ao ClickUp, que é o que de fato falta.
       */
      reply.code(400);
      return { error: 'No ClickUp access available for any organization visible to this user' };
    }

    try {
      const consultas = planejarConsultas(configPorOrganizacao, agruparListIdsPorOrganizacao(clientByListId), proprias);
      const resultados = await Promise.all(consultas.map((consulta) => consultarComCache(consulta)));
      const tasks = semDuplicatas(resultados.flatMap((r) => r.tasks));
      const truncated = resultados.some((r) => r.truncated);
      return {
        tasks: tasks.map((task) => wireOperationTask(task, clientByListId)),
        truncated,
        ...(clientesIndisponiveis.length > 0 ? { unavailable_clients: clientesIndisponiveis } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error }, 'Falha ao buscar tarefas da agência no ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  /**
   * Só as tarefas atribuídas ao usuário logado, resolvido por
   * `users.clickup_email` -> id numérico do ClickUp (`findMemberByEmail`).
   * 409 quando ainda não vinculou e-mail nenhum, ou quando o e-mail vinculado
   * não bate com NENHUM membro de NENHUM workspace visível - mesmo padrão de
   * "cliente sem lista" já usado no resto deste arquivo: estado esperado,
   * não erro de sistema (a UI mostra um convite pra vincular, não uma tela
   * de erro).
   *
   * REDESENHO MULTI-ORG (mesma nota de `/clickup/tasks/agency`): o id
   * numérico de membro do ClickUp é POR WORKSPACE — a mesma pessoa pode ter
   * ids diferentes (ou nem existir) em workspaces de organizações
   * diferentes. `findMemberByEmail` roda uma vez POR organização, com a
   * credencial dela; não achar a pessoa num workspace específico é
   * silencioso (zero tarefas daquela organização), não um erro — só é 409
   * quando a pessoa não bate em workspace NENHUM.
   */
  app.get('/clickup/tasks/me', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, request.authUser?.id ?? ''));
    if (!user?.clickupEmail) {
      reply.code(409);
      return { error: 'No ClickUp email linked for this user yet' };
    }

    const autenticado = request.authUser;
    if (!autenticado) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const escopo = await escopoDeOrganizacao(autenticado);
    const proprias = new Set(escopo.organizationIds);
    const clientByListId = await clientsByClickUpListId(autenticado, escopo);

    const { configPorOrganizacao, clientesIndisponiveis } = await resolverCredenciaisPorOrganizacao(
      clientByListId,
      escopo.organizationIds,
    );
    if (configPorOrganizacao.size === 0) {
      // Mesma razão de `/clickup/tasks/agency`: sem credencial não dá para
      // afirmar que você não tem tarefa nenhuma.
      reply.code(400);
      return { error: 'No ClickUp access available for any organization visible to this user' };
    }

    try {
      const consultas = planejarConsultas(configPorOrganizacao, agruparListIdsPorOrganizacao(clientByListId), proprias);
      /**
       * O id numérico do membro é POR WORKSPACE: a mesma pessoa tem ids
       * diferentes (ou nenhum) em workspaces distintos. Por isso a busca do
       * membro acompanha a consulta, e não a organização.
       */
      const comMembro = (
        await Promise.all(
          consultas.map(async (consulta) => ({
            consulta,
            member: await findMemberByEmail(consulta.config, user.clickupEmail!),
          })),
        )
      ).filter((c) => c.member !== null);

      if (comMembro.length === 0) {
        reply.code(409);
        return { error: 'Linked ClickUp email does not match any member of any visible workspace' };
      }

      const resultados = await Promise.all(
        comMembro.map(({ consulta, member }) =>
          queryOperationTasks(consulta.config, {
            ...(consulta.listIds ? { listIds: consulta.listIds } : {}),
            assigneeIds: [member!.id],
          }),
        ),
      );
      const tasks = semDuplicatas(resultados.flatMap((r) => r.tasks));
      const truncated = resultados.some((r) => r.truncated);
      return {
        tasks: tasks.map((task) => wireOperationTask(task, clientByListId)),
        truncated,
        ...(clientesIndisponiveis.length > 0 ? { unavailable_clients: clientesIndisponiveis } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, userId: request.authUser?.id }, 'Falha ao buscar tarefas do usuário no ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  // Comentários da tarefa lidos do ClickUp na hora (o "chat" da tarefa).
  // Mesmo acesso da listagem de tarefas (apps/api/src/clients/routes.ts):
  // OAuth pessoal com fallback pra chave compartilhada. Leitura também é
  // escopada (auditoria pré-deploy 14/09/2026): antes desta checagem,
  // qualquer autenticado lia os comentários de qualquer tarefa do workspace
  // só adivinhando o id - mesma proteção do POST de comentário abaixo.
  app.get('/clickup/tasks/:id/comments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);

    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }

    const config = { apiKey: access.token, teamId: access.teamId };

    let listId: string;
    try {
      listId = await getTaskListId(config, params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao localizar a tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }

    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'Task does not belong to any client list known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    try {
      const comments = await getTaskComments(config, params.id);
      return {
        comments: comments.map((comment) => ({
          id: comment.id,
          text: comment.text,
          user_id: comment.userId,
          username: comment.username,
          date: comment.date,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao buscar comentários da tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  // Postar comentário de verdade na tarefa (composer da aba Conversas do
  // workspace do cliente). Antes de escrever, confirma que a tarefa pertence
  // à lista de um cliente cadastrado e que o usuário tem acesso a ele: sem
  // isso, qualquer autenticado escreveria em qualquer tarefa do workspace
  // do ClickUp só adivinhando o id.
  app.post('/clickup/tasks/:id/comments', { preHandler: [requireAuth, requirePermission('clickup', 'write')] }, async (request, reply) => {
    const params = taskParamsSchema.parse(request.params);
    const body = createCommentSchema.parse(request.body);

    const access = await resolveClickUpAccess(request.authUser?.id ?? '');
    if (!access) {
      reply.code(400);
      return { error: 'No ClickUp access available for this user' };
    }

    const config = { apiKey: access.token, teamId: access.teamId };

    let listId: string;
    try {
      listId = await getTaskListId(config, params.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao localizar a tarefa no ClickUp');
      reply.code(502);
      return { error: message };
    }

    const [ownerClient] = await db.select().from(schema.clients).where(eq(schema.clients.clickupListId, listId));
    if (!ownerClient) {
      reply.code(404);
      return { error: 'Task does not belong to any client list known to Desigual OS' };
    }
    if (!request.authUser || !(await hasClientAccess(request.authUser, ownerClient.id))) {
      reply.code(403);
      return { error: 'No access granted to this client workspace' };
    }

    try {
      const comment = await createTaskComment(config, params.id, body.comment_text);
      reply.code(201);
      return { comment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error, taskId: params.id }, 'Falha ao postar comentário na tarefa do ClickUp');
      reply.code(502);
      return { error: message };
    }
  });

  // Assinatura HMAC precisa do corpo EXATO que o ClickUp mandou (confirmado
  // na doc oficial: "stringify sem espaço extra"), não do objeto já
  // reparseado pelo parser padrão do Fastify. O parser de string crua fica
  // encapsulado NUM ESCOPO SÓ DO WEBHOOK: registrado no plugin inteiro, ele
  // quebrava o parse JSON de POST /clickup/tasks e /clickup/tasks/:id/comments
  // (achado real da auditoria de 11/09/2026: criação de task retornava 400
  // "Expected object, received string" em 100% das chamadas).
  await app.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });

    // Única rota pública de verdade do Orchestrator (todo o resto só existe
    // na rede Tailscale): o ClickUp não está na malha, então precisa de um
    // endereço público pra avisar sobre eventos. A assinatura verificada é o
    // que torna isso seguro mesmo exposto (decisão registrada no vault,
    // "webhook público").
    webhook.post('/clickup/webhook', async (request, reply) => {
    const secret = process.env.CLICKUP_WEBHOOK_SECRET;
    if (!secret) {
      reply.code(500);
      return { error: 'CLICKUP_WEBHOOK_SECRET not configured on the Orchestrator' };
    }

    const rawBody = request.body as string;
    const signature = request.headers['x-signature'];
    if (!verifyClickUpSignature(rawBody, typeof signature === 'string' ? signature : undefined, secret)) {
      reply.code(401);
      return { error: 'Invalid signature' };
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      reply.code(400);
      return { error: 'Invalid JSON' };
    }

    // Responde rápido (mesmo padrão do listener real do Jarbas): o
    // processamento de verdade acontece depois, o ClickUp só precisa de um
    // 200 confirmando que recebemos.
    reply.code(200).send({ ok: true });

    const taskChanged = parseTaskChangedEvent(parsedBody);
    if (taskChanged) {
      await handleTaskChanged(taskChanged, parsedBody as Record<string, unknown>);
      return;
    }

    const event = parseTaskCommentPostedEvent(parsedBody);
    if (!event) {
      logger.debug({ body: parsedBody }, 'ClickUp webhook: evento ignorado ou payload não reconhecido');
      return;
    }

    // Menção a agente (@Bento/@Jarbas/@Suzy/@Otto, variação de caixa) dentro do
    // texto plano do comentário. Formato exato de menção (@user) dentro da
    // estrutura interna do ClickUp não é documentado publicamente; isso é o
    // que dá pra confirmar sem inventar, com o texto plano que a doc garante
    // existir (text_content). Ajustar se um teste real mostrar outro formato.
    const mentionedAgent = detectMentionedAgent(event.textContent);
    if (!mentionedAgent) {
      return;
    }

    // Nunca responder à nossa própria resposta (ver BOT_REPLY_MARKER acima).
    if (BOT_REPLY_MARKER.test(event.textContent)) {
      return;
    }

    // Dedup por commentId: o ClickUp reentrega eventos e cada resposta nossa
    // gera um comentário novo (que também dispara o webhook). O NX garante
    // que cada comentário é respondido no máximo uma vez; o id da resposta é
    // registrado logo depois de postar, antes do evento dela chegar.
    // Se o Redis estiver fora, segue sem dedup: o BOT_REPLY_MARKER acima já
    // impede o loop, e o pior caso é resposta duplicada num retry do ClickUp.
    let redis: ReturnType<typeof getRedisConnection> | null = null;
    try {
      redis = getRedisConnection();
      const claimed = await redis.set(mentionDedupKey(event.commentId), '1', 'EX', MENTION_DEDUP_TTL_S, 'NX');
      if (claimed === null) {
        logger.debug({ commentId: event.commentId }, 'Comentário já respondido (ou resposta nossa), ignorando');
        return;
      }
    } catch (error) {
      redis = null;
      logger.warn({ error, commentId: event.commentId }, 'Redis indisponível, respondendo sem dedup de menção');
    }

    logger.info({ taskId: event.taskId, commentId: event.commentId, agent: mentionedAgent }, 'Menção a agente detectada, disparando resposta');

    try {
      const answer =
        mentionedAgent === 'bento'
          ? await respondAsBento({ taskId: event.taskId, commentId: event.commentId })
          : mentionedAgent === 'otto'
            ? await respondAsOtto({ taskId: event.taskId, commentId: event.commentId })
            : await respondAsAgent(mentionedAgent, { taskId: event.taskId, commentId: event.commentId });
      const config = getClickUpConfig();
      if (config && answer) {
        // Regra de ouro de craft: nunca travessão, nem no ClickUp. Os
        // marcadores [FIM_BLOCO]/[AGUARDA_APROVACAO]/[HANDOFF] dos prompts de
        // personalidade viram parágrafo/texto limpo antes de postar.
        const replyId = await replyToComment(config, event.taskId, event.commentId, stripBlockMarkers(stripEmDashes(answer)));
        await redis?.set(mentionDedupKey(replyId), '1', 'EX', MENTION_DEDUP_TTL_S).catch((error: unknown) => {
          logger.warn({ error, replyId }, 'Falha ao registrar resposta no dedup de menção');
        });
        await recordLearning({
          kind: 'clickup.mention_answered',
          agent: mentionedAgent,
          content: `${mentionedAgent} respondeu uma menção na tarefa ${event.taskId} do ClickUp. Pergunta: "${event.textContent.slice(0, 200)}".`,
          metadata: { task_id: event.taskId, comment_id: event.commentId },
        });
      }
    } catch (error) {
      logger.error({ error, taskId: event.taskId, commentId: event.commentId, agent: mentionedAgent }, 'Falha ao responder menção de agente');
    }
    });
  });
}
