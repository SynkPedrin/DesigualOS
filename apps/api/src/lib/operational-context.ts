import { isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildOperationalBriefing,
  buildOperationalContext,
  formatBriefingForPrompt,
  resolveOperationalScope,
  type EstadoDoTurnoAnterior,
  type OperationalContext,
  type OperationalScope,
} from '@desigual-os/context-engine';
import { findMemberByName, queryOperationTasks } from '@desigual-os/tool-gateway';
import { createLogger } from '@desigual-os/logging';
import type { AuthenticatedUser } from '../auth/middleware';
import { hasClientAccess } from './access';

const logger = createLogger({ service: 'operational-context' });

/**
 * operational-context.ts — liga a resolução de escopo (context-engine) à consulta real do
 * ClickUp (tool-gateway), e devolve o bloco de dado ao vivo pra injetar no turno.
 *
 * É aqui que "escopo global" ganha significado de autorização: a lista de clientes vem do
 * banco e passa por `hasClientAccess` cliente por cliente. Hoje aquela função devolve
 * `true` pra todo mundo por decisão registrada do produto (cliente é compartilhado pelo
 * time), então na prática é a carteira inteira — mas o filtro é aplicado do mesmo jeito,
 * pra que no dia em que ela voltar a restringir, "a operação inteira" passe a significar
 * "tudo que ESTE usuário pode ver" sem precisar mexer aqui.
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

  if (principal === CLICKUP_INTEGRATION) return rows;

  const autorizados: Array<{ id: string; name: string; clickupListId: string | null }> = [];
  for (const row of rows) {
    if (await hasClientAccess(principal, row.id)) autorizados.push(row);
  }
  return autorizados;
}

export interface OperationalTurn {
  scope: OperationalScope;
  context: OperationalContext;
  /** Preenchido quando o usuário pediu BRIEFING: substitui a lista crua de tarefas por um
   * briefing estruturado (prioridades, riscos, lacunas), com procedência por campo. */
  briefingBlock: string | null;
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
): Promise<OperationalTurn> {
  const scope = await resolveOperationalScope(message, now, anterior ?? null);

  if (!scope.operational || scope.kind === 'NONE' || scope.kind === 'AMBIGUOUS') {
    return { scope, context: { block: null, summary: null, failure: null }, briefingBlock: null };
  }

  const config = getClickUpConfig();
  if (!config) {
    return {
      scope,
      context: { block: null, summary: null, failure: 'ClickUp não está configurado neste ambiente' },
      briefingBlock: null,
    };
  }

  // As tarefas buscadas são reaproveitadas pelo briefing (uma consulta, dois usos).
  let tarefasBuscadas: Awaited<ReturnType<typeof queryOperationTasks>>['tasks'] = [];
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
          summary: null,
          failure: `não encontrei ninguém chamado "${scope.person.name}" entre os membros do ClickUp`,
        },
        briefingBlock: null,
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
        tarefasBuscadas = result.tasks;
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
    const briefing = buildOperationalBriefing({
      clientName: scope.kind === 'CLIENT' ? (scope.clients[0]?.name ?? null) : null,
      tasks: tarefasBuscadas,
      clientNameByListId: nomePorLista,
      temporalLabel: scope.temporal?.label ?? null,
      truncated: truncado,
      now,
    });
    briefingBlock = formatBriefingForPrompt(briefing);
  }

  logger.info(
    {
      scope: scope.kind,
      signals: scope.signals,
      confidence: scope.confidence,
      clients: scope.clients.map((c) => c.name),
      temporal: scope.temporal?.label ?? null,
      tasks: context.summary?.total ?? null,
      clientsConsidered: context.summary?.clientsConsidered ?? null,
      truncated: context.summary?.truncated ?? null,
      failure: context.failure,
    },
    'Escopo operacional resolvido',
  );

  return { scope, context, briefingBlock };
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
