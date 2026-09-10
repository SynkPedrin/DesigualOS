import { isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  buildOperationalBriefing,
  buildOperationalContext,
  formatBriefingForPrompt,
  resolveOperationalScope,
  type OperationalContext,
  type OperationalScope,
} from '@desigual-os/context-engine';
import { queryOperationTasks } from '@desigual-os/tool-gateway';
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

async function listAuthorizedClients(
  user: AuthenticatedUser,
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

  const autorizados: Array<{ id: string; name: string; clickupListId: string | null }> = [];
  for (const row of rows) {
    if (await hasClientAccess(user, row.id)) autorizados.push(row);
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
  user: AuthenticatedUser,
  now: Date = new Date(),
): Promise<OperationalTurn> {
  const scope = await resolveOperationalScope(message, now);

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
  const clientesAutorizados = await listAuthorizedClients(user).catch(() => []);

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
