import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  createAttributedTask,
  createTaskComment,
  findDuplicateTask,
  findMemberByName,
  getTask,
  getTaskComments,
  getTaskListId,
  listStatusesForTask,
  queryOperationTasks,
  updateTask,
  getWriteScopeListId,
  verifyTaskState,
  type ClickUpConfig,
  type ExpectedTaskState,
  type TaskVerification,
} from '@desigual-os/tool-gateway';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import { classifyDeliveryType, composeBriefing } from './briefing-composer';
import { evaluateBriefing } from './briefing-quality';
import { retrieveBriefingContext } from './briefing-retrieval';
import { classifyActionIntent } from './action-intent';
import { buildOperationalTitle, resolveWriteTarget } from './write-target';

/**
 * BENTO ACTION GUARD (14/09/2026).
 *
 * O bug que isto mata, medido ao vivo: depois de "crie uma task pro Pedro",
 * o turno seguinte "perfeito, atribua a task a ele" virou UMA TASK NOVA
 * chamada "perfeito, a ele" (id real 86bc05yjn, capturada no ClickUp). O
 * serviço remoto do Bento não distingue UPDATE de CREATE nem resolve
 * referentes ("essa task", "ele"). O guard roda ANTES do dispatch: quando a
 * intenção é uma escrita ClickUp com alvo resolvível, a ação acontece AQUI,
 * com read-after-write, e a resposta é um recibo do que existe de verdade.
 * Intenção incerta NÃO cai no caminho cego de criação: vira esclarecimento
 * honesto ou segue pro agente (só quando não é escrita).
 */

/**
 * O pedido do humano em uma linha, sem o bloco de contexto do Orchestrator.
 * É a SITUAÇÃO que originou a demanda — o fato mais básico do briefing.
 */
function resumoDoPedido(message: string): string {
  const turno = (message.split(/\n-{3,}\n/)[0] ?? message).split(/\n\s*\n/)[0] ?? message;
  return turno.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Flag `i` em todas: sem ela "Crie uma task" (com maiúscula, que é como
// qualquer pessoa escreve) NÃO casava, o guard devolvia null e o pedido caía
// no agente remoto — que criava a task sem resolver cliente, sem título
// operacional e sem read-back. Era esse o caminho do bug relatado.
const UPDATE_ASSIGNEE = /(atribu|designa|delega|passa|coloca)/i;
const UPDATE_DUE = /(muda|reagend|adi(a|ar|e)|remarca|passa)\b.*(prazo|vencimento|data|hoje|amanh|sexta|\d{1,2}\/\d{1,2})/i;
const UPDATE_STATUS = /(marc(ar|a|que)|conclu(i|ir|ida)|finaliz(a|ar)|fech(a|ar))\b.*(conclu|pront|revis|feito)/i;
const CREATE_TASK = /(cri(e|a|ar)|adicione?|nova (task|tarefa)|nova task|nova tarefa)\b/i;
const REFERENCE_WORDS = /(essa|aquela|a task|a tarefa|esta task|esta tarefa|ela|ele|isso|dela|dele|nesta|nessa|a anterior)\b/i;
const BRIEFING_ASK = /(briefing|brief)\b/i;
const ATTACH_ASK = /(anex(e|a|ar)|anexo|attach)\b/i;
const TASK_URL = /app\.clickup\.com\/t\/([a-z0-9]+)/gi;
const DUE_TODAY = /(hoje|pra hoje|pro hoje)/i;
const DUE_TOMORROW = /(amanh|pra amanh)/i;

type GuardIntent =
  | { kind: 'update_assignee'; personName: string }
  | { kind: 'update_due'; dueDate: number }
  | { kind: 'update_status'; statusHint: string }
  | { kind: 'create'; taskName: string; personName: string | null; dueDate: number | null; wantsBriefing: boolean }
  | { kind: 'none' };

interface ConversationContext {
  lastTaskId: string | null;
  lastTaskName: string | null;
  lastPersonName: string | null;
}

function extractPersonName(message: string): string | null {
  // "atribua a task ao Pedro", "passa pra Jamile", "designa pro Gabriel"
  const match = message.match(/(?:a|à|ao|pro|pra|para)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+){0,2})/);
  return match?.[1]?.trim() ?? null;
}

function extractTaskName(message: string): string | null {
  // nome entre aspas ou após "chamada/nomeada/com o nome"
  const quoted = message.match(/["“]([^"”]{3,120})["”]/);
  if (quoted) return quoted[1]!.trim();
  const named = message.match(/(?:chamad[ao]|nomead[ao]|com (?:o )?nome|nome:?)\s+(.{3,120}?)(?:[.,;]|$)/i);
  return named?.[1]?.trim() ?? null;
}

export function classifyIntentForTest(message: string): GuardIntent {
  return classifyIntent(message);
}

function classifyIntent(message: string): GuardIntent {
  const hasReference = REFERENCE_WORDS.test(message);
  const person = extractPersonName(message);

  if (UPDATE_ASSIGNEE.test(message) && (person || hasReference)) {
    // "atribua a ele": o "ele" é a pessoa do TURNO ANTERIOR, resolvida no contexto.
    return { kind: 'update_assignee', personName: person ?? '' };
  }
  if (UPDATE_DUE.test(message) && hasReference) {
    const now = new Date();
    if (DUE_TOMORROW.test(message)) {
      return { kind: 'update_due', dueDate: endOfDay(addDays(now, 1)).getTime() };
    }
    if (DUE_TODAY.test(message)) {
      return { kind: 'update_due', dueDate: endOfDay(now).getTime() };
    }
    return { kind: 'none' };
  }
  if (UPDATE_STATUS.test(message) && hasReference) {
    return { kind: 'update_status', statusHint: message };
  }
  if (CREATE_TASK.test(message)) {
    const taskName = extractTaskName(message);
    const dueDate = DUE_TODAY.test(message)
      ? endOfDay(new Date()).getTime()
      : DUE_TOMORROW.test(message)
        ? endOfDay(addDays(new Date(), 1)).getTime()
        : null;
    return {
      kind: 'create',
      taskName: taskName ?? '',
      personName: person,
      dueDate,
      wantsBriefing: BRIEFING_ASK.test(message) || ATTACH_ASK.test(message),
    };
  }
  return { kind: 'none' };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function loadConversationContext(conversationId: string | null): Promise<ConversationContext> {
  if (!conversationId) return { lastTaskId: null, lastTaskName: null, lastPersonName: null };
  const recent = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(8);

  let lastTaskId: string | null = null;
  let lastTaskName: string | null = null;
  let lastPersonName: string | null = null;
  for (const message of recent) {
    if (!lastTaskId && message.role === 'assistant') {
      const urls = [...message.content.matchAll(TASK_URL)];
      if (urls.length > 0) {
        lastTaskId = urls[urls.length - 1]![1]!;
        const named = message.content.match(/task\s+["“]?([^"”\n]{3,80})["”]?\s+(?:na lista|no ClickUp|criada)/i);
        lastTaskName = named?.[1]?.trim() ?? null;
      }
    }
    if (!lastPersonName && message.role === 'user') {
      lastPersonName = extractPersonName(message.content);
    }
  }
  return { lastTaskId, lastTaskName, lastPersonName };
}

export function getClickUpConfigOrNull(): ClickUpConfig | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * READ-BACK (seções 32-33): relê a task e confere os campos que a ação
 * prometeu. Retorna a verificação, ou null quando NÃO conseguiu reler — e aí
 * o chamador é honesto sobre isso, nunca finge que confirmou.
 */
async function readBackVerify(
  config: ClickUpConfig,
  taskId: string,
  expected: ExpectedTaskState,
): Promise<TaskVerification | null> {
  try {
    const relida = await getTask(config, taskId);
    return verifyTaskState(relida, expected);
  } catch {
    return null;
  }
}

function guardResponse(params: { answer: string; ok: boolean; toolCalls: ExecuteResponse['tool_calls']; metadata?: Record<string, unknown> }): ExecuteResponse {
  return {
    execution_id: '',
    agent: 'bento',
    status: params.ok ? 'completed' : 'failed',
    answer: params.answer,
    sources: [],
    tool_calls: params.toolCalls,
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(params.ok ? {} : { error: params.answer }),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

/**
 * Retorna ExecuteResponse quando o guard tratou (ação executada ou resposta
 * honesta de bloqueio), ou null quando a mensagem NÃO é uma escrita ClickUp
 * tratável aqui — aí o fluxo segue normal pro agente remoto.
 */
export async function tryBentoActionGuard(params: {
  message: string;
  conversationId: string | null;
  userName: string;
  userClickUpEmail: string | null;
  agencyListId: string | null;
  briefingWriter: (prompt: string) => Promise<string | null>;
  /** Cliente da execução, quando houver: é a chave do retrieval do briefing. */
  clientId?: string | null;
  clientName?: string | null;
  logger: Logger;
}): Promise<ExecuteResponse | null> {
  const { message, conversationId, logger } = params;

  // PORTÃO 1 — ANÁLISE NÃO É ESCRITA. Classificação determinística ANTES de
  // qualquer ferramenta. Caso real: pedido de análise virou task na hora.
  const acao = classifyActionIntent(message);
  if (!acao.writeAuthorized) {
    logger.info(
      { intent_classification: acao.kind, write_authorized: false, write_reason: acao.reason },
      '[guard] pedido sem autorização de escrita; segue para análise'
    );
    // null = segue pro agente, que ANALISA e responde. Nenhuma escrita aqui.
    return null;
  }

  const intent = classifyIntent(message);
  // §6: pedido que ANALISA e manda criar entrega a análise dentro da task — o
  // briefing é onde o resultado da análise vira instrução executável. Sem isso
  // a task nasce sem o contexto que acabou de ser levantado.
  if (intent.kind === 'create' && acao.requiresAnalysisFirst) intent.wantsBriefing = true;
  if (intent.kind === 'none') return null;

  const config = getClickUpConfigOrNull();
  if (!config) return null;

  const context = await loadConversationContext(conversationId);
  const toolCalls: { tool: string; input_summary: string; ok: boolean; duration_ms: number; error?: string }[] = [];
  const startedAt = performance.now();
  const record = (tool: string, input: string, ok: boolean, error?: string) => {
    toolCalls.push({ tool, input_summary: input, ok, duration_ms: Math.round(performance.now() - startedAt), ...(error ? { error } : {}) });
  };

  // -------- UPDATE --------
  if (intent.kind !== 'create') {
    const taskId = context.lastTaskId;
    if (!taskId) {
      return guardResponse({
        ok: true,
        toolCalls,
        answer:
          'Não encontrei nenhuma task criada ou citada recentemente nesta conversa pra alterar. ' +
          'Me diga o nome ou o link da task no ClickUp que eu faço a alteração nela, sem criar nada novo.',
        metadata: { guard: 'bento-action', reason: 'update_sem_alvo_resolvivel' },
      });
    }

    if (intent.kind === 'update_assignee') {
      const personName = intent.personName || context.lastPersonName;
      if (!personName) {
        return guardResponse({
          ok: true,
          toolCalls,
          answer: 'Pra quem eu atribuo? Não consegui identificar a pessoa pela conversa.',
          metadata: { guard: 'bento-action', reason: 'assignee_sem_pessoa' },
        });
      }
      const member = await findMemberByName(config, personName).catch(() => null);
      if (!member) {
        return guardResponse({
          ok: true,
          toolCalls,
          answer: `Não encontrei "${personName}" entre os membros do ClickUp. Confere o nome pra mim?`,
          metadata: { guard: 'bento-action', reason: 'assignee_nao_encontrado' },
        });
      }
      try {
        await updateTask(config, taskId, { addAssignees: [member.id] });
        record('clickup.update_task', `assign ${member.username} -> ${taskId}`, true);
        // READ-BACK (seção 32): relê e confirma que o responsável REALMENTE entrou.
        const verif = await readBackVerify(config, taskId, { assigneeIds: [member.id] });
        record('clickup.get_task', `read-back ${taskId}`, verif?.ok ?? false, verif == null ? 'não consegui reler' : verif.mismatches.join('; ') || undefined);
        const prefixo = context.lastTaskName ? `"${context.lastTaskName}" ` : '';
        return guardResponse({
          ok: true,
          toolCalls,
          answer:
            verif == null
              ? `Enviei a atribuição pra ${member.username} na task ${prefixo}(${taskId}), mas não consegui reler pra confirmar. Confere no ClickUp.`
              : verif.ok
                ? `Atribuído e CONFIRMADO por leitura no ClickUp: a task ${prefixo}(${taskId}) agora é de ${member.username}.`
                : `Enviei a atribuição pra ${member.username} na task ${prefixo}(${taskId}), mas ao reler a verificação apontou: ${verif.mismatches.join('; ')}.`,
          metadata: { guard: 'bento-action', action: 'update_assignee', task_id: taskId, assignee: member.username, verified: verif?.ok ?? false },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        record('clickup.update_task', `assign -> ${taskId}`, false, detail);
        return guardResponse({
          ok: false,
          toolCalls,
          answer: `Não consegui atribuir no ClickUp: ${detail}`,
          metadata: { guard: 'bento-action', action: 'update_assignee', task_id: taskId },
        });
      }
    }

    if (intent.kind === 'update_due') {
      try {
        await updateTask(config, taskId, { dueDate: intent.dueDate });
        record('clickup.update_task', `due ${new Date(intent.dueDate).toISOString().slice(0, 10)} -> ${taskId}`, true);
        const dateLabel = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate));
        const prefixo = context.lastTaskName ? `"${context.lastTaskName}" ` : '';
        // READ-BACK (seção 32): relê e confirma que o prazo REALMENTE mudou.
        // granularidade de DIA: o prazo veio de linguagem natural (hoje/amanhã) e
        // o ClickUp normaliza prazo sem hora — comparar instante gera divergência falsa.
        const verif = await readBackVerify(config, taskId, { dueDate: intent.dueDate, dueDateGranularity: 'day' });
        record('clickup.get_task', `read-back ${taskId}`, verif?.ok ?? false, verif == null ? 'não consegui reler' : verif.mismatches.join('; ') || undefined);
        return guardResponse({
          ok: true,
          toolCalls,
          answer:
            verif == null
              ? `Mudei o prazo da task ${prefixo}(${taskId}) para ${dateLabel}, mas não consegui reler pra confirmar. Confere no ClickUp.`
              : verif.ok
                ? `Prazo alterado e CONFIRMADO por leitura no ClickUp: a task ${prefixo}(${taskId}) vence ${dateLabel}.`
                : `Enviei a mudança de prazo da task ${prefixo}(${taskId}), mas ao reler a verificação apontou: ${verif.mismatches.join('; ')}.`,
          metadata: { guard: 'bento-action', action: 'update_due', task_id: taskId, due_date: intent.dueDate, verified: verif?.ok ?? false },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        record('clickup.update_task', `due -> ${taskId}`, false, detail);
        return guardResponse({ ok: false, toolCalls, answer: `Não consegui mudar o prazo no ClickUp: ${detail}` });
      }
    }

    if (intent.kind === 'update_status') {
      const statuses = await listStatusesForTask(config, taskId).catch(() => []);
      const wanted = statuses.find((status) => /revis/i.test(intent.statusHint) ? /revis/i.test(status) : /(pront|conclu|feito|encerr)/i.test(status));
      if (!wanted) {
        return guardResponse({
          ok: true,
          toolCalls,
          answer: `Não consegui mapear o novo status. Os status válidos nessa lista são: ${statuses.join(', ') || 'indisponíveis'}. Me diga qual deles usar.`,
          metadata: { guard: 'bento-action', reason: 'status_sem_mapeamento', valid: statuses },
        });
      }
      try {
        await updateTask(config, taskId, { status: wanted });
        record('clickup.update_task', `status ${wanted} -> ${taskId}`, true);
        const prefixo = context.lastTaskName ? `"${context.lastTaskName}" ` : '';
        // READ-BACK (seção 32): relê e confirma que o status REALMENTE mudou.
        const verif = await readBackVerify(config, taskId, { status: wanted });
        record('clickup.get_task', `read-back ${taskId}`, verif?.ok ?? false, verif == null ? 'não consegui reler' : verif.mismatches.join('; ') || undefined);
        return guardResponse({
          ok: true,
          toolCalls,
          answer:
            verif == null
              ? `Mudei o status da task ${prefixo}(${taskId}) para "${wanted}", mas não consegui reler pra confirmar. Confere no ClickUp.`
              : verif.ok
                ? `Status alterado e CONFIRMADO por leitura no ClickUp: a task ${prefixo}(${taskId}) está como "${wanted}".`
                : `Enviei a mudança de status da task ${prefixo}(${taskId}), mas ao reler a verificação apontou: ${verif.mismatches.join('; ')}.`,
          metadata: { guard: 'bento-action', action: 'update_status', task_id: taskId, status: wanted, verified: verif?.ok ?? false },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        record('clickup.update_task', `status -> ${taskId}`, false, detail);
        return guardResponse({ ok: false, toolCalls, answer: `Não consegui mudar o status no ClickUp: ${detail}` });
      }
    }
    return null;
  }

  // -------- CREATE --------
  // A ORDEM aqui é a regra: resolver cliente -> gerar título operacional ->
  // só então criar. Antes, o nome vinha da mensagem crua e era checado antes
  // de existir cliente resolvido — foi assim que nasceu a task chamada
  // "Peças que você confia, você tem" na lista errada.

  // PORTÃO 2 — RESOLVER O CLIENTE ANTES DE ESCREVER. Nenhuma task nasce
  // numa lista escolhida por fallback: no caso real a task foi parar na
  // lista errada exatamente assim.
  const alvo = await resolveWriteTarget({
    message: params.message,
    executionClientId: params.clientId ?? null,
  });

  if (alvo.status === 'unknown_client' || alvo.status === 'ambiguous_client' || alvo.status === 'missing_list') {
    const pergunta =
      alvo.status === 'ambiguous_client'
        ? `Não consegui identificar com segurança a lista do cliente: mais de um cliente casa com o que você escreveu (${alvo.candidates.join(
)}). Me diz qual é que eu crio lá.`
        : alvo.status === 'missing_list'
          ? `Não criei a task: ${alvo.reason}. Vincule a lista do ClickUp a esse cliente que eu crio em seguida.`
          : `Não consegui identificar com segurança a lista do cliente citado. Não criei a task pra não colocar no lugar errado. Me diz qual cliente da carteira é esse.`;
    record('guard.client_unresolved', alvo.reason, false);
    logger.info(
      { intent_classification: acao.kind, client_resolution: alvo.status, write_authorized: false, write_reason: alvo.reason },
      '[guard] escrita bloqueada: cliente não resolvido'
    );
    return guardResponse({
      ok: true,
      toolCalls,
      answer: pergunta,
      metadata: {
        guard: 'bento-action',
        action: 'blocked_client_unresolved',
        intent_classification: acao.kind,
        client_resolution: alvo.status,
        resolved_client_id: null,
        resolved_clickup_list_id: null,
        write_authorized: false,
        write_reason: alvo.reason,
        candidates: alvo.candidates,
      },
    });
  }

  // Sem cliente citado, a task é da própria agência — e o recibo DIZ isso,
  // em vez de escolher a lista em silêncio.
  const listId = alvo.listId ?? params.agencyListId;
  if (!listId) {
    record('guard.client_unresolved', 'sem lista de destino', false);
    return guardResponse({
      ok: true,
      toolCalls,
      answer: 'Não consegui identificar com segurança a lista do cliente. Não criei a task pra não colocar no lugar errado.',
      metadata: { guard: 'bento-action', action: 'blocked_client_unresolved', write_authorized: false, write_reason: 'sem lista de destino' },
    });
  }

  // TÍTULO OPERACIONAL: diz o que precisa ser FEITO. Copiar a mensagem crua
  // foi o que gerou a task chamada "Peças que você confia, você tem" — que é
  // o nome da campanha, não do trabalho.
  const tituloOperacional = buildOperationalTitle({
    message: params.message,
    explicitName: intent.taskName || null,
    clientName: alvo.clientName,
  });
  intent.taskName = tituloOperacional;
  if (!intent.taskName || intent.taskName.trim().length < 6) {
    return guardResponse({
      ok: true,
      toolCalls,
      answer: 'Não consegui montar um título operacional claro pra essa task. Me diz em uma frase o que precisa ser feito que eu crio.',
      metadata: { guard: 'bento-action', reason: 'titulo_insuficiente', write_authorized: false },
    });
  }

  // IDEMPOTÊNCIA (seção 33): antes de criar, procura uma task com o MESMO nome
  // já aberta na lista. Cobre o retry após timeout (o create anterior pode ter
  // gravado) e o guard rodando duas vezes, sem duplicar. Falha de consulta não
  // bloqueia a criação — só perde a proteção nesse turno.
  const existentes = await queryOperationTasks(config, { listIds: [listId], includeClosed: false })
    .then((page) => page.tasks)
    .catch(() => []);
  const duplicada = findDuplicateTask(existentes, intent.taskName);
  if (duplicada) {
    record('clickup.idempotency_hit', `duplicata evitada: ${duplicada.id}`, true);
    return guardResponse({
      ok: true,
      toolCalls,
      answer:
        `Já existe uma task com esse nome nessa lista: "${duplicada.name}" ` +
        `(https://app.clickup.com/t/${duplicada.id}). Não criei outra pra não duplicar. ` +
        'Se você quer mesmo uma segunda task, me diga um nome diferente.',
      metadata: { guard: 'bento-action', action: 'create_idempotent_hit', task_id: duplicada.id },
    });
  }

  try {
    const created = await createAttributedTask(config, {
      listId,
      name: intent.taskName,
      description: `Criada via chat por ${params.userName}.`,
      requesterName: params.userName,
      requesterClickUpEmail: params.userClickUpEmail,
      ...(intent.dueDate ? { dueDate: intent.dueDate } : {}),
    });
    record('clickup.create_task', intent.taskName, true);

    let assigneeLabel: string | null = null;
    let assigneeMemberId: number | null = null;
    if (intent.personName) {
      const member = await findMemberByName(config, intent.personName).catch(() => null);
      if (member) {
        await updateTask(config, created.id, { addAssignees: [member.id] });
        record('clickup.update_task', `assign ${member.username}`, true);
        assigneeLabel = member.username;
        assigneeMemberId = member.id;
      }
    }

    let briefingAttached = false;
    let briefingEvaluation: ReturnType<typeof evaluateBriefing> | null = null;
    let briefingSources: string[] = [];
    let briefingRevisions = 0;
    if (intent.wantsBriefing) {
      // BRIEFING POR FATO (não por template): recupera contexto real do
      // cliente, monta a estrutura do TIPO de entrega e declara o que falta.
      // O template fixo anterior anexava "Executar a entrega descrita no
      // título desta task" — passava no read-back e era inútil pra quem ia
      // executar.
      const deliveryType = classifyDeliveryType(params.message, intent.taskName);
      const contexto = await retrieveBriefingContext({
        clientId: params.clientId ?? null,
        requestText: params.message,
        taskId: created.id,
        config,
      }).catch(() => ({ facts: [], references: [], sourcesConsulted: [] as string[] }));
      briefingSources = contexto.sourcesConsulted;

      const prazoLabel = intent.dueDate
        ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate))
        : null;
      let composto = composeBriefing({
        taskName: intent.taskName,
        clientName: params.clientName ?? null,
        deliveryType,
        facts: contexto.facts,
        references: contexto.references,
        requestedBy: params.userName,
        dueDateLabel: prazoLabel,
        assignee: assigneeLabel,
        requestSummary: resumoDoPedido(params.message),
      });
      briefingEvaluation = evaluateBriefing(composto, { clientName: params.clientName ?? null });

      // AUTO-REVISÃO: só quando há matéria-prima e o problema é redação.
      if (!briefingEvaluation.executable && briefingEvaluation.recommendation === 'revise') {
        briefingRevisions += 1;
        const extra = await params
          .briefingWriter(
            `Complete o briefing da task "${intent.taskName}". Responda SÓ com linhas "Campo: valor" para o que você souber de fato sobre: objetivo, público, oferta, mensagem principal, entregáveis, critérios de aprovação. Não invente: omita o campo que não souber.`,
          )
          .catch(() => null);
        if (extra) {
          const { extractLabeledFacts, mergeFacts } = await import('./briefing-facts');
          const novosFatos = mergeFacts(contexto.facts, extractLabeledFacts(extra, 'complemento do agente'));
          composto = composeBriefing({
            taskName: intent.taskName,
            clientName: params.clientName ?? null,
            deliveryType,
            facts: novosFatos,
            references: contexto.references,
            requestedBy: params.userName,
            dueDateLabel: prazoLabel,
            assignee: assigneeLabel,
            requestSummary: resumoDoPedido(params.message),
          });
          briefingEvaluation = evaluateBriefing(composto, { clientName: params.clientName ?? null });
        }
      }

      const briefing: string = composto.markdown;
      record(
        'guard.briefing_quality',
        `tipo=${deliveryType} score=${briefingEvaluation.score} executável=${briefingEvaluation.executable} rec=${briefingEvaluation.recommendation}`,
        briefingEvaluation.executable,
      );
      // briefingInvalido sempre deixa `briefing` preenchido (fallback ou texto válido).
      const briefingFinal = briefing ?? '';
      if (!briefingFinal) {
        record('guard.briefing_skip', 'sem conteúdo válido pra anexar', false);
      } else {
        await createTaskComment(config, created.id, briefingFinal);
        record('clickup.create_comment', `briefing -> ${created.id}`, true);
        briefingAttached = true;
      }
    }

    // READ-BACK (seções 32, 59): relê a task criada e confere nome, responsável,
    // prazo e (quando houve briefing) a presença do comentário, ANTES de dizer
    // "validada". É o que torna o recibo uma afirmação verificada, não uma
    // promessa que confia na resposta do POST.
    const expected: ExpectedTaskState = {
      name: intent.taskName,
      ...(assigneeMemberId != null ? { assigneeIds: [assigneeMemberId] } : {}),
      ...(intent.dueDate ? { dueDate: intent.dueDate, dueDateGranularity: 'day' as const } : {}),
    };
    const verif = await readBackVerify(config, created.id, expected);
    // ASSERÇÃO DE LISTA (pós-create): a task nasceu MESMO na lista do cliente
    // resolvido? Sem isto o recibo dizia "criada" sem saber onde.
    let listaConfere = true;
    try {
      const listaReal = await getTaskListId(config, created.id);
      listaConfere = listaReal === listId;
      record('clickup.assert_list', `lista ${listaReal} esperada ${listId}`, listaConfere);
    } catch {
      listaConfere = false;
      record('clickup.assert_list', 'não consegui reler a lista da task', false);
    }
    record('clickup.get_task', `read-back ${created.id}`, verif?.ok ?? false, verif == null ? 'não consegui reler' : verif.mismatches.join('; ') || undefined);

    let commentVerified = false;
    if (briefingAttached) {
      const comments = await getTaskComments(config, created.id).catch(() => []);
      commentVerified = comments.length > 0;
      record('clickup.get_comments', `read-back comments ${created.id}`, commentVerified);
    }

    const header =
      verif == null
        ? 'Task criada no ClickUp (não consegui reler pra confirmar os campos):'
        : verif.ok
          ? `Task criada e VERIFICADA no ClickUp (reli a task e confirmei: ${verif.checked.join(', ')}):`
          : 'Task criada no ClickUp, mas a verificação por leitura apontou divergência:';
    const lines = [
      header,
      `"${intent.taskName}"`,
      `Link: ${created.url}`,
      assigneeLabel ? `Responsável: ${assigneeLabel}` : null,
      intent.dueDate ? `Prazo: ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate))}` : null,
      briefingAttached
        ? commentVerified
          ? 'Briefing: anexado e confirmado como comentário na task'
          : 'Briefing: enviado, mas não consegui reconfirmar por leitura'
        : null,
      verif && !verif.ok ? `ATENÇÃO: ${verif.mismatches.join('; ')}` : null,
    ].filter(Boolean);

    return guardResponse({
      ok: true,
      toolCalls,
      answer: lines.join('\n'),
      metadata: {
        guard: 'bento-action',
        action: 'create_task',
        task_id: created.id,
        // Observabilidade do portão (§13): dá pra auditar POR QUE a escrita
        // foi autorizada e ONDE ela caiu.
        intent_classification: acao.kind,
        write_authorized: true,
        write_reason: acao.reason,
        analysis_required_first: acao.requiresAnalysisFirst,
        client_resolution: alvo.status,
        resolved_client_id: alvo.clientId,
        resolved_clickup_list_id: listId,
        list_assertion_ok: listaConfere,
        title_source: intent.taskName === tituloOperacional ? 'operational' : 'explicit',
        assignee: assigneeLabel,
        briefing_attached: briefingAttached,
        // Qualidade do briefing no trace: anexar não é entregar, e sem isto
        // a auditoria não distingue briefing executável de texto de enfeite.
        ...(briefingEvaluation
          ? {
              briefing_quality: {
                executable: briefingEvaluation.executable,
                score: briefingEvaluation.score,
                recommendation: briefingEvaluation.recommendation,
                missing_critical: briefingEvaluation.missingCritical,
                generic_sections: briefingEvaluation.genericSections,
                dimensions: briefingEvaluation.dimensions,
                sources_consulted: briefingSources,
                revisions: briefingRevisions,
              },
            }
          : {}),
        verified: verif?.ok ?? false,
        verification_mismatches: verif?.mismatches ?? [],
        comment_verified: commentVerified,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record('clickup.create_task', intent.taskName, false, detail);
    return guardResponse({
      ok: false,
      toolCalls,
      answer: `Não consegui criar a task no ClickUp: ${detail}`,
      metadata: { guard: 'bento-action', action: 'create_task' },
    });
  }
}
