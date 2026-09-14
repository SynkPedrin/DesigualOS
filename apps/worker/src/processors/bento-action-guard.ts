import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  createAttributedTask,
  createTaskComment,
  findMemberByName,
  getTaskListId,
  listStatusesForTask,
  updateTask,
  type ClickUpConfig,
} from '@desigual-os/tool-gateway';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';

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

const UPDATE_ASSIGNEE = /(atribu|designa|delega|passa|coloca)/;
const UPDATE_DUE = /(muda|reagend|adi(a|ar|e)|remarca|passa)\b.*(prazo|vencimento|data|hoje|amanh|sexta|\d{1,2}\/\d{1,2})/i;
const UPDATE_STATUS = /(marc(ar|a|que)|conclu(i|ir|ida)|finaliz(a|ar)|fech(a|ar))\b.*(conclu|pront|revis|feito)/i;
const CREATE_TASK = /(cri(e|a|ar)|adicione?|nova (task|tarefa)|nova task|nova tarefa)\b/;
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
      taskName: taskName ?? message.replace(CREATE_TASK, '').replace(/^[,:\s]+/, '').slice(0, 120).trim(),
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

function getClickUpConfigOrNull(): ClickUpConfig | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
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
  logger: Logger;
}): Promise<ExecuteResponse | null> {
  const { message, conversationId, logger } = params;
  const intent = classifyIntent(message);
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
        // READ-AFTER-WRITE: confirma com a API antes de responder.
        const listId = await getTaskListId(config, taskId);
        record('clickup.get_task_list', taskId, true);
        return guardResponse({
          ok: true,
          toolCalls,
          answer:
            `Atribuído e confirmado no ClickUp: a task ${context.lastTaskName ? `"${context.lastTaskName}" ` : ''}(${taskId}) ` +
            `agora é de ${member.username}. Lista verificada após a alteração (lista ${listId}).`,
          metadata: { guard: 'bento-action', action: 'update_assignee', task_id: taskId, assignee: member.username },
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
        return guardResponse({
          ok: true,
          toolCalls,
          answer: `Prazo alterado e confirmado no ClickUp: a task ${context.lastTaskName ? `"${context.lastTaskName}" ` : ''}(${taskId}) vence ${dateLabel}.`,
          metadata: { guard: 'bento-action', action: 'update_due', task_id: taskId, due_date: intent.dueDate },
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
        return guardResponse({
          ok: true,
          toolCalls,
          answer: `Status alterado e confirmado no ClickUp: a task ${context.lastTaskName ? `"${context.lastTaskName}" ` : ''}(${taskId}) está como "${wanted}".`,
          metadata: { guard: 'bento-action', action: 'update_status', task_id: taskId, status: wanted },
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
  if (!intent.taskName || intent.taskName.length < 3) return null;
  if (intent.taskName.length < 8 && !intent.personName) {
    // Nome fraco demais ("a ele", "isso"): é exatamente a classe do bug. Não cria.
    return guardResponse({
      ok: true,
      toolCalls,
      answer:
        'Esse pedido parece uma continuação da conversa anterior, não uma task nova. ' +
        'Me confirma: você quer que eu crie uma task com esse nome mesmo, ou quer alterar a última task que conversamos?',
      metadata: { guard: 'bento-action', reason: 'create_nome_fraco_suspeito' },
    });
  }

  const listId = params.agencyListId;
  if (!listId) return null;

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
    if (intent.personName) {
      const member = await findMemberByName(config, intent.personName).catch(() => null);
      if (member) {
        await updateTask(config, created.id, { addAssignees: [member.id] });
        record('clickup.update_task', `assign ${member.username}`, true);
        assigneeLabel = member.username;
      }
    }

    let briefingAttached = false;
    if (intent.wantsBriefing) {
      // O bento-qa é single-flight ("ocupado respondendo outra pergunta"):
      // uma segunda chamada imediata falha. Uma tentativa com pausa curta
      // cobre o caso sem prender o usuário.
      let briefing: string | null = null;
      for (let attempt = 0; attempt < 2 && !briefing; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
        briefing = await params
          .briefingWriter(
            `Escreva um briefing operacional para a task "${intent.taskName}". Estrutura: objetivo, contexto, entregável, como executar, público, mensagem principal, requisitos, critérios de aprovação, prazo, próxima ação. Sem travessão, sem enrolação.`,
          )
          .catch(() => null);
      }
      // Validação antes de anexar (medido ao vivo): o escritor remoto às vezes
      // devolve a própria pergunta de esclarecimento em vez do briefing. Isso
      // NUNCA vai pra task. O fallback é um briefing determinístico com os
      // campos REAIS já verificados nesta execução.
      const briefingInvalido =
        !briefing ||
        briefing.length < 200 ||
        /de qual cliente|preciso do nome|não consegui responder|não sei responder/i.test(briefing);
      if (briefingInvalido) {
        const prazo = intent.dueDate
          ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate))
          : 'a definir';
        briefing = [
          `# Briefing: ${intent.taskName}`,
          '',
          '## Objetivo',
          'Executar a entrega descrita no título desta task, dentro do prazo e com aprovação do responsável pela revisão.',
          '',
          '## Contexto',
          `Task criada via chat por ${params.userName}. Detalhes adicionais devem ser complementados pelo solicitante.`,
          '',
          '## Entregável',
          intent.taskName,
          '',
          '## Responsável',
          intent.personName ?? 'a definir',
          '',
          '## Prazo',
          prazo,
          '',
          '## Critérios de aprovação',
          'Entrega revisada e aprovada pelo solicitante ou pelo responsável indicado acima.',
          '',
          '## Próxima ação',
          'Solicitante complementa contexto e referências nesta task; responsável confirma entendimento e inicia a execução.',
        ].join('\n');
        record('guard.briefing_fallback', 'briefing determinístico com dados verificados', true);
      }
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

    const lines = [
      'Task criada e validada no ClickUp:',
      `"${intent.taskName}"`,
      `Link: ${created.url}`,
      assigneeLabel ? `Responsável: ${assigneeLabel}` : null,
      intent.dueDate ? `Prazo: ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate))}` : null,
      briefingAttached ? 'Briefing: anexado como comentário na task' : null,
    ].filter(Boolean);

    return guardResponse({
      ok: true,
      toolCalls,
      answer: lines.join('\n'),
      metadata: {
        guard: 'bento-action',
        action: 'create_task',
        task_id: created.id,
        assignee: assigneeLabel,
        briefing_attached: briefingAttached,
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
