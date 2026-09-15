import type { OperationTask } from '@desigual-os/tool-gateway';

/**
 * agent-actions.ts — representação estruturada das AÇÕES do Bento autônomo.
 *
 * O que isto resolve: até aqui um pedido amplo ("organize minha operação")
 * virava UMA chamada ao node e um texto. O trace tinha os passos do plano, mas
 * `toolCalls` continha só `agent:bento` e nada acontecia na operação — análise
 * bonita, zero execução (medido no release gate, 15/09/2026).
 *
 * A divisão de responsabilidade é a regra da casa:
 *   PROPOSTA  — deriva ação candidata do estado operacional REAL (aqui, puro).
 *   AUTORIZAÇÃO — código decide se pode executar (permissão, escopo, risco).
 *   EXECUÇÃO  — tool-gateway faz a escrita.
 *   VERIFICAÇÃO — read-back confirma; sem read-back não existe "feito".
 *
 * A proposta é DETERMINÍSTICA de propósito. Ação que muda a operação de uma
 * agência não pode nascer de texto livre de modelo: aqui ela nasce de um fato
 * observável na task (venceu e está aberta; está sem responsável), e o motivo
 * viaja junto pra aparecer no relatório final.
 */

export type AgentActionType =
  | 'add_comment'
  | 'assign_task'
  | 'update_due_date'
  | 'update_status'
  | 'create_task'
  | 'request_approval'
  | 'no_action';

export type ActionRisk = 'low' | 'medium' | 'high';

export type ActionStatus = 'proposed' | 'authorized' | 'blocked' | 'executed' | 'failed' | 'deferred';

export interface AgentAction {
  id: string;
  type: AgentActionType;
  /** O que esta ação resolve, em uma linha (entra no relatório final). */
  objective: string;
  /** Fato observado que justifica a ação. NUNCA inferência sem base. */
  reason: string;
  tool: string | null;
  arguments: Record<string, unknown>;
  risk: ActionRisk;
  /** true = decisão humana; o runtime NÃO executa, devolve pra pessoa. */
  requiresApproval: boolean;
  status: ActionStatus;
  taskId: string | null;
  taskName: string | null;
  /** Preenchido na execução. */
  observation?: string;
  verified?: boolean;
}

function concluida(t: OperationTask): boolean {
  return t.statusType === 'done' || t.statusType === 'closed';
}

/** Marca que o Bento já comentou o atraso — evita comentar o mesmo todo dia. */
export const MARCADOR_ATRASO = '[bento:atraso]';

export interface ProposeOptions {
  /** Início do dia de hoje (epoch ms) — vence ANTES disso é atraso. */
  startOfToday: number;
  /** Tasks que já têm comentário de atraso do Bento (para não repetir). */
  jaComentadas?: Set<string>;
}

/**
 * Deriva as ações candidatas do estado operacional real.
 *
 * Duas regras, as duas ancoradas em fato observável:
 *   1. aberta e venceu antes de hoje  -> comentar o atraso (risco baixo, não
 *      destrutivo, reversível, e é o registro que destrava a conversa);
 *   2. aberta e sem responsável       -> NÃO adivinha dono: vira decisão
 *      humana (requiresApproval), que é o que o pedido pede pra devolver.
 *
 * Tudo o mais é `no_action`: silêncio é resposta legítima e é o que impede a
 * "organização automática" de virar ruído na operação de quem trabalha.
 */
export function proposeActions(tasks: OperationTask[], opts: ProposeOptions): AgentAction[] {
  const acoes: AgentAction[] = [];
  const jaComentadas = opts.jaComentadas ?? new Set<string>();
  let seq = 0;
  const proximoId = (): string => {
    seq += 1;
    return `act-${seq}`;
  };

  for (const t of tasks) {
    if (concluida(t)) continue;

    if (t.dueDate !== null && t.dueDate < opts.startOfToday && !jaComentadas.has(t.id)) {
      const dias = Math.max(1, Math.floor((opts.startOfToday - t.dueDate) / 86_400_000));
      acoes.push({
        id: proximoId(),
        type: 'add_comment',
        objective: `Registrar o atraso na task "${t.name}"`,
        reason: `venceu há ${dias} dia(s) e continua aberta (status: ${t.status ?? 'sem status'})`,
        tool: 'clickup.create_comment',
        arguments: {
          taskId: t.id,
          text: `${MARCADOR_ATRASO} Esta task venceu há ${dias} dia(s) e continua em "${t.status ?? 'sem status'}". Repactuar o prazo ou concluir hoje; se estiver bloqueada, registrar aqui o que falta.`,
        },
        risk: 'low',
        requiresApproval: false,
        status: 'proposed',
        taskId: t.id,
        taskName: t.name,
      });
    }

    if (t.assignees.length === 0) {
      acoes.push({
        id: proximoId(),
        type: 'request_approval',
        objective: `Definir responsável para "${t.name}"`,
        reason: 'está aberta e sem responsável definido; não há dado que indique o dono correto',
        tool: null,
        arguments: { taskId: t.id },
        risk: 'medium',
        requiresApproval: true,
        status: 'proposed',
        taskId: t.id,
        taskName: t.name,
      });
    }
  }

  if (acoes.length === 0) {
    acoes.push({
      id: proximoId(),
      type: 'no_action',
      objective: 'Nada a resolver automaticamente',
      reason: 'nenhuma task aberta com atraso ou sem responsável no escopo consultado',
      tool: null,
      arguments: {},
      risk: 'low',
      requiresApproval: false,
      status: 'proposed',
      taskId: null,
      taskName: null,
    });
  }

  return acoes;
}

export interface AuthorizationPolicy {
  /** Lista única onde a escrita é permitida (write-scope). null = sem cerca. */
  writeScopeListId: string | null;
  /** Lista de cada task candidata, pra conferir o escopo ANTES de tentar. */
  listIdPorTask: Map<string, string | null>;
  /** Risco máximo executável sem humano. */
  riscoMaximo?: ActionRisk;
}

const ORDEM_RISCO: Record<ActionRisk, number> = { low: 0, medium: 1, high: 2 };

export interface AuthorizationResult {
  authorized: boolean;
  reason: string;
}

/**
 * CÓDIGO AUTORIZA. A proposta nunca executa sozinha: passa por permissão de
 * escopo (write-scope), risco e necessidade de aprovação humana.
 */
export function authorizeAction(action: AgentAction, policy: AuthorizationPolicy): AuthorizationResult {
  if (action.type === 'no_action') return { authorized: false, reason: 'nada a executar' };
  if (action.requiresApproval) return { authorized: false, reason: 'depende de decisão humana' };
  if (!action.tool) return { authorized: false, reason: 'ação sem ferramenta associada' };

  const teto = policy.riscoMaximo ?? 'low';
  if (ORDEM_RISCO[action.risk] > ORDEM_RISCO[teto]) {
    return { authorized: false, reason: `risco ${action.risk} acima do teto automático (${teto})` };
  }

  if (policy.writeScopeListId) {
    const lista = action.taskId ? policy.listIdPorTask.get(action.taskId) : null;
    if (!lista) {
      return { authorized: false, reason: 'não sei em que lista esta task está; escrita bloqueada por segurança' };
    }
    if (lista !== policy.writeScopeListId) {
      return { authorized: false, reason: `task fora do escopo de teste (lista ${lista})` };
    }
  }

  return { authorized: true, reason: 'dentro do escopo, risco baixo, sem necessidade de aprovação' };
}

/** Relatório final: o que foi resolvido e o que sobrou pra pessoa decidir. */
export function resumoDeAcoes(acoes: AgentAction[]): {
  executadas: AgentAction[];
  humanas: AgentAction[];
  bloqueadas: AgentAction[];
  falhas: AgentAction[];
} {
  return {
    executadas: acoes.filter((a) => a.status === 'executed'),
    humanas: acoes.filter((a) => a.requiresApproval && a.type !== 'no_action'),
    bloqueadas: acoes.filter((a) => a.status === 'blocked'),
    falhas: acoes.filter((a) => a.status === 'failed'),
  };
}
