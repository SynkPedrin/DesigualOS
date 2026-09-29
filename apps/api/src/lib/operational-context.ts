import { isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildChangeContext,
  escopoOperacional,
  buildOperationalBriefing,
  buildOperationalContext,
  pedeMudanca,
  buildSelectionSnapshot,
  detectSelectionReference,
  formatBriefingForPrompt,
  formatSelectionBlock,
  resolveOperationalScope,
  resolveSelectionReference,
  type EstadoDoTurnoAnterior,
  type OperationalContext,
  type OperationalScope,
  type SelectedTaskRef,
  type SelectionSnapshot,
} from '@desigual-os/context-engine';
import { findMemberByName, getTask, queryOperationTasks } from '@desigual-os/tool-gateway';
import { eventsSince } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';
import type { AuthenticatedUser } from '../auth/middleware';
import { authorizedClientIds } from './access';

const logger = createLogger({ service: 'operational-context' });

/**
 * operational-context.ts — liga a resolução de escopo (context-engine) à consulta real do
 * ClickUp (tool-gateway), e devolve o bloco de dado ao vivo pra injetar no turno.
 *
 * É aqui que "escopo global" ganha significado de autorização: a lista de clientes vem do
 * banco e passa por `authorizedClientIds`, que aplica a MESMA fronteira do
 * `hasClientAccess` numa query só (era uma por cliente, em série, e custava 22s do turno —
 * a medição está em access.ts). Hoje o critério devolve a carteira inteira por decisão
 * registrada do produto (cliente é compartilhado pelo time), mas o filtro é aplicado do
 * mesmo jeito, pra que no dia em que ele voltar a restringir, "a operação inteira" passe a
 * significar "tudo que ESTE usuário pode ver" sem precisar mexer aqui.
 */

function getClickUpConfig(): { apiKey: string; teamId: string } | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Quem está perguntando, para efeito de recorte de carteira.
 *
 * `CLICKUP_INTEGRATION` não é um usuário do app: é a menção @Bento num comentário do ClickUp,
 * onde quem pergunta já é membro do workspace (autenticado pelo próprio ClickUp) e o webhook
 * chega assinado por HMAC. Não existe usuário logado nesse caminho, então o recorte é "o que a
 * integração enxerga" — a carteira inteira, que é exatamente o que o Bento já consultava
 * sozinho antes, só que agora passando pela listagem do Orquestrador.
 *
 * NO DIA em que `hasClientAccess` voltar a restringir de verdade, ESTE caminho precisa ser
 * revisto junto: ele é o único que não passa por um usuário. Está nomeado assim de propósito,
 * pra aparecer num grep por autorização.
 */
export const CLICKUP_INTEGRATION = 'clickup-integration' as const;

type OperationalPrincipal = AuthenticatedUser | typeof CLICKUP_INTEGRATION;

async function listAuthorizedClients(
  principal: OperationalPrincipal,
): Promise<Array<{ id: string; name: string; clickupListId: string | null }>> {
  const rows = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      clickupListId: schema.clients.clickupListId,
    })
    .from(schema.clients)
    // Cliente excluído (soft delete) não faz parte da operação. O `GET /clients` hoje não
    // filtra isso; aqui filtra, senão uma consulta "da operação inteira" ressuscitaria
    // cliente arquivado no meio do briefing.
    .where(isNull(schema.clients.deletedAt));

  /**
   * FIXTURE DE QA FORA DA OPERAÇÃO (29/09/2026).
   *
   * Medido numa resposta real ao usuário: "teste" apareceu com 27 atrasadas e
   * 27 sem responsável DENTRO do panorama da agência, ao lado de Cosentino e
   * D. Carvalho, junto com "Cliente Teste 7" e "QA CAMPOS 1790624559995". Quem
   * lê aquilo para decidir o dia da equipe não tem como saber que são fixture.
   *
   * O trabalho INTERNO da casa (a própria agência, o Citável, os projetos do
   * dono) continua aqui de propósito: são 170 tarefas que alguém precisa
   * fazer, e escondê-las trocaria um erro por outro pior. Quem separa carteira
   * de casa na APRESENTAÇÃO é o build-operational-context; aqui só o dado de
   * teste sai, porque ele não é trabalho de ninguém.
   */
  const semFixture = escopoOperacional(rows);

  if (principal === CLICKUP_INTEGRATION) return semFixture;

  // Uma query, não uma por cliente: o for em série custava 22s do turno (ver
  // authorizedClientIds em access.ts, com a medição).
  const permitidos = await authorizedClientIds(principal, semFixture.map((r) => r.id));
  return semFixture.filter((row) => permitidos.has(row.id));
}

export interface OperationalTurn {
  scope: OperationalScope;
  context: OperationalContext;
  /**
   * Preenchido quando a pergunta é sobre MUDANÇA ("o que mudou desde ontem?").
   *
   * Sai do event store próprio (`operational_events`), que guardava 633
   * acontecimentos e não tinha um único leitor — `eventsSince()` existia desde
   * sempre com ZERO chamadores. É a resposta que uma IA externa ligada ao
   * ClickUp não consegue dar: ela vê o estado de agora, não a trajetória.
   */
  changeBlock: string | null;
  /** Preenchido quando o usuário pediu BRIEFING: substitui a lista crua de tarefas por um
   * briefing estruturado (prioridades, riscos, lacunas), com procedência por campo. */
  briefingBlock: string | null;
  /**
   * O CONJUNTO SELECIONADO desta conversa (ver context-engine/selection.ts):
   * as tasks que o turno listou — ou a seleção anterior reconsultada quando o
   * turno é um follow-up referencial ("delas", "a segunda"). A rota persiste
   * isto na metadata da mensagem; é o que impede o fallback global de 1209
   * tasks no turno seguinte.
   */
  selection: SelectionSnapshot | null;
}

/** Rótulo de prioridade do ClickUp (número) pro rótulo em texto do snapshot. */
const PRIORIDADE_LABEL: Record<number, string> = { 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };

/**
 * Reconsulta as tasks do snapshot UMA A UMA (lookup endereçado, nunca varredura
 * global). Task que não relê (rede, deletada) mantém o dado do snapshot — o
 * conjunto e a ordem ("a segunda") não podem mudar por instabilidade.
 */
async function refreshSelectionTasks(
  config: { apiKey: string; teamId: string },
  selecao: SelectionSnapshot,
  clientesAutorizados: Array<{ id: string; name: string; clickupListId: string | null }>,
): Promise<SelectedTaskRef[]> {
  const nomePorLista = new Map(
    clientesAutorizados.filter((c) => c.clickupListId).map((c) => [c.clickupListId!, c.name]),
  );
  const resultado: SelectedTaskRef[] = [];
  const CONCORRENCIA = 4;
  for (let i = 0; i < selecao.tasks.length; i += CONCORRENCIA) {
    const lote = selecao.tasks.slice(i, i + CONCORRENCIA);
    const relidas = await Promise.all(
      lote.map(async (t) => {
        try {
          const real = await getTask(config, t.id);
          return {
            ...t,
            title: real.name,
            status: real.status ?? t.status,
            priority: real.priority !== null ? (PRIORIDADE_LABEL[real.priority] ?? t.priority) : t.priority,
            dueDate: real.dueDate ?? t.dueDate,
            assignees: real.assignees.map((a) => a.username).filter((u): u is string => Boolean(u)),
            listId: real.listId ?? t.listId,
            clientName: (real.listId ? nomePorLista.get(real.listId) : null) ?? t.clientName,
            url: t.url ?? `https://app.clickup.com/t/${t.id}`,
          } satisfies SelectedTaskRef;
        } catch {
          return t;
        }
      }),
    );
    resultado.push(...relidas);
  }
  return resultado;
}

/**
 * FOLLOW-UP REFERENCIAL sobre a seleção: resolve contra o snapshot ANTES de
 * qualquer consulta global. É a materialização da prioridade de resolução —
 * conjunto selecionado primeiro, busca ampla só quando o pedido novo pede
 * outra coisa (outro cliente é checado pelo chamador antes de chegar aqui).
 */
async function resolveSelectionTurn(params: {
  message: string;
  selecao: SelectionSnapshot;
  config: { apiKey: string; teamId: string } | null;
  clientesAutorizados: Array<{ id: string; name: string; clickupListId: string | null }>;
  now: Date;
}): Promise<{ context: OperationalContext; selection: SelectionSnapshot } | null> {
  const ref = detectSelectionReference(params.message);
  if (!ref) return null;

  const tasks = params.config
    ? await refreshSelectionTasks(params.config, params.selecao, params.clientesAutorizados).catch(() => params.selecao.tasks)
    : params.selecao.tasks;
  const atualizada: SelectionSnapshot = { ...params.selecao, tasks, capturedAt: params.now.toISOString() };

  const resolvida = resolveSelectionReference(atualizada, ref);
  if (!resolvida) {
    // Referência que não se sustenta: ordinal além do fim da lista, "dela" sem
    // foco. A resposta honesta é dizer o tamanho do conjunto, nunca varrer a
    // carteira atrás de algo que "combine".
    const block = [
      `A seleção atual desta conversa tem ${atualizada.tasks.length} tasks (${atualizada.reasonLabel}).`,
      'A referência não aponta pra nenhuma delas — me diga o número ou o nome da task dentro dessa lista.',
    ].join('\n');
    return {
      // `openTasks` vazio de propósito: este caminho responde pela SELEÇÃO da
      // conversa, e nenhum briefing nasce dele — ver `briefingBlock: null` abaixo.
      context: { block, listedTasks: [], openTasks: [], summary: null, failure: null },
      selection: atualizada,
    };
  }

  const focusTaskId = resolvida.newFocusTaskId ?? atualizada.focusTaskId;
  const selection: SelectionSnapshot = { ...atualizada, focusTaskId };
  const sufixo = params.config
    ? ''
    : '\n(Sem acesso ao ClickUp neste turno: estes dados são o registro da conversa, não uma reconsulta. Diga isso se for afirmar estado atual.)';
  return {
    context: {
      block: formatSelectionBlock({ snapshot: selection, focusTaskId, now: params.now }) + sufixo,
      listedTasks: [],
      openTasks: [],
      summary: null,
      failure: null,
    },
    selection,
  };
}

/**
 * Resolve o escopo da mensagem e, quando fizer sentido, busca o dado ao vivo.
 * NUNCA lança: qualquer falha vira `context.failure`, que o chamador injeta no prompt como
 * instrução explícita de admitir a falha em vez de inventar número.
 */
export async function resolveOperationalTurn(
  message: string,
  principal: OperationalPrincipal,
  now: Date = new Date(),
  /**
   * Estado do turno anterior DESTA conversa. Sem ele, "se eu só conseguir
   * resolver três coisas?" não tem uma palavra operacional e a consulta nunca
   * acontece — o agente responde "os dados não estão disponíveis" logo depois
   * de ter mostrado a operação inteira.
   */
  anterior?: EstadoDoTurnoAnterior | null,
  /**
   * A SELEÇÃO anterior desta conversa (as tasks que foram listadas). Quando a
   * mensagem é um follow-up referencial ("delas", "a segunda", "lança elas
   * pro Pedro"), a resolução é contra ESTE conjunto — nunca contra a carteira
   * inteira. Prioridade declarada: execução anterior, seleção, contexto
   * estruturado, lookup endereçado, esclarecimento; busca global só quando o
   * pedido novo realmente pede (outro cliente, outra janela).
   */
  selecao?: SelectionSnapshot | null,
): Promise<OperationalTurn> {
  const scope = await resolveOperationalScope(message, now, anterior ?? null);

  /**
   * SELEÇÃO ANTES DE GLOBAL. O follow-up referencial ("crie um briefing de
   * cada uma delas") resolvia GLOBAL sem filtro temporal por causa do marcador
   * "briefing" — 1209 tasks no lugar das 10 listadas (medido ao vivo em
   * 24/09/2026). A referência explícita ao conjunto ganha do escopo inferido,
   * mas NUNCA de uma entidade nova nomeada pelo usuário: cliente citado ou
   * janela temporal nova ("e amanhã?") são pedido novo, não follow-up.
   */
  if (
    selecao &&
    selecao.tasks.length > 0 &&
    !scope.temporal &&
    scope.clients.length === 0 &&
    scope.ambiguous.length === 0
  ) {
    const selecaoTurn = await resolveSelectionTurn({
      message,
      selecao,
      config: getClickUpConfig(),
      clientesAutorizados: await listAuthorizedClients(principal).catch(() => []),
      now,
    }).catch(() => null);
    if (selecaoTurn) {
      logger.info(
        { scope: scope.kind, signals: scope.signals, selection: selecaoTurn.selection.reason, tasks: selecaoTurn.selection.tasks.length, focus: selecaoTurn.selection.focusTaskId },
        'Follow-up resolvido contra a seleção da conversa (sem consulta global)',
      );
      return { scope, context: selecaoTurn.context, briefingBlock: null, changeBlock: null, selection: selecaoTurn.selection };
    }
  }

  if (!scope.operational || scope.kind === 'NONE' || scope.kind === 'AMBIGUOUS') {
    return { scope, context: { block: null, listedTasks: [], openTasks: [], summary: null, failure: null }, briefingBlock: null, changeBlock: null, selection: null };
  }

  const config = getClickUpConfig();
  if (!config) {
    return {
      scope,
      context: { block: null, listedTasks: [], openTasks: [], summary: null, failure: 'ClickUp não está configurado neste ambiente' },
      briefingBlock: null,
      changeBlock: null,
      selection: null,
    };
  }

  // Uma consulta, dois usos: o bloco de dado ao vivo e o briefing. O conjunto
  // que o briefing recebe sai de `context.openTasks` (ver nota abaixo), não
  // daqui — o que precisa atravessar o callback é só o sinal de truncamento.
  let truncado = false;
  const clientesAutorizados = await listAuthorizedClients(principal).catch(() => []);

  // Escopo PERSON (14/09/2026): resolve o nome falado pro membro REAL do
  // ClickUp antes de consultar. Sem membro resolvido, a resposta honesta é
  // "não achei essa pessoa", nunca "de qual cliente?".
  if (scope.kind === 'PERSON' && scope.person) {
    /**
     * Tenta os candidatos do mais específico pro mais curto. É o que faz
     * "Mesmo Silva" continuar sendo Mesmo Silva (o registro confirma o nome
     * inteiro) e "Esther mesmo" virar Esther (o registro não conhece ninguém
     * com aquele sobrenome, e aí a leitura de partícula é a certa).
     *
     * O registro decide. Aqui não se adivinha por lista de palavras.
     */
    const candidatos = scope.person.candidatos?.length ? scope.person.candidatos : [scope.person.name];
    let member: Awaited<ReturnType<typeof findMemberByName>> = null;
    for (const candidato of candidatos) {
      member = await findMemberByName(config, candidato).catch(() => null);
      if (member) {
        scope.person.name = candidato;
        break;
      }
    }
    if (!member) {
      return {
        scope,
        context: {
          block: null,
          listedTasks: [],
          openTasks: [],
          summary: null,
          failure: `não encontrei ninguém chamado "${scope.person.name}" entre os membros do ClickUp`,
        },
        briefingBlock: null,
        changeBlock: null,
        selection: null,
      };
    }
    scope.person.memberIds = [member.id];
    scope.person.resolvedAs = member.username;
  }

  const context = await buildOperationalContext(
    scope,
    {
      listAuthorizedClients: async () => clientesAutorizados,
      queryTasks: async (query) => {
        const result = await queryOperationTasks(config, query);
        truncado = result.truncated;
        return { tasks: result.tasks, truncated: result.truncated };
      },
    },
    now,
  );

  // BRIEFING (§52): quando o pedido é de briefing, a lista crua de tarefas não serve —
  // o agente precisa de prioridades, riscos e, principalmente, das LACUNAS marcadas como
  // lacuna, pra não preencher campo vazio com invenção.
  let briefingBlock: string | null = null;
  if (scope.briefing && !context.failure) {
    const nomePorLista = new Map(
      clientesAutorizados.filter((c) => c.clickupListId).map((c) => [c.clickupListId!, c.name]),
    );
    /**
     * AS ABERTAS, NUNCA A LISTA CRUA (29/09/2026).
     *
     * `tarefasBuscadas` é o que o ClickUp devolveu, e ele devolve tarefa com
     * status do tipo `done` mesmo com include_closed=false. O bloco de dado ao
     * vivo filtra isso desde 24/09 e declara a contagem; o briefing, montado no
     * MESMO turno e a partir da MESMA consulta, continuava lendo o cru.
     *
     * Os dois discordavam por 3x: o bloco dizia "411 tarefa(s) aberta(s) ...
     * (811 já concluídas ficaram FORA desta lista — não as apresente como
     * pendentes)" e o briefing dizia "1222 tarefa(s)". Quem vence é o briefing
     * (ver a linha `briefingBlock ?? ...` em chat/routes.ts), então o número
     * errado era o que ia ao modelo — e ele obedeceu: medido ao vivo, o Bento
     * respondeu "sobrecarregado com 1222 tarefas ativas" num briefing executivo.
     *
     * O conjunto filtrado agora vem do próprio builder (`context.openTasks`),
     * e não de um segundo filtro aqui: um filtro duplicado volta a divergir na
     * primeira vez que a regra de "encerrada" mudar de um lado só.
     */
    const briefing = buildOperationalBriefing({
      clientName: scope.kind === 'CLIENT' ? (scope.clients[0]?.name ?? null) : null,
      tasks: context.openTasks,
      clientNameByListId: nomePorLista,
      temporalLabel: scope.temporal?.label ?? null,
      truncated: truncado,
      now,
    });
    briefingBlock = formatBriefingForPrompt(briefing);
  }

  /**
   * O snapshot de seleção sai do que FOI EXIBIDO (listedTasks), nunca da
   * consulta crua: "a segunda" é a segunda linha que o usuário leu. Turno de
   * briefing não gera seleção — a lista estruturada do briefing tem ordem
   * própria (prioridades/riscos), não a ordem da listagem.
   */
  const selection =
    !briefingBlock && !context.failure && context.listedTasks.length > 0
      ? buildSelectionSnapshot({
          tasks: context.listedTasks.map((t) => ({
            id: t.id,
            title: t.name,
            clientName: t.clientName,
            listId: t.listId,
            assignees: t.assignees,
            dueDate: t.dueDate,
            status: t.status,
            priority: t.priority,
            url: t.url,
          })),
          scope,
          now,
        })
      : null;

  /**
   * O QUE MUDOU — do event store próprio, não do estado atual.
   *
   * Só quando a pergunta é sobre mudança (`pedeMudanca`): o bloco é caro de
   * ler e ruim de mandar sempre, porque "o que mudou" e "o que está aberto"
   * são perguntas diferentes e misturá-las faz o modelo responder uma pela
   * outra — que é exatamente o defeito medido (a resposta a "o que mudou nos
   * últimos 7 dias?" era a lista do que VENCE na janela).
   *
   * A janela vem do próprio pedido quando ele traz uma; sem isso, 7 dias.
   * Falha aqui nunca derruba o turno: perde-se o bloco de mudança, não a
   * resposta — e perder em silêncio seria repetir o defeito que esta auditoria
   * encontrou, então a falha é logada.
   */
  let changeBlock: string | null = null;
  if (pedeMudanca(message)) {
    const desde = scope.temporal?.from ? new Date(scope.temporal.from) : new Date(now.getTime() - 7 * 86_400_000);
    try {
      const eventos = await eventsSince(desde, scope.kind === 'CLIENT' ? (scope.clients[0]?.id ?? null) : null);
      const mudanca = buildChangeContext({
        eventos: eventos.map((e) => ({
          type: e.type,
          entityId: e.entityId,
          clientId: e.clientId,
          actor: e.actor,
          occurredAt: e.occurredAt,
        })),
        tasks: context.openTasks,
        clientNameById: new Map(clientesAutorizados.map((c) => [c.id, c.name])),
        now,
        janelaLabel: scope.temporal?.label.replace('-', ' ') ?? 'últimos 7 dias',
      });
      changeBlock = mudanca.block;
      logger.info(
        { eventos: mudanca.totalEventos, criadas: mudanca.criadas, atualizadas: mudanca.atualizadas, naoResolvidas: mudanca.naoResolvidas },
        'Bloco de mudança montado a partir do event store',
      );
    } catch (error) {
      logger.warn({ err: error }, 'Não consegui ler o event store para montar o bloco de mudança');
    }
  }

  logger.info(
    {
      scope: scope.kind,
      changeBlock: changeBlock ? changeBlock.length : 0,
      signals: scope.signals,
      confidence: scope.confidence,
      clients: scope.clients.map((c) => c.name),
      temporal: scope.temporal?.label ?? null,
      tasks: context.summary?.total ?? null,
      clientsConsidered: context.summary?.clientsConsidered ?? null,
      truncated: context.summary?.truncated ?? null,
      failure: context.failure,
      selection: selection ? `${selection.reason} (${selection.tasks.length})` : null,
    },
    'Escopo operacional resolvido',
  );

  return { scope, context, briefingBlock, changeBlock, selection };
}

/**
 * Texto que entra no prompt. Falha de ferramenta virou instrução explícita: sem isso, o
 * comportamento observado era o agente responder com número plausível quando a integração
 * caía (ver relato de "recebi seu briefing da CA1" respondendo sobre outro cliente).
 */
export function formatOperationalContextForPrompt(context: OperationalContext): string | null {
  if (context.failure) {
    return [
      'FALHA DE FERRAMENTA (obrigatório reconhecer):',
      `Não foi possível consultar o ClickUp agora: ${context.failure}.`,
      'Diga isso de forma curta e direta. NUNCA invente quantidade de tarefa, prazo, cliente ou métrica.',
      'Se souber algo do contexto que não dependa dessa consulta, pode usar — mas separando o que é dado atual do que não é.',
    ].join('\n');
  }
  return context.block;
}
