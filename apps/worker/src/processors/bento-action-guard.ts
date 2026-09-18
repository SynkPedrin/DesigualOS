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
import { buildDeliverableTitle, buildOperationalTitle, resolveWriteTarget } from './write-target';
import { buildOperationalActionPlan } from './operational-action-plan';
import { createManyTasks, type CreateOneInput, type CreateOutcome } from './multi-create-executor';

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

/** Intenção de criação montada dos mesmos extratores, sem exigir o verbo "criar". */
function criacaoPadrao(message: string): GuardIntent {
  return {
    kind: 'create',
    taskName: extractTaskName(message) ?? '',
    personName: extractPersonName(message),
    dueDate: DUE_TOMORROW.test(message)
      ? endOfDay(addDays(new Date(), 1)).getTime()
      : DUE_TODAY.test(message)
        ? endOfDay(new Date()).getTime()
        : null,
    wantsBriefing: BRIEFING_ASK.test(message) || ATTACH_ASK.test(message),
  };
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

  // HARD DENY. Concluir/fechar trabalho humano não é uma permissão que alguém
  // possa ligar: o Bento não sabe se o designer terminou o layout, e um status
  // "pronto" que ninguém verificou faz a operação inteira planejar em cima de
  // uma mentira. A recusa é curta, diz o que ELE pode fazer e para por aí.
  if (acao.kind === 'FORBIDDEN_ACTION') {
    logger.info(
      { intent_classification: acao.kind, write_authorized: false, write_reason: acao.reason },
      '[guard] ação proibida: concluir/fechar trabalho humano'
    );
    return guardResponse({
      ok: true,
      toolCalls: [],
      answer:
        'Não marco trabalho de pessoa como concluído — não tenho como saber se ficou pronto, e um status errado aí atrapalha todo mundo que planeja em cima dele. ' +
        'Quem entregou pode fechar, ou você me confirma e eu registro num comentário. Organizar, comentar, atribuir e criar demanda eu faço na hora.',
      metadata: {
        guard: 'bento-action',
        action: 'denied_forbidden',
        intent_classification: acao.kind,
        write_authorized: false,
        write_reason: acao.reason,
      },
    });
  }

  if (!acao.writeAuthorized) {
    logger.info(
      { intent_classification: acao.kind, write_authorized: false, write_reason: acao.reason },
      '[guard] pedido sem autorização de escrita; segue para análise'
    );
    // null = segue pro agente, que ANALISA e responde. Nenhuma escrita aqui.
    return null;
  }

  /**
   * A classificação fina só escolhe ENTRE as formas de escrita; o portão 1 já
   * decidiu QUE é escrita. Quando ela não reconhece a forma, o default é
   * CRIAR — e isso é o oposto de um regex solto, porque nada chega aqui sem
   * ordem explícita.
   *
   * Sem esta linha, metade do vocabulário real da operação morria no segundo
   * classificador depois de passar no primeiro: "separa essa demanda", "faz o
   * briefing", "lança isso no ClickUp" e "essa fica pra Sofia" todas voltavam
   * `none` e o turno virava análise de novo — o mesmo sintoma, um andar abaixo.
   */
  const intent = classifyIntent(message).kind === 'none' ? criacaoPadrao(message) : classifyIntent(message);
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

  // -------- CREATE (uma ou várias) --------
  // A ORDEM aqui é a regra: resolver cliente -> planejar as tasks -> titular ->
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
        ? `Não consegui identificar com segurança a lista do cliente: mais de um cliente casa com o que você escreveu (${alvo.candidates.join(', ')}). Me diz qual é que eu crio lá.`
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

  // PLANO DE AÇÃO: quantas tasks o pedido realmente contém, e de quem é cada
  // uma. Uma mensagem pode despachar dois entregáveis pra duas pessoas; tratar
  // isso como uma criação só era entregar metade e relatar tudo.
  const plano = buildOperationalActionPlan(params.message);
  const clientName = alvo.clientName ?? params.clientName ?? null;

  // BRIEFING: obrigatório quando há material colado pra organizar. É o que
  // transforma "separa a demanda" em instrução executável dentro da task, em
  // vez de um título solto que manda a pessoa voltar no chat.
  const querBriefing = intent.wantsBriefing || plano.items.length > 0 || plano.splitRequested || resumoDoPedido(params.message).length > 180;

  const entradas: CreateOneInput[] = [];
  for (const t of plano.tasks) {
    const titulo =
      t.deliverable !== null
        ? buildDeliverableTitle({ deliverable: t.deliverable, items: plano.items, clientName })
        : buildOperationalTitle({ message: params.message, explicitName: intent.taskName || null, clientName });
    if (titulo.trim().length < 6) continue;
    entradas.push({
      planned: t,
      title: titulo,
      briefing: null,
      description: descricaoDaTask({
        requesterName: params.userName,
        excerpt: t.excerpt,
        items: plano.items,
        pendencies: plano.pendencies,
      }),
      dueDate: intent.dueDate,
    });
  }

  if (entradas.length === 0) {
    return guardResponse({
      ok: true,
      toolCalls,
      answer: 'Não consegui montar um título operacional claro pra essa demanda. Me diz em uma frase o que precisa ser feito que eu crio.',
      metadata: { guard: 'bento-action', reason: 'titulo_insuficiente', write_authorized: false },
    });
  }

  // BRIEFING POR FATO (não por template): recupera contexto real do cliente,
  // monta a estrutura do TIPO de entrega e DECLARA o que falta. O template
  // fixo anterior anexava "Executar a entrega descrita no título desta task" —
  // passava no read-back e era inútil pra quem ia executar.
  let briefingEvaluation: ReturnType<typeof evaluateBriefing> | null = null;
  let briefingSources: string[] = [];
  if (querBriefing) {
    const contexto = await retrieveBriefingContext({
      clientId: alvo.clientId ?? params.clientId ?? null,
      requestText: params.message,
      taskId: null,
      config,
    }).catch(() => ({ facts: [], references: [], sourcesConsulted: [] as string[] }));
    briefingSources = contexto.sourcesConsulted;
    const prazoLabel = intent.dueDate
      ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate))
      : null;

    for (const entrada of entradas) {
      const deliveryType = classifyDeliveryType(params.message, entrada.title);
      const composto = composeBriefing({
        taskName: entrada.title,
        clientName,
        deliveryType,
        facts: contexto.facts,
        references: contexto.references,
        requestedBy: params.userName,
        dueDateLabel: prazoLabel,
        assignee: entrada.planned.assigneeName,
        requestSummary: resumoDoPedido(params.message),
      });
      briefingEvaluation = evaluateBriefing(composto, { clientName });
      entrada.briefing = [composto.markdown, blocoDePendencias(plano.items, plano.pendencies)].filter(Boolean).join('\n\n');
      record('guard.briefing_quality', `tipo=${deliveryType} score=${briefingEvaluation.score} executável=${briefingEvaluation.executable}`, briefingEvaluation.executable);
    }
  }

  const resultados = await createManyTasks(
    config,
    listId,
    { name: params.userName, clickUpEmail: params.userClickUpEmail },
    entradas,
  );
  for (const r of resultados) {
    for (const tc of r.toolCalls) record(tc.tool, tc.input_summary, tc.ok, tc.error);
  }

  const criadas = resultados.filter((r) => r.status === 'created');
  const duplicadas = resultados.filter((r) => r.status === 'duplicate');
  const bloqueadas = resultados.filter((r) => r.status === 'blocked');
  const falhas = resultados.filter((r) => r.status === 'failed');

  logger.info(
    {
      intent_classification: acao.kind,
      action_plan_count: entradas.length,
      client_resolution: alvo.status,
      resolved_client_id: alvo.clientId,
      resolved_clickup_list_id: listId,
      created: criadas.length,
      duplicate: duplicadas.length,
      blocked: bloqueadas.length,
      failed: falhas.length,
      readback_ok: criadas.filter((r) => r.verified).length,
    },
    '[guard] ciclo de criação concluído',
  );

  return guardResponse({
    // Só é falha quando NADA saiu. Uma de duas criadas é execução parcial, e a
    // resposta conta as duas coisas — o que existe e o que ficou pendente.
    ok: criadas.length > 0 || duplicadas.length > 0 || bloqueadas.length > 0,
    toolCalls,
    answer: reciboHumano({ resultados, clientName, pendencies: plano.pendencies }),
    metadata: {
      guard: 'bento-action',
      action: 'create_tasks',
      intent_classification: acao.kind,
      write_authorized: true,
      write_reason: acao.reason,
      analysis_required_first: acao.requiresAnalysisFirst,
      client_resolution: alvo.status,
      resolved_client_id: alvo.clientId,
      resolved_clickup_list_id: listId,
      action_plan_count: entradas.length,
      split_requested: plano.splitRequested,
      pendencies: plano.pendencies,
      tasks: resultados.map((r) => ({
        task_id: r.taskId,
        title: r.title,
        deliverable: r.deliverable,
        status: r.status,
        assignee: r.assigneeUsername,
        assignee_requested: r.assigneeName,
        blocked_by: r.blockedBy,
        candidates: r.candidates,
        verified: r.verified,
        list_assertion_ok: r.listAsserted,
        briefing_attached: r.briefingAttached,
        briefing_verified: r.briefingVerified,
        mismatches: r.mismatches,
        error: r.error,
      })),
      ...(briefingEvaluation
        ? {
            briefing_quality: {
              executable: briefingEvaluation.executable,
              score: briefingEvaluation.score,
              recommendation: briefingEvaluation.recommendation,
              missing_critical: briefingEvaluation.missingCritical,
              sources_consulted: briefingSources,
            },
          }
        : {}),
    },
  });
}

/** Descrição da task: a situação que originou a demanda, os itens e o que falta. */
function descricaoDaTask(params: {
  requesterName: string;
  excerpt: string;
  items: string[];
  pendencies: string[];
}): string {
  const linhas = [`Criada via chat por ${params.requesterName}.`, '', `Pedido: ${params.excerpt}`];
  if (params.items.length > 0) {
    linhas.push('', 'Itens da solicitação:', ...params.items.map((i) => `- ${i}`));
  }
  if (params.pendencies.length > 0) {
    linhas.push('', 'PENDÊNCIAS (não bloqueiam a organização da demanda):', ...params.pendencies.map((p) => `- ${p}`));
  }
  return linhas.join('\n');
}

/**
 * Bloco de pendência do briefing. Existe separado do briefing padrão porque a
 * pendência é o que muda o comportamento de quem executa: a pessoa precisa
 * saber que pode começar e o que ainda vai chegar.
 */
function blocoDePendencias(items: string[], pendencies: string[]): string {
  if (items.length === 0 && pendencies.length === 0) return '';
  const linhas: string[] = [];
  if (items.length > 0) linhas.push('## Itens da solicitação', ...items.map((i) => `- ${i}`));
  if (pendencies.length > 0) {
    linhas.push('', '## Pendências', ...pendencies.map((p) => `- ${p}`), '', 'A demanda pode ser organizada e iniciada; a execução final depende do material acima.');
  }
  return linhas.join('\n');
}

/**
 * RECIBO EM PORTUGUÊS. Diz o que existe no ClickUp e o que ficou pendente, sem
 * expor id de lista, id de execução ou nome de ferramenta. O que a pessoa
 * precisa saber é o que foi feito e o que depende dela.
 */
function reciboHumano(params: {
  resultados: CreateOutcome[];
  clientName: string | null;
  pendencies: string[];
}): string {
  const { resultados, clientName } = params;
  const criadas = resultados.filter((r) => r.status === 'created');
  const duplicadas = resultados.filter((r) => r.status === 'duplicate');
  const bloqueadas = resultados.filter((r) => r.status === 'blocked');
  const falhas = resultados.filter((r) => r.status === 'failed');
  const onde = clientName ? ` na ${clientName}` : '';
  const linhas: string[] = [];

  if (criadas.length > 0) {
    const verificadas = criadas.filter((r) => r.verified);
    linhas.push(
      verificadas.length === criadas.length
        ? `Separei a demanda e criei ${criadas.length === 1 ? 'a task' : `${criadas.length} tasks`}${onde}. Reli cada uma no ClickUp pra confirmar:`
        : `Criei ${criadas.length === 1 ? 'a task' : `${criadas.length} tasks`}${onde}, mas a releitura apontou divergência em ${criadas.length - verificadas.length}:`,
    );
    for (const r of criadas) {
      const dono = r.assigneeUsername ? ` — responsável: ${r.assigneeUsername}` : ' — sem responsável definido';
      const brief = r.briefingAttached ? (r.briefingVerified ? ', com briefing anexado' : ', briefing enviado mas não reconfirmado') : '';
      const ressalva = r.verified ? '' : ` (ATENÇÃO: ${r.mismatches.join('; ')})`;
      linhas.push(`- "${r.title}"${dono}${brief}${ressalva}\n  ${r.url}`);
    }
  }

  if (duplicadas.length > 0) {
    linhas.push('', 'Já existia e eu não dupliquei:');
    for (const r of duplicadas) linhas.push(`- "${r.title}" — ${r.url}`);
  }

  if (bloqueadas.length > 0) {
    linhas.push('', 'Não criei estas, e o motivo é só um:');
    for (const r of bloqueadas) {
      if (r.blockedBy === 'PERSON_AMBIGUOUS') {
        linhas.push(`- "${r.title}": "${r.assigneeName}" casa com mais de uma pessoa (${r.candidates.join(', ')}). Me diz qual delas é que eu crio.`);
      } else if (r.blockedBy === 'PERSON_NOT_FOUND') {
        linhas.push(`- "${r.title}": não encontrei "${r.assigneeName}" entre os membros do ClickUp. O briefing já está pronto; preciso só saber quem recebe.`);
      } else {
        linhas.push(`- "${r.title}": ${r.error ?? 'bloqueada'}`);
      }
    }
  }

  if (falhas.length > 0) {
    linhas.push('', 'O ClickUp recusou a operação nestas, e eu não alterei nada lá:');
    for (const r of falhas) linhas.push(`- "${r.title}": ${r.error ?? 'falha na escrita'}`);
  }

  if (params.pendencies.length > 0 && criadas.length > 0) {
    linhas.push('', `Deixei sinalizado na task o que ainda falta: ${params.pendencies.join('; ')}.`);
  }

  return linhas.join('\n');
}
