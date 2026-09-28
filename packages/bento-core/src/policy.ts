import type { ConversationResourceState, StructuredAction } from './types.js';
import { evaluateCardinality, type CardinalityRecord } from './types.js';

/**
 * §5 da missão: "The model proposes. Code validates. Policy DOES NOT parse
 * natural Portuguese. It validates the structured action." Tudo aqui é
 * determinístico — nenhuma chamada de LLM. A ÚNICA exceção deliberada a
 * "não parseia português" é a guarda anti UPDATE→CREATE (C.2), que usa
 * regexes documentadas sobre a mensagem original APENAS para BLOQUEAR e
 * pedir esclarecimento — nunca para decidir executar algo.
 */
export interface PolicyContext {
  actorHasClickUpWrite: boolean;
  agentHasClickUpWrite: boolean;
  mutationsThisExecution: number;
  maxMutationsPerExecution: number;
  /** true quando o usuário confirmou explicitamente um plano com cardinalidade > 1 num turno anterior. */
  explicitMultiActionConfirmed: boolean;
  /**
   * Mensagem original do usuário. Necessária pra guarda anti UPDATE→CREATE
   * (C.2/F-02/F-05). Opcional pra não quebrar callers antigos — sem ela a
   * guarda fica DESLIGADA (degrada pra não bloquear, nunca pra bloquear
   * creates legítimos às cegas).
   */
  message?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  cardinality: CardinalityRecord;
  /** resourceId resolvido (do estado da conversa) quando target.resourceId veio null do planner. */
  resolvedResourceId: string | null;
  /**
   * C.2/F-05: true quando um create_task tem título normalizado idêntico a
   * um recurso em recentCreatedResources da mesma conversa. A policy só
   * SINALIZA — quem decide reconcile/bloqueio é o executor.
   */
  possibleDuplicate: boolean;
}

const WRITE_INTENTS = new Set<StructuredAction['intent']>(['create_task', 'update_task', 'comment_task']);

/**
 * §3: prioridade de resolução — id explícito primeiro, nunca busca global.
 * Retorna null quando nada no estado resolve a referência (o call site deve
 * pedir esclarecimento, não seguir pra um lookup global).
 */
export function resolveTargetResourceId(action: StructuredAction, state: ConversationResourceState): string | null {
  if (action.target?.resourceId) return action.target.resourceId;
  if (!action.target) return null;
  if (state.focusedResource) return state.focusedResource.resourceId;
  if (state.selectedResources.length === 1) return state.selectedResources[0]!.resourceId;
  if (state.lastExecution && state.lastExecution.resourceIds.length === 1) return state.lastExecution.resourceIds[0]!;
  return null;
}

/* ------------------------------------------------------------------ */
/* C.2 — invariante anti UPDATE→CREATE (camada policy; F-02/F-05)      */
/* ------------------------------------------------------------------ */

/**
 * Verbos de edição em PT-BR. Só usados para BLOQUEAR um create suspeito —
 * um falso positivo aqui vira pedido de esclarecimento, nunca uma mutação
 * errada, então a lista prefere pecar por ampla.
 */
const UPDATE_VERB_RE = /\b(atualiz\w*|corrige|corrigir|corrija|ajust\w*|troc\w*|mud\w*|edit\w*|alter\w*|adicion\w*|acrescent\w*|coloc\w*|inclu\w*|tir\w*|remov\w*|bota\w*|botar|põe|ponha)\b/i;

/** Referentes a recurso existente ("nessa", "dela", "isso"...). */
const REFERENT_RE = /\b(essa?|isso|ist[oa]|aquela?|aquilo|nel[ae]s?|dess[ae]s?|daquel[ae]s?|dela|dele|disso|daquilo)\b/i;

/** Sinal explícito de criação nova ("cria", "nova", "novo"). */
const CREATE_SIGNAL_RE = /\b(cria\b|criar|crie|criem|nov[ao]s?\b)/i;

/**
 * Guarda central pura do invariante UPDATE≠CREATE: se a ação proposta é
 * create_task mas a mensagem carrega sinal de update sobre recurso existente
 * (verbo de edição + referente) OU há foco no estado sem sinal explícito de
 * criação nova → bloquear e pedir esclarecimento. NUNCA executa o create.
 *
 * Esta é a camada POLICY do invariante; a camada de executor (reconcile-
 * first / bloqueio no write provider) é responsabilidade de outro
 * componente. Sem `ctx.message` a guarda não tem como distinguir e fica
 * desligada (fail-open documentado — callers devem passar a mensagem).
 */
function createBlockedByUpdateSignal(action: StructuredAction, state: ConversationResourceState, message: string | undefined): boolean {
  if (action.intent !== 'create_task' || !message) return false;
  const hasUpdateVerb = UPDATE_VERB_RE.test(message);
  const hasReferent = REFERENT_RE.test(message) || state.focusedResource !== null || state.selectedResources.length > 0;
  if (hasUpdateVerb && hasReferent) return true;
  const hasCreateSignal = CREATE_SIGNAL_RE.test(message);
  return state.focusedResource !== null && !hasCreateSignal;
}

/* ------------------------------------------------------------------ */
/* D.12 — conteúdo material vs placeholder (F-18)                      */
/* ------------------------------------------------------------------ */

/**
 * Marcadores de placeholder que o planner costumava gerar (evidência ao
 * vivo T11: comentou literalmente "observação não especificada"). Lista
 * curta e documentada de propósito — conteúdo legítimo do usuário não deve
 * ser confundido com placeholder.
 */
const PLACEHOLDER_RE = /n[ãa]o\s+especificad[ao]s?/i;

/**
 * "Conteúdo material" (definição determinística, D.12): uma string presente,
 * com pelo menos 2 caracteres úteis e que não seja um placeholder conhecido.
 * A REGRA DE OURO fica no planner (nunca gerar placeholder); aqui é a rede
 * de segurança: comment_task/update_task sem conteúdo material vira
 * esclarecimento, NUNCA escrita vazia ou placeholder.
 */
function hasMaterialContent(text: string | undefined | null): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  return !PLACEHOLDER_RE.test(trimmed);
}

function updateTaskHasMaterialChange(changes: StructuredAction['changes']): boolean {
  if (!changes) return false;
  return (
    hasMaterialContent(changes.title) ||
    hasMaterialContent(changes.description) ||
    hasMaterialContent(changes.comment) ||
    Boolean(changes.dueDate?.trim()) ||
    Boolean(changes.assignee?.trim()) ||
    // "fecha essa task" não traz título, prazo nem responsável — sem contar
    // status como mudança material, a policy respondia `content_missing` e a
    // conclusão nunca acontecia (destravado em 28/09/2026).
    Boolean(changes.status?.trim()) ||
    /**
     * E O MESMO VALE PRA TODO CAMPO NOVO. Medido com a Tammy no mesmo dia:
     * "altere o status dessa task para urgente" virou prioridade (correto),
     * e aí a policy disse "não identifiquei o que devo alterar" — porque
     * `priority` não estava nesta lista. É a MESMA falha que o status tinha,
     * repetida por um campo novo ter nascido sem entrar aqui.
     *
     * Esta função é a lista de "o que conta como pedido de mudança". Campo
     * que o plano carrega e não aparece aqui é campo que o Bento aceita e
     * depois finge não ter entendido.
     */
    Boolean(changes.priority?.trim()) ||
    Boolean(changes.startDate?.trim()) ||
    Boolean(changes.timeEstimate?.trim()) ||
    Boolean(changes.addTags?.length) ||
    Boolean(changes.removeTags?.length) ||
    Boolean(changes.customFields && Object.keys(changes.customFields).length > 0) ||
    Boolean(changes.checklistItems?.length) ||
    Boolean(changes.dependsOnTaskId?.trim()) ||
    Boolean(changes.dependencyOfTaskId?.trim())
  );
}

/** C.2/F-05: normalização determinística pra comparar títulos (dedup de create). */
function normalizeTitle(title: string): string {
  return title.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isPossibleDuplicateCreate(action: StructuredAction, state: ConversationResourceState): boolean {
  if (action.intent !== 'create_task') return false;
  const title = action.changes?.title;
  if (!title || !hasMaterialContent(title)) return false;
  const normalized = normalizeTitle(title);
  return state.recentCreatedResources.some((r) => r.title !== null && normalizeTitle(r.title) === normalized);
}

export function validateBentoAction(action: StructuredAction, state: ConversationResourceState, ctx: PolicyContext): PolicyDecision {
  const isWrite = WRITE_INTENTS.has(action.intent);
  const resolvedResourceId = isWrite || action.intent === 'get_task' ? resolveTargetResourceId(action, state) : null;
  const possibleDuplicate = isPossibleDuplicateCreate(action, state);

  // §4: cardinalidade. Leitura/análise não muta nada — plannedCardinality é sempre 0 pra esses intents.
  const plannedCardinality = action.intent === 'create_task' ? 1 : 0;
  const cardinality = evaluateCardinality(action.requestedCardinality, plannedCardinality);

  if (!isWrite) {
    return { allowed: true, reason: 'leitura/análise não muta nada', cardinality, resolvedResourceId, possibleDuplicate };
  }

  if (cardinality.blocked && !ctx.explicitMultiActionConfirmed) {
    return { allowed: false, reason: cardinality.blockReason ?? 'cardinalidade bloqueada', cardinality, resolvedResourceId, possibleDuplicate };
  }

  // C.2: invariante anti UPDATE→CREATE — antes de qualquer execução, um
  // create que cheira a update vira esclarecimento (nunca create).
  if (createBlockedByUpdateSignal(action, state, ctx.message)) {
    return {
      allowed: false,
      reason:
        'create_blocked_update_signal: a mensagem parece editar um recurso que já existe, não criar um novo — esclarecer com o usuário antes de criar qualquer coisa (camada policy do invariante UPDATE≠CREATE)',
      cardinality,
      resolvedResourceId,
      possibleDuplicate,
    };
  }

  if (!ctx.agentHasClickUpWrite || !ctx.actorHasClickUpWrite) {
    return { allowed: false, reason: 'permission_denied: clickup:write ausente (ator ou agente)', cardinality, resolvedResourceId, possibleDuplicate };
  }

  if ((action.intent === 'update_task' || action.intent === 'comment_task') && !resolvedResourceId) {
    return {
      allowed: false,
      reason: 'target_unresolved: a referência ("essa"/"ela"/...) não resolveu contra o estado da conversa — pedir esclarecimento, nunca busca global',
      cardinality,
      resolvedResourceId,
      possibleDuplicate,
    };
  }

  // D.11/F-17: operação sobre responsável sem pessoa identificada ("tira
  // ele dela" sem dizer quem) → esclarecimento, nunca noop silencioso.
  // NOTA de produto: "remover o ÚLTIMO responsável" não pode ser detectado
  // aqui — a policy é pura e o estado da conversa não carrega a lista de
  // assignees da task. Essa checagem, se um dia virar regra, pertence à
  // camada de executor (que lê a task de verdade).
  if (action.intent === 'update_task' && action.changes?.assigneeOperation && !action.changes.assignee?.trim()) {
    return {
      allowed: false,
      reason: `assignee_unresolved: operação "${action.changes.assigneeOperation}" sobre responsável sem pessoa identificada — pedir esclarecimento (quem?)`,
      cardinality,
      resolvedResourceId,
      possibleDuplicate,
    };
  }

  // D.12/F-18: comment_task/update_task sem conteúdo material identificável
  // → esclarecimento obrigatório, NUNCA placeholder nem escrita vazia.
  if (action.intent === 'comment_task' && !hasMaterialContent(action.changes?.comment)) {
    return {
      allowed: false,
      reason: 'content_missing: o pedido não traz o texto do comentário/observação — pedir o conteúdo ao usuário, nunca escrever placeholder',
      cardinality,
      resolvedResourceId,
      possibleDuplicate,
    };
  }

  if (action.intent === 'update_task' && !updateTaskHasMaterialChange(action.changes)) {
    return {
      allowed: false,
      reason: 'content_missing: nenhum campo concreto pra atualizar foi identificado no pedido — pedir esclarecimento, nunca placeholder',
      cardinality,
      resolvedResourceId,
      possibleDuplicate,
    };
  }

  if (ctx.mutationsThisExecution >= ctx.maxMutationsPerExecution) {
    return { allowed: false, reason: `mutation_budget_exceeded: limite de ${ctx.maxMutationsPerExecution} mutações por execução`, cardinality, resolvedResourceId, possibleDuplicate };
  }

  return { allowed: true, reason: 'ok', cardinality, resolvedResourceId, possibleDuplicate };
}
