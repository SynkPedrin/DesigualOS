import { createHash } from 'node:crypto';
import type { Logger } from '@desigual-os/logging';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import { createTaskComment, findMemberByEmail, getTaskComments, normalizeTaskName, replyToComment, type SeniorToolContext } from '@desigual-os/tool-gateway';
import { createVerifiedSeniorTask, MutationBudget } from '@desigual-os/tool-gateway';
import {
  proposeBentoAction,
  validateBentoAction,
  BentoPlannerError,
  type ConversationResourceState,
  type StructuredAction,
  type WriteEnvelope,
} from '@desigual-os/bento-core';
import { ehQaBot, getClickUpConfigOrNull, mapStatusHintToRealStatus, podeEscreverEmProducao } from './bento-action-guard';
import { resolveWriteTarget } from './write-target';
import { executeTaskUpdate } from './bento-update-executor';
import { loadResourceState, persistResourceState, applyExecutionToState } from './bento-resource-state';
import { loadLatestExecutionState, sameExecutionAlreadyDone, type ExecutionRecord } from './execution-record';
import { selectWriteProvider, executeViaMcp, parseDueDateMs, type McpWriteEnvelope } from './bento-mcp-executor';
import { resolveFromLegacySelectionSnapshot } from './bento-legacy-selection-bridge';
import { attachMaterials, buildTaskBriefing, type TaskAttachmentInput } from './bento-task-briefing';
import { corrigirResponsavel } from './bento-self-assignment';
import { desviarStatusQueEhPrioridade, mapPrioridade } from './bento-priority';
import { observacoesDoPedido, observacoesProativas } from './bento-proatividade';
import { parseEstimativa } from './bento-field-values';

/**
 * bento-openai-core.ts — o loop novo pedido em "BENTO CORE CUTOVER":
 *
 *   USER MESSAGE → ConversationResourceState → OpenAI Responses (planner,
 *   sem tools) → structured action → policy determinística → single write
 *   provider (LEGACY_GATEWAY hoje — MCP fica pronto assim que o OAuth for
 *   autorizado, ver clickup-mcp-tool.ts) → executor verificado existente
 *   (createVerifiedSeniorTask / executeTaskUpdate, ambos já com read-back) →
 *   persiste resource state → responde.
 *
 * ADITIVO e ATRÁS DE FLAG (BENTO_OPENAI_CORE_ENABLED, default desligado):
 * com a flag off, `runBentoOpenAiCore` devolve `null` imediatamente e
 * `execute-job.ts` segue pro guard antigo, byte a byte como antes. Ligar a
 * flag é decisão operacional separada de este código existir — ver
 * CLAUDE_RELEASE_HANDOFF.md.
 *
 * Escopo desta primeira versão: create_task e update_task/comment_task
 * (os dois P0 da auditoria). read_tasks/get_task/analyze_tasks devolvem
 * `null` de propósito — o caminho antigo já cobre leitura/análise
 * (execution-record.ts, selection-read.ts, committed nesta mesma missão) e
 * reescrevê-los aqui seria escopo além do blocker pedido.
 */
export function bentoOpenAiCoreEnabled(): boolean {
  return process.env.BENTO_OPENAI_CORE_ENABLED === 'true';
}

function envelopeToExecuteResponse(agent: 'bento', envelope: WriteEnvelope, humanAnswer: string, executionRecord?: ExecutionRecord): ExecuteResponse {
  return {
    execution_id: '',
    agent,
    status: envelope.success ? 'completed' : 'failed',
    answer: humanAnswer,
    sources: envelope.sources,
    tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(envelope.success ? {} : { error: envelope.error ?? 'falha não detalhada' }),
    metadata: {
      guard: 'bento-openai-core',
      write_envelope: envelope as unknown as Record<string, unknown>,
      // D.4/F-04: TODA execução do caminho novo grava o ExecutionRecord no
      // mesmo formato que o dedup (execution-record.ts) já lê — sem isto o
      // dedup ficava morto pras escritas do próprio core (fault-injection 2c).
      ...(executionRecord ? { execucao: executionRecord as unknown as Record<string, unknown> } : {}),
    },
  };
}

/** Razões novas da policy (C.2/D.11/D.12) viram esclarecimentos específicos, não o prefixo genérico. */
function clarificationFor(reason: string, intent: StructuredAction['intent']): string {
  if (reason.startsWith('target_unresolved')) {
    return 'Não identifiquei de qual task você está falando — pode me lembrar qual é (nome ou link)?';
  }
  if (reason.startsWith('create_blocked_update_signal')) {
    return 'Pelo que entendi você quer ALTERAR uma task que já existe, não criar uma nova — e não vou criar nada sem ter certeza. É pra atualizar qual task? Me confirma o nome ou o link.';
  }
  if (reason.startsWith('assignee_unresolved')) {
    return 'De quem você está falando? Me diz o nome da pessoa (ex.: "tira o Matheus dela", "passa pra Sofia").';
  }
  if (reason.startsWith('content_missing')) {
    return intent === 'comment_task'
      ? 'Não recebi o texto do comentário — qual conteúdo devo registrar na task?'
      : 'Não identifiquei o que exatamente devo alterar — me diz o campo e o valor (título, prazo, responsável, briefing...)?';
  }
  return `Não posso executar essa ação agora: ${reason}`;
}

/** Resposta honesta do caminho MCP (F-08/D.5/D.6): nunca success pleno sem verificação, incerteza explícita. */
function mcpHumanAnswer(envelope: McpWriteEnvelope): string {
  if (!envelope.success) {
    if (envelope.error?.startsWith('write_unconfirmed_resource')) {
      return 'A criação foi enviada ao ClickUp, mas não consegui identificar a task criada pra confirmar. Antes de pedir de novo, dá uma olhada na lista — se ela estiver lá, me avisa (não quero criar duplicada).';
    }
    return `Não consegui executar via ClickUp MCP: ${envelope.error}`;
  }
  if (envelope.wasExisting) {
    return `Essa task já existia (https://app.clickup.com/t/${envelope.resourceIds[0]}) — não criei outra.`;
  }
  if (envelope.verified) return 'Feito via ClickUp MCP, confirmado por releitura.';
  if (envelope.readback && !envelope.readback.unavailable && envelope.readback.mismatches.length > 0) {
    return `Executei via ClickUp MCP, mas a releitura encontrou divergências: ${envelope.readback.mismatches.join('; ')}. Confira a task antes de seguir.`;
  }
  return 'Feito via ClickUp MCP (não consegui reler pra confirmar — verifique a task).';
}

/* ------------------------------------------------------------------ */
/* D.3/D.4 — chave estável da operação + ExecutionRecord do caminho novo */
/* ------------------------------------------------------------------ */

/** O guard antigo grava operation 'update'/'create_tasks'; o core grava o intent. O dedup precisa casar os dois dialetos. */
const OPERATION_ALIAS: Record<string, string> = { update: 'update_task', create_tasks: 'create_task' };

function canonicalOperation(operation: string): string {
  return OPERATION_ALIAS[operation] ?? operation;
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Forma canônica de TODOS os campos do pedido, pra chave de idempotência.
 *
 * Medido no ClickUp real em 28/09/2026: a versão anterior listava os campos um
 * a um (título, responsável, prazo, descrição, comentário) e os campos novos
 * — tag, prioridade, estimativa, início, checklist, campo personalizado,
 * dependência — ficaram de fora. Consequência: "marca com a tag X", "estima
 * 2h" e "põe urgente" na MESMA task geravam a MESMA chave, e a idempotência
 * descartava a segunda e a terceira como "já tinha feito isso" sem nunca
 * tocar o ClickUp. Três pedidos diferentes, uma execução.
 *
 * Agora a chave percorre o objeto inteiro: campo que o plano passar a carregar
 * entra sozinho. Nome de pessoa e título entram normalizados (pra "Matheus
 * Sain" e "matheus sain" contarem como o mesmo pedido); o resto entra em forma
 * estável, com chaves e listas ordenadas pra que a ordem não invente
 * diferença. Nada disso é persistido em claro — só o hash sai daqui.
 */
function canonicalizeChanges(changes: StructuredAction['changes']): unknown {
  if (!changes) return null;
  const entradas = Object.entries(changes)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
    .map<[string, unknown]>(([k, v]) => {
      if ((k === 'title' || k === 'assignee') && typeof v === 'string') return [k, normalizeTaskName(v)];
      if (typeof v === 'string') return [k, v.trim().toLowerCase()];
      if (Array.isArray(v)) return [k, v.map((x) => String(x).trim().toLowerCase()).sort()];
      if (typeof v === 'object') {
        return [k, Object.entries(v as Record<string, unknown>).map(([a, b]) => `${a.trim().toLowerCase()}=${String(b).trim().toLowerCase()}`).sort()];
      }
      return [k, v];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entradas);
}

/**
 * Chave estável da operação lógica (D.3/F-03): retry do MESMO pedido (mesmo
 * conversationId + intent + alvo/lista + argumentos) regenera a MESMA chave.
 * O argsHash NUNCA carrega conteúdo bruto — o que sai daqui já é hash.
 */
function stableOperationKey(params: {
  conversationId: string;
  action: StructuredAction;
  listId: string | null;
  resolvedResourceId: string | null;
}): { operationId: string; argsHash: string } {
  const canonical = JSON.stringify({
    intent: params.action.intent,
    list: params.listId,
    target: params.resolvedResourceId,
    changes: canonicalizeChanges(params.action.changes),
  });
  const argsHash = hashOf(canonical);
  return { operationId: `bento-op:${hashOf(`${params.conversationId}|${canonical}`)}`, argsHash };
}

/**
 * ExecutionRecord do caminho novo (D.4/F-04), compatível com
 * `sameExecutionAlreadyDone`: sucesso SÓ entra em successIds quando houve
 * verificação — escrita enviada sem releitura confirmada fica em failedIds
 * (honesto pro "já fez?" e seguro pro dedup: update repete, create é
 * protegido pelo reconcile-first).
 */
function executionRecordFromEnvelope(
  envelope: WriteEnvelope,
  extras: { operationId: string; argsHash: string; title: string | null; assigneeName: string | null },
): ExecutionRecord {
  const confirmed = envelope.success && envelope.verified;
  const titles: Record<string, string> = {};
  if (extras.title) for (const id of envelope.resourceIds) titles[id] = extras.title;
  return {
    executionId: `core:${extras.operationId}`,
    operation: envelope.operation,
    taskIds: envelope.resourceIds,
    targetPerson: extras.assigneeName ? { name: extras.assigneeName, memberId: null, username: extras.assigneeName } : null,
    successIds: confirmed ? envelope.resourceIds : [],
    failedIds: confirmed
      ? []
      : envelope.resourceIds.length > 0
        ? envelope.resourceIds.map((id) => ({ id, title: extras.title ?? id, reason: envelope.error ?? 'escrita enviada, releitura não confirmou' }))
        : [{ id: '', title: extras.title ?? '(sem identificador)', reason: envelope.error ?? 'operação não confirmada' }],
    timestamp: new Date().toISOString(),
    verification: envelope.resourceIds.map((taskId) => ({ taskId, ...(extras.assigneeName ? { assigneeVerified: confirmed } : {}) })),
    titles,
    operationId: extras.operationId,
    ...(envelope.provider ? { provider: envelope.provider } : {}),
    argsHash: extras.argsHash,
  };
}

export interface BentoOpenAiCoreParams {
  message: string;
  conversationId: string;
  organizationId: string | null;
  clientId: string | null;
  seniorToolContext: SeniorToolContext | null;
  logger: Logger;
  /**
   * Nome do cliente ativo da conversa. Era `null` hardcoded na chamada do
   * planner: o modelo planejava a demanda sem saber de quem ela é, então o
   * título saía genérico e nada do dossiê podia ser usado. Quem tem esse dado
   * é a execução (execute-job.ts), então ele entra por aqui.
   */
  clientName?: string | null;
  /** Quem pediu — vai pro briefing como origem da demanda. */
  userName?: string | null;
  /**
   * O nome CADASTRADO de quem pediu, ou null. Diferente de `userName`, que tem
   * fallback genérico pro briefing: aqui um fallback viraria um responsável
   * inexistente, então não havendo nome o certo é não atribuir. Ver
   * bento-self-assignment.ts.
   */
  requesterName?: string | null;
  /**
   * E-mail de quem pediu NO CLICKUP, quando cadastrado (`users.clickup_email`).
   * Tem precedência sobre o nome na auto-atribuição: o nome de exibição do
   * Desigual OS nem sempre é o username do ClickUp — a conta `super` se chama
   * "super" aqui e é "Pedro Gabriel" lá, e por nome não resolveria.
   */
  requesterClickUpEmail?: string | null;
  /**
   * E-mail de quem pediu. É o que distingue uma pessoa da operação do bot de
   * QA, e por isso decide se a cerca de lista do `write-scope` vale para esta
   * escrita. Ver a construção do `config` abaixo.
   */
  userEmail?: string | null;
  /** Material que veio junto do pedido (print, arquivo). Vira anexo na task. */
  attachments?: TaskAttachmentInput[] | undefined;
  /**
   * Completador de texto sem ferramenta (`completeTextSafely`), usado só pelo
   * briefing pra ler o próprio pedido. Sem ele o briefing ainda sai — só não
   * recupera campo crítico escrito em prosa.
   */
  briefingWriter?: ((prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>) | undefined;
}

export async function runBentoOpenAiCore(params: BentoOpenAiCoreParams): Promise<ExecuteResponse | null> {
  if (!bentoOpenAiCoreEnabled()) return null;

  // LATÊNCIA (P1 ao vivo, 28/09/2026): medição pura, não muda nenhum branch
  // de controle — só instrumenta ONDE o tempo do turno vai. `total_ms` no
  // finally cobre TODO caminho de saída (early return incluso); as marcas
  // por etapa dentro do corpo são adicionadas nos pontos que já existiam.
  const __turnStart = performance.now();
  try {
    return await runBentoOpenAiCoreTimed(params);
  } finally {
    params.logger.info(
      { conversationId: params.conversationId, total_ms: Math.round(performance.now() - __turnStart) },
      '[bento-openai-core] latência total do turno',
    );
  }
}

async function runBentoOpenAiCoreTimed(params: BentoOpenAiCoreParams): Promise<ExecuteResponse | null> {
  const resourceState: ConversationResourceState = await loadResourceState(params.conversationId);

  let action;
  const __plannerStart = performance.now();
  try {
    action = await proposeBentoAction({
      message: params.message,
      resourceState,
      // O planner precisa saber de QUEM é a demanda: sem isso o título sai
      // genérico e o briefing não tem como puxar o dossiê do cliente certo.
      clientName: params.clientName ?? null,
      logger: params.logger as never,
    });
    params.logger.info({ conversationId: params.conversationId, planner_ms: Math.round(performance.now() - __plannerStart) }, '[bento-openai-core] planner respondeu');
  } catch (error) {
    // §26/§15 da missão: falha de credencial/estrutura é EXPLÍCITA, nunca cai
    // silenciosamente pro guard antigo enquanto a flag estiver ligada — quem
    // ligou a flag decidiu que este é o caminho, uma falha aqui é sinal
    // operacional, não motivo pra fingir que a flag estava desligada.
    const messageText = error instanceof BentoPlannerError ? error.message : 'Planejador OpenAI do Bento falhou';
    params.logger.warn({ error }, '[bento-openai-core] planner falhou');
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider: null, resourceIds: [], operation: 'plan', changes: {}, error: messageText, retryable: false, sources: [] }, `Não consegui planejar essa ação agora: ${messageText}`);
  }

  // Fora do escopo desta primeira wiring (ver comentário de topo) — cai pro
  // guard antigo, que já cobre leitura/análise.
  //
  // delete_task fica de propósito no caminho antigo (bento-action-guard.ts
  // `executeConfirmedDelete`): ele já tem confirmação em duas voltas,
  // read-back de AUSÊNCIA pós-delete e idempotência ("já tinha sido apagada")
  // — reescrevê-lo aqui, sem MCP nem policy próprios para delete nesta
  // versão, seria introduzir um segundo caminho pra um side effect
  // destrutivo sem o mesmo nível de prova (fail-safe default: preferir o
  // caminho já comprovado a um write path novo e sem MCP_SUPPORTED_INTENTS
  // (bento-mcp-executor.ts) equivalente). O foco do ConversationResourceState
  // é limpo pelo bridge em execute-job.ts assim que o guard confirma a
  // exclusão, então a continuidade do core novo não fica com foco morto.
  if (action.intent === 'read_tasks' || action.intent === 'get_task' || action.intent === 'analyze_tasks' || action.intent === 'delete_task') {
    return null;
  }

  /**
   * QUEM É O RESPONSÁVEL não pode depender do modelo acertar o pronome.
   *
   * 28/09/2026, com a Tammy: "Agora me coloque também como responsável nessa
   * tarefa" virou `assignee: "D. Carvalho"` — o nome do CLIENTE. O planner tem
   * o cliente no contexto e não tinha quem estava falando, então preencheu o
   * "me" com o único nome próprio à mão. Ver bento-self-assignment.ts: a
   * correção é determinística e roda ANTES da policy, pra que tudo daqui pra
   * baixo (validação, chave de idempotência, execução) enxergue o mesmo dado.
   */
  if (action.changes) {
    // `action` é reatribuído abaixo; o snapshot fixa o que o planner propôs.
    const propostas = action.changes;
    // Prioridade pedida como "status" é desviada antes da policy — ver
    // bento-priority.ts. "altere o status pra urgente" é pedido legítimo.
    const desvio = desviarStatusQueEhPrioridade({ status: propostas.status, priority: propostas.priority });
    if (desvio.desviado) {
      params.logger.info({ conversationId: params.conversationId, de: propostas.status, para: desvio.priority }, '[bento-openai-core] "status" pedido era prioridade');
      action = { ...action, changes: { ...propostas, status: undefined, priority: desvio.priority } };
    }

    const correcao = corrigirResponsavel({
      message: params.message,
      assignee: propostas.assignee,
      requesterName: params.requesterName ?? null,
      clientName: params.clientName,
    });
    if (correcao.motivo) {
      // Quando existe e-mail do ClickUp cadastrado, ele MANDA: nome de
      // exibição é apelido, e-mail é identidade. Só custa uma chamada nos
      // turnos de auto-atribuição, e os membros já vêm de cache.
      if (correcao.motivo === 'auto_atribuicao' && params.requesterClickUpEmail) {
        const cfgLeitura = getClickUpConfigOrNull();
        const porEmail = cfgLeitura ? await findMemberByEmail(cfgLeitura, params.requesterClickUpEmail).catch(() => null) : null;
        if (porEmail) correcao.assignee = porEmail.username;
      }
      params.logger.info(
        { conversationId: params.conversationId, de: propostas.assignee ?? null, para: correcao.assignee, motivo: correcao.motivo },
        '[bento-openai-core] responsável corrigido antes da escrita',
      );
      action = {
        ...action,
        changes: { ...(action.changes ?? propostas), ...(correcao.assignee ? { assignee: correcao.assignee } : { assignee: undefined }) },
      };
    }
  }

  if (!params.seniorToolContext) {
    return envelopeToExecuteResponse(
      'bento',
      { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: 'sem contexto de autoridade resolvido (executor/organização/permissão)', retryable: false, sources: [] },
      'Não consegui confirmar sua permissão pra essa ação agora.',
    );
  }

  // PONTE COM O SNAPSHOT ANTIGO (P0 25/09/2026, incidente D. Carvalho item
  // 11): o ConversationResourceState novo só é populado por escritas feitas
  // por ESTE caminho — uma listagem respondida pelo caminho antigo
  // (callBento) nunca passa por aqui. Sem isto, "item 11" respondido há dois
  // turnos ficava invisível pro update, mesmo com o snapshot antigo
  // (metadata.selecao) já tendo o id real gravado corretamente. Só tenta
  // quando o estado novo está REALMENTE vazio (nunca sobrescreve foco/seleção
  // já resolvidos por este caminho) e só para intents que precisam de alvo.
  let effectiveResourceState = resourceState;
  if (
    (action.intent === 'update_task' || action.intent === 'comment_task') &&
    !resourceState.focusedResource &&
    resourceState.selectedResources.length === 0 &&
    params.conversationId
  ) {
    // O userId abre a memória entre conversas: sem ele a ponte só enxerga este
    // chat, e um chat novo nasce cego pro que a pessoa acabou de fazer.
    const bridged = await resolveFromLegacySelectionSnapshot(params.conversationId, params.message, params.logger, params.seniorToolContext.userId).catch((error: unknown) => {
      params.logger.warn({ error }, '[bento-openai-core] ponte com snapshot antigo falhou');
      return null;
    });
    if (bridged) {
      effectiveResourceState = { ...resourceState, focusedResource: bridged.resource };
    }
  }

  const decision = validateBentoAction(action, effectiveResourceState, {
    actorHasClickUpWrite: params.seniorToolContext.permissions.some((p) => p.resource === 'clickup' && p.action === 'write'),
    agentHasClickUpWrite: true, // agent_tools já checado no boot da execução (loadSeniorRuntimeContext); ver RBAC seção do handoff
    mutationsThisExecution: 0,
    maxMutationsPerExecution: 10,
    explicitMultiActionConfirmed: false,
    // C.2/F-02/F-05: sem a mensagem a guarda anti UPDATE→CREATE fica DESLIGADA.
    message: params.message,
  });

  if (!decision.allowed) {
    return envelopeToExecuteResponse(
      'bento',
      { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: decision.reason, retryable: false, sources: [] },
      clarificationFor(decision.reason, action.intent),
    );
  }

  /**
   * A CERCA DE QA E A VÁLVULA DE ESCAPE (28/09/2026, achado com a Tammy).
   *
   * `write-scope.ts` tranca a escrita na lista de QA quando
   * CLICKUP_TEST_LIST_ID está na env, e tem uma válvula prevista pra produção:
   * `writeScope.authorizedForProduction`, que o guard legado monta em duas
   * chamadas (ver bento-action-guard.ts:1462 e :1729). Este caminho novo
   * montava o config CRU — sem `writeScope` — então TODA escrita dele era
   * tratada como se fosse do bot de QA. Para a Tammy, mexer em qualquer task
   * real voltava "Escrita BLOQUEADA: fora do escopo de teste".
   *
   * A regra é a mesma do legado, e é declarada aqui em vez de herdada por
   * acidente: pessoa autenticada da operação escreve na operação; bot de QA
   * continua trancado na lista de QA, e só no cliente de QA.
   */
  const ehBotDeQa = ehQaBot(params.userEmail ?? null);
  if (!podeEscreverEmProducao({ userEmail: params.userEmail ?? null, clientName: params.clientName ?? null })) {
    return envelopeToExecuteResponse(
      'bento',
      { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: 'escrita não autorizada para este cliente', retryable: false, sources: [] },
      'Não tenho autorização de escrita para esse cliente.',
    );
  }

  const configBase = getClickUpConfigOrNull();
  const config = configBase ? { ...configBase, writeScope: { authorizedForProduction: !ehBotDeQa } } : null;
  if (!config) {
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: 'ClickUp não configurado (CLICKUP_API_KEY/CLICKUP_TEAM_ID ausentes)', retryable: false, sources: [] }, 'ClickUp não está configurado neste ambiente.');
  }

  // §14 + D.4/F-04/F-05: idempotência — mesma operação já confirmada na
  // conversa não repete a escrita. Update/comment casam por (operação,
  // recurso); create casa por (operação, título normalizado) — o filtro
  // antigo exigia resolvedResourceId, que create nunca tem (dedup morto).
  //
  // QA 28/09/2026: sameExecutionAlreadyDone só comparava operação+recurso —
  // DUAS chamadas de update_task DISTINTAS sobre a MESMA task (ex.: primeiro
  // "coloca o Fulano", depois "muda o prazo pra sexta") batiam nesse mesmo
  // par e a segunda mutação, legítima e diferente, era descartada como
  // "já tinha feito isso" sem nunca tocar o ClickUp (achado ao vivo no teste
  // de aceite). Corrigido: exige também o argsHash do PEDIDO ATUAL igual ao
  // argsHash gravado — retry do MESMO pedido continua deduplicado, um pedido
  // diferente sobre o mesmo recurso não é mais engolido.
  const currentArgsHash = stableOperationKey({ conversationId: params.conversationId, action, listId: null, resolvedResourceId: decision.resolvedResourceId }).argsHash;
  const lastState = await loadLatestExecutionState(params.conversationId).catch(() => null);
  if (lastState?.kind === 'executed' && canonicalOperation(lastState.record.operation) === action.intent) {
    const record = lastState.record;
    // Recibo do guard ANTIGO nunca teve argsHash (formato pré-existente) —
    // sem o campo, mantém o dedup grosseiro de sempre (compat); com o campo
    // presente (sempre o caso pro caminho novo), exige bater com o pedido atual.
    if (
      decision.resolvedResourceId &&
      (record.argsHash === undefined || record.argsHash === currentArgsHash) &&
      sameExecutionAlreadyDone(record, { operation: record.operation, taskIds: [decision.resolvedResourceId], memberId: null })
    ) {
      return envelopeToExecuteResponse(
        'bento',
        { success: true, verified: true, provider: 'LEGACY_GATEWAY', resourceIds: [decision.resolvedResourceId], operation: action.intent, changes: {}, error: null, retryable: false, sources: [`CLICKUP_TASK:${decision.resolvedResourceId}`] },
        'Já tinha feito isso — não repeti a mutação pra não duplicar.',
      );
    }
    if (action.intent === 'create_task' && record.failedIds.length === 0 && record.successIds.length > 0) {
      const wanted = action.changes?.title ? normalizeTaskName(action.changes.title) : null;
      const matchedId = wanted ? record.successIds.find((id) => record.titles?.[id] && normalizeTaskName(record.titles[id]) === wanted) : undefined;
      if (matchedId) {
        return envelopeToExecuteResponse(
          'bento',
          { success: true, verified: true, provider: 'LEGACY_GATEWAY', resourceIds: [matchedId], operation: 'create_task', changes: {}, error: null, retryable: false, sources: [`CLICKUP_TASK:${matchedId}`] },
          `Já tinha criado essa task (https://app.clickup.com/t/${matchedId}) — não criei outra.`,
        );
      }
    }
  }

  // §2 do "BENTO FINAL RELEASE GATE": seleção real de provider. MCP é
  // PRIMARY quando o usuário já autorizou o OAuth (token presente);
  // LEGACY_GATEWAY só quando MCP não está autorizado ainda; UNSUPPORTED
  // quando nem uma coisa nem outra cobre a operação. Nunca os dois pra uma
  // mesma mutação — o resultado desta seleção é usado para EXATAMENTE um
  // caminho de execução abaixo.
  const providerSelection = await selectWriteProvider(action.intent, params.seniorToolContext.userId);
  if (providerSelection.provider === 'UNSUPPORTED') {
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider: null, resourceIds: [], operation: action.intent, changes: {}, error: providerSelection.reason, retryable: false, sources: [] }, 'Essa ação ainda não tem um jeito seguro e verificado de executar.');
  }

  // create_task precisa da lista de destino em QUALQUER provider (MCP
  // também precisa saber em qual lista criar).
  const target =
    action.intent === 'create_task'
      ? await resolveWriteTarget({
          message: params.message,
          ...(params.organizationId ? { organizationId: params.organizationId } : {}),
          executionClientId: params.clientId,
        })
      : null;
  if (action.intent === 'create_task' && (target?.status !== 'resolved' || !target.listId)) {
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider: null, resourceIds: [], operation: 'create_task', changes: {}, error: `write_target_${target?.status}: ${target?.reason}`, retryable: false, sources: [] }, 'Não consegui identificar o cliente/lista de destino dessa task.');
  }

  // D.3/D.4: chave estável da operação lógica — retry do mesmo job regenera
  // a mesma chave (vai na instrução MCP e no ExecutionRecord).
  const { operationId, argsHash } = stableOperationKey({
    conversationId: params.conversationId,
    action,
    listId: target?.listId ?? null,
    resolvedResourceId: decision.resolvedResourceId,
  });
  const recordExtras = { operationId, argsHash, title: action.changes?.title ?? null, assigneeName: action.changes?.assignee ?? null };

  if (providerSelection.provider === 'MCP') {
    const __mcpStart = performance.now();
    const envelope = await executeViaMcp({
      action,
      resolvedResourceId: decision.resolvedResourceId,
      listId: target?.listId ?? null,
      mcpToken: providerSelection.mcpToken,
      legacyReadConfig: config,
      operationId,
      possibleDuplicate: decision.possibleDuplicate,
      logger: params.logger,
    });
    params.logger.info({ conversationId: params.conversationId, mcp_exec_ms: Math.round(performance.now() - __mcpStart), verified: envelope.verified }, '[bento-openai-core] executeViaMcp respondeu');
    // F-08: foco só com id REAL — success com resourceIds vazios não registra
    // estado (era o foco perdido do CASO 5/6b da fault injection).
    if (envelope.success && envelope.resourceIds.length > 0) {
      const newState = applyExecutionToState(effectiveResourceState, {
        operation: envelope.operation,
        resourceIds: envelope.resourceIds,
        verified: envelope.verified,
        created: action.intent === 'create_task',
        title: action.changes?.title ?? null,
      });
      await persistResourceState(params.conversationId, newState);
    }
    return envelopeToExecuteResponse('bento', envelope, mcpHumanAnswer(envelope), executionRecordFromEnvelope(envelope, recordExtras));
  }

  // provider === 'LEGACY_GATEWAY' — caminho de baixo, inalterado desde a
  // entrega anterior (executores já verificados em produção).
  const provider = 'LEGACY_GATEWAY' as const;

  if (action.intent === 'create_task') {
    // F-XX/QA 28/09/2026: assignee e dueDate do pedido ("...pra fulano...
    // prazo pra amanhã") não eram repassados pro create LEGACY_GATEWAY —
    // achado ao vivo no teste de aceite (task nascia só com título, sem
    // responsável nem prazo, mesmo o planner tendo extraído os dois campos
    // corretamente em `action.changes`). createVerifiedSeniorTask já resolve
    // assigneeName (com ambiguidade/não-encontrado honestos) e aplica
    // dueDate com read-back — só faltava passar os dois adiante.
    const createDueDate = action.changes?.dueDate ? parseDueDateMs(action.changes.dueDate) : null;
    const tituloDaTask = action.changes?.title ?? 'Nova demanda';

    /**
     * BRIEFING DE VERDADE (queixa da operação, 28/09/2026): a task nascia com
     * a linha curta que o planner escreveu. Quem ia executar não recebia
     * objetivo, público, formato, entregável nem critério de aprovação — e o
     * dossiê do cliente (vault, via `memories`) nunca era lido neste caminho.
     * Agora passa pela MESMA cadeia do caminho legado: recupera contexto real,
     * monta por tipo de entrega, declara lacuna em vez de inventar.
     */
    const briefing = await buildTaskBriefing({
      message: params.message,
      taskTitle: tituloDaTask,
      clientId: params.clientId,
      clientName: params.clientName ?? null,
      assigneeName: action.changes?.assignee ?? null,
      dueDateMs: createDueDate,
      requestedBy: params.userName ?? 'a operação',
      config,
      briefingWriter: params.briefingWriter,
      attachments: params.attachments,
      logger: params.logger,
    }).catch((error: unknown) => {
      params.logger.warn({ error }, '[bento-openai-core] briefing falhou; cria com a descrição do pedido em vez de travar a demanda');
      return null;
    });

    const __createStart = performance.now();
    const result = await createVerifiedSeniorTask(
      config,
      params.seniorToolContext,
      {
        listId: target!.listId!,
        name: tituloDaTask,
        description: briefing?.markdown ?? action.changes?.description ?? '',
        ...(action.changes?.assignee ? { assigneeName: action.changes.assignee } : {}),
        ...(createDueDate !== null ? { dueDate: createDueDate } : {}),
        /* --- 28/09/2026: prioridade, tags, subtarefa e início já na criação --- */
        ...(mapPrioridade(action.changes?.priority) ? { priority: mapPrioridade(action.changes?.priority)! } : {}),
        ...(action.changes?.addTags?.length ? { tags: action.changes.addTags } : {}),
        ...(action.changes?.parentTaskId ? { parent: action.changes.parentTaskId } : {}),
        ...(action.changes?.startDate && parseDueDateMs(action.changes.startDate)
          ? { startDate: parseDueDateMs(action.changes.startDate)! }
          : {}),
      },
      new MutationBudget(),
    );
    params.logger.info({ conversationId: params.conversationId, legacy_create_ms: Math.round(performance.now() - __createStart) }, '[bento-openai-core] createVerifiedSeniorTask respondeu');
    if (!result.success) {
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [], operation: 'create_task', changes: {}, error: result.message, retryable: result.retryable, sources: [] }, `Não consegui criar a task: ${result.message}`);
    }
    // MATERIAL DO PEDIDO VAI JUNTO: print/arquivo que a pessoa mandou no chat
    // sobe pra task. Best-effort — o anexo já está como referência no
    // briefing, então falha de upload degrada, não invalida a criação.
    const anexados = params.attachments?.length
      ? await attachMaterials(config, result.resourceId, params.attachments, params.logger)
      : [];

    const newState = applyExecutionToState(resourceState, { operation: 'create_task', resourceIds: [result.resourceId], verified: result.verified, created: !result.wasExisting, title: action.changes?.title ?? null });
    await persistResourceState(params.conversationId, newState);
    const envelope: WriteEnvelope = { success: true, verified: result.verified, provider, resourceIds: [result.resourceId], operation: 'create_task', changes: { title: action.changes?.title ?? null }, error: null, retryable: false, sources: [`CLICKUP_TASK:${result.resourceId}`] };

    const subiram = anexados.filter((a) => a.ok).length;
    const linhas = [
      result.wasExisting ? `Essa task já existia (${result.resourceUrl}) — não criei outra.` : `Criei a task: ${result.resourceUrl}`,
      briefing ? `📋 Briefing de ${briefing.deliveryType === 'generic' ? 'entrega operacional' : briefing.deliveryType} anexado na descrição.` : null,
      briefing?.missingCritical.length ? `⚠️ Falta confirmar: ${briefing.missingCritical.join(', ')}.` : null,
      anexados.length ? `📎 ${subiram}/${anexados.length} anexo(s) na task.` : null,
      // A task já foi relida pela criação verificada. Dizer o que se vê nela
      // custa zero e é a diferença entre um executor e um colega — ver
      // bento-proatividade.ts. Nunca executa nada por conta própria.
      ...observacoesProativas({ task: result.data as unknown as import('@desigual-os/tool-gateway').TaskDetail | null }),
    ].filter(Boolean) as string[];

    /**
     * O DOCUMENTO do turno, pra quem quiser levá-lo embora (`@notion`).
     *
     * A resposta do chat é um recibo — "criei a task: <link>". O conteúdo que
     * vale é o BRIEFING, e ele mora na descrição da task. Sem isto, exportar
     * o turno pro Notion criava uma página com duas linhas de recibo, que foi
     * exatamente o que aconteceu no primeiro teste real (28/09/2026).
     */
    const resposta = envelopeToExecuteResponse('bento', envelope, linhas.join('\n'), executionRecordFromEnvelope(envelope, recordExtras));
    return briefing
      ? { ...resposta, metadata: { ...resposta.metadata, documento: { titulo: tituloDaTask, markdown: briefing.markdown } } }
      : resposta;
  }

  if (!decision.resolvedResourceId) {
    return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [], operation: action.intent, changes: {}, error: 'target_unresolved', retryable: false, sources: [] }, 'Não identifiquei a task alvo dessa ação.');
  }

  if (action.intent === 'comment_task') {
    const text = action.changes?.comment ?? action.changes?.description ?? '';
    if (!text.trim()) {
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [decision.resolvedResourceId], operation: 'comment_task', changes: {}, error: 'comentário vazio', retryable: false, sources: [] }, 'Não recebi o texto do comentário.');
    }
    try {
      /**
       * RESPOSTA NA THREAD (28/09/2026). Comentário solto e resposta a um
       * comentário são coisas diferentes pra quem lê a task: a segunda
       * preserva o fio da conversa. `replyToComment` já existia no cliente e
       * nunca tinha sido usada.
       */
      const respondendo = action.changes?.replyToCommentId?.trim();
      const created = respondendo
        ? { id: await replyToComment(config, decision.resolvedResourceId, respondendo, text) }
        : await createTaskComment(config, decision.resolvedResourceId, text);
      const comments = await getTaskComments(config, decision.resolvedResourceId).catch(() => []);
      // Resposta em thread não aparece na listagem de comentários raiz; sem
      // conseguir reler, o honesto é não afirmar verificação.
      const verified = respondendo ? Boolean(created.id) : comments.some((c) => c.id === created.id);
      const newState = applyExecutionToState(effectiveResourceState, { operation: 'comment_task', resourceIds: [decision.resolvedResourceId], verified, created: false });
      await persistResourceState(params.conversationId, newState);
      const envelope: WriteEnvelope = { success: true, verified, provider, resourceIds: [decision.resolvedResourceId], operation: 'comment_task', changes: { comment: text }, error: null, retryable: false, sources: [`CLICKUP_TASK:${decision.resolvedResourceId}`, `CLICKUP_COMMENT:${created.id}`] };
      return envelopeToExecuteResponse('bento', envelope, 'Comentário adicionado.', executionRecordFromEnvelope(envelope, recordExtras));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'falha desconhecida';
      return envelopeToExecuteResponse('bento', { success: false, verified: false, provider, resourceIds: [decision.resolvedResourceId], operation: 'comment_task', changes: {}, error: messageText, retryable: true, sources: [] }, `Não consegui comentar: ${messageText}`);
    }
  }

  // update_task
  const __updateStart = performance.now();
  const response = await executeTaskUpdate({
    config,
    taskId: decision.resolvedResourceId,
    knownTaskName: effectiveResourceState.focusedResource?.title ?? null,
    fields: {
      ...(action.changes?.title ? { newTitle: action.changes.title } : {}),
      ...(action.changes?.description ? { replaceDescription: action.changes.description } : {}),
      // QA 28/09/2026: dueDate do planner não era repassado pro update
      // LEGACY_GATEWAY — "muda o prazo pra sexta" respondia "já estava
      // assim" porque `fields` nunca carregava a data nova nenhuma vez.
      ...(action.changes?.dueDate && parseDueDateMs(action.changes.dueDate) !== null
        ? { dueDate: parseDueDateMs(action.changes.dueDate)! }
        : {}),
      // D.11/F-17: assigneeOperation de primeira classe — remove/replace/add.
      ...(action.changes?.assignee
        ? action.changes.assigneeOperation === 'remove'
          ? { removePersonName: action.changes.assignee }
          : action.changes.assigneeOperation === 'replace'
            ? { replacePersonName: action.changes.assignee }
            : { personName: action.changes.assignee }
        : {}),
      // Status destravado (28/09/2026): "fecha essa task" chega aqui como
      // hint em português e o executor traduz pro status REAL da lista.
      ...(action.changes?.status?.trim() ? { statusHint: action.changes.status } : {}),
      // Prioridade (28/09/2026): o executor já sabia escrever o campo; faltava
      // o plano carregá-lo. Palavra que não mapeia vira ausência, não chute.
      ...(mapPrioridade(action.changes?.priority) ? { priority: mapPrioridade(action.changes?.priority)! } : {}),
      /* --- 28/09/2026, onda 2: o resto do ClickUp --- */
      ...(action.changes?.startDate && parseDueDateMs(action.changes.startDate)
        ? { startDate: parseDueDateMs(action.changes.startDate)! }
        : {}),
      ...(parseEstimativa(action.changes?.timeEstimate) ? { timeEstimate: parseEstimativa(action.changes?.timeEstimate)! } : {}),
      ...(action.changes?.addTags?.length ? { addTags: action.changes.addTags } : {}),
      ...(action.changes?.removeTags?.length ? { removeTags: action.changes.removeTags } : {}),
      ...(action.changes?.customFields && Object.keys(action.changes.customFields).length > 0
        ? { customFields: action.changes.customFields }
        : {}),
      ...(action.changes?.checklistItems?.length
        ? { checklistItems: action.changes.checklistItems, ...(action.changes.checklistName ? { checklistName: action.changes.checklistName } : {}) }
        : {}),
      ...(action.changes?.dependsOnTaskId ? { dependsOnTaskId: action.changes.dependsOnTaskId } : {}),
      ...(action.changes?.dependencyOfTaskId ? { dependencyOfTaskId: action.changes.dependencyOfTaskId } : {}),
    },
    // Era `() => undefined`: o core aceitava o pedido e depois não sabia
    // traduzir status nenhum, então nada mudava. Reusa o mapeador do guard.
    mapStatus: mapStatusHintToRealStatus,
    logger: params.logger,
  });
  params.logger.info({ conversationId: params.conversationId, legacy_update_ms: Math.round(performance.now() - __updateStart) }, '[bento-openai-core] executeTaskUpdate respondeu');

  const resourceIds = decision.resolvedResourceId ? [decision.resolvedResourceId] : [];
  const verified = response.status === 'completed';
  if (verified) {
    const newState = applyExecutionToState(effectiveResourceState, { operation: 'update_task', resourceIds, verified: true, created: false });
    await persistResourceState(params.conversationId, newState);
  }

  /**
   * PROCEDÊNCIA DO FECHAMENTO (28/09/2026). O hard deny de "concluir trabalho
   * humano" caiu, mas o risco que ele cobria não some sozinho: um status
   * "pronto" sem dono faz a operação planejar em cima de uma mentira. Então
   * toda mudança de status verificada deixa registrado QUEM pediu — o
   * histórico da task passa a dizer "fechada a pedido de fulano", em vez de
   * parecer que o agente concluiu por conta própria. Best-effort: o comentário
   * é rastro, não a escrita em si; falhar aqui não invalida a mudança.
   */
  /**
   * E O MESMO VALE PRA RESPONSÁVEL (28/09/2026, relato da Tammy).
   *
   * O ClickUp atribui toda escrita ao DONO DO TOKEN, então a notificação que
   * chega pra pessoa diz que quem a colocou na task foi o dono da chave — não
   * o Bento, nem quem realmente pediu. A identidade certa se resolve com um
   * token da conta "Bento Desigual" (ver CLICKUP_BOT_API_KEY em
   * bento-action-guard.ts); enquanto ele não existe, o rastro na própria task
   * é o que impede a operação de ler o histórico errado.
   */
  const procedencias: string[] = [];
  if (action.changes?.status?.trim()) {
    procedencias.push(`Status alterado para "${action.changes.status}"`);
  }
  if (action.changes?.assignee?.trim()) {
    const verbo =
      action.changes.assigneeOperation === 'remove'
        ? 'removido'
        : action.changes.assigneeOperation === 'replace'
          ? 'trocado para'
          : 'definido como';
    procedencias.push(`Responsável ${verbo} "${action.changes.assignee}"`);
  }
  if (verified && procedencias.length > 0 && decision.resolvedResourceId) {
    await createTaskComment(
      config,
      decision.resolvedResourceId,
      `${procedencias.join('; ')} a pedido de ${params.userName ?? 'a operação'}, via Desigual OS (Bento).`,
    ).catch((error: unknown) => {
      params.logger.warn({ error, taskId: decision.resolvedResourceId }, '[bento-openai-core] não consegui registrar a procedência (a mudança valeu)');
      return null;
    });
  }

  /**
   * O QUE O PEDIDO REVELA (28/09/2026). No update, reler a task só pra observar
   * custaria uma chamada a mais no turno — e latência já é problema conhecido
   * aqui. Então a observação sai do PRÓPRIO PEDIDO, que é de graça: prazo
   * marcado pra trás, ou o último responsável saindo. Ver bento-proatividade.ts.
   */
  const observacoes = verified
    ? observacoesDoPedido({
        dueDateMs: action.changes?.dueDate ? parseDueDateMs(action.changes.dueDate) : null,
        removeuResponsavel: action.changes?.assigneeOperation === 'remove',
      })
    : [];
  const answerComObservacao = observacoes.length > 0 ? `${response.answer}\n\n${observacoes.join('\n')}` : response.answer;

  // D.4: o executor já grava `execucao` (operation 'update' — o dedup casa
  // pelo alias); aqui o recibo ganha a chave estável da operação e o provider.
  const execucaoAnterior = response.metadata?.execucao;
  return {
    ...response,
    answer: answerComObservacao,
    sources: resourceIds.map((id) => `CLICKUP_TASK:${id}`),
    metadata: {
      ...response.metadata,
      guard: 'bento-openai-core',
      provider,
      ...(typeof execucaoAnterior === 'object' && execucaoAnterior !== null
        ? { execucao: { ...(execucaoAnterior as Record<string, unknown>), operationId, provider, argsHash } }
        : {}),
    },
  };
}
