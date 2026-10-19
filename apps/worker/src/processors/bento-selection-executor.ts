import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  createTaskComment,
  getTask,
  getTaskComments,
  resolveMemberByName,
  updateTask,
  type ClickUpConfig,
} from '@desigual-os/tool-gateway';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import {
  resolveSelectionReference,
  type SelectedTaskRef,
  type SelectionReference,
  type SelectionSnapshot,
} from '@desigual-os/context-engine';
import { classifyDeliveryType, composeBriefing, pendingCriticalFields } from './briefing-composer';
import { extractLabeledFacts, mergeFacts } from './briefing-facts';
import { retrieveBriefingContext } from './briefing-retrieval';
import {
  answerFromExecutionState,
  loadLatestExecutionState,
  sameExecutionAlreadyDone,
  type ExecutionRecord,
} from './execution-record';

/**
 * bento-selection-executor.ts — MUTAÇÃO SOBRE O CONJUNTO SELECIONADO.
 *
 * O caso que isto executa (medido ao vivo em 24/09/2026): depois de "me liste
 * todas as tasks q vencem hoje" (10 tasks), o pedido "crie um briefing
 * detalhado de cada uma delas e lança pro Pedro" perdia o conjunto e caía numa
 * consulta global de 1209 tasks — e nenhuma mutação acontecia de verdade.
 *
 * Contrato aqui:
 *   1. o alvo é EXATAMENTE a seleção persistida (ou o subconjunto que a
 *      referência resolve: "só as urgentes", "a segunda");
 *   2. a mutação real acontece por task (briefing em comentário, atribuição);
 *   3. cada escrita é RELIDA (read-back) antes de entrar como sucesso;
 *   4. o resultado estruturado (executionId, successIds, failedIds, evidência)
 *      vai na metadata — é ele que responde "já lançou?" no turno seguinte;
 *   5. a MESMA operação já confirmada sobre o MESMO conjunto não executa de
 *      novo: duplicar mutação é falha dura.
 */

export interface SelectionMutationParams {
  message: string;
  config: ClickUpConfig;
  selection: SelectionSnapshot;
  reference: SelectionReference;
  /** Pediu briefing ("crie um briefing de cada uma"). */
  withBriefing: boolean;
  /** Pediu despacho/atribuição ("lança pro Pedro", "atribui essas"). */
  wantsAssign: boolean;
  /** Pessoa extraída pelo caminho estrito do guard (pode ser null). */
  personName: string | null;
  userName: string;
  userEmail: string | null;
  conversationId: string | null;
  /** Autorização por task (mesma regra do guard: falha fechada). */
  authorizeTask: (taskId: string) => Promise<'match' | 'mismatch' | 'unknown'>;
  /** Portão de produção por cliente da task (QA bot só escreve no cliente de QA). */
  mayWriteForClient: (clientName: string | null) => boolean;
  briefingWriter: (prompt: string) => Promise<string | null>;
  logger: Logger;
}

interface TaskOutcome {
  taskId: string;
  title: string;
  clientName: string | null;
  briefingCommentId: string | null;
  briefingVerified: boolean;
  assigneeVerified: boolean;
  ok: boolean;
  error: string | null;
}

/**
 * "lança pro pedro" — minúsculo, como a operação escreve. O extrator estrito
 * do guard exige maiúscula (é o que separa nome próprio de preposição), então
 * AQUI, onde a seleção já provou que a frase é despacho, vale a leitura
 * solta: quem confirma que é pessoa de verdade é o registro de membros do
 * ClickUp, não a caixa da letra.
 */
const PESSOA_SOLTA = /(?<![a-zà-ú])(?:pro|pra|para|ao|à|com(?:\s+[oa])?|a)\s+([a-záàâãéêíóôõúç][a-záàâãéêíóôõúç]*(?:\s+[a-záàâãéêíóôõúç]+){0,2})/gi;
const NAO_PESSOA = new Set([
  'clickup', 'hoje', 'amanha', 'amanhã', 'ontem', 'task', 'tasks', 'tarefa', 'tarefas', 'lista', 'listas',
  'operacao', 'operação', 'agencia', 'agência', 'mim', 'nos', 'nós', 'frente', 'cima', 'baixo', 'depois',
  'antes', 'semana', 'mesa', 'todo', 'toda', 'todos', 'todas', 'briefing', 'produção', 'producao',
  // Pronomes, dêiticos, conjunções e ordinais que grudam na captura: "cada uma
  // DELAS E lança pro pedro" extraía "delas e" como pessoa (achado no aceite
  // ao vivo, 24/09/2026) e "atribui a SEGUNDA pro Gui" pegaria o ordinal.
  'ela', 'elas', 'ele', 'eles', 'isso', 'essa', 'esse', 'estas', 'estes', 'dela', 'delas', 'dele', 'deles',
  'dessa', 'dessas', 'desse', 'desses', 'nessa', 'nessas', 'nesse', 'nesses', 'desta', 'deste', 'cada',
  'e', 'ou', 'nem', 'que', 'com', 'sem',
  'primeira', 'primeiro', 'segunda', 'segundo', 'terceira', 'terceiro', 'quarta', 'quarto', 'quinta', 'quinto',
  'sexta', 'sexto', 'setima', 'sétima', 'setimo', 'sétimo', 'oitava', 'oitavo', 'nona', 'nono', 'decima', 'décima',
  'ultima', 'última', 'ultimo', 'último',
  'no', 'na', 'em', 'o', 'a', 'um', 'uma', 'pro', 'pra', 'para', 'ao', 'à', 'do', 'da', 'de',
]);

export function extractPersonNameLoose(message: string): string | null {
  const t = message.split(/\n-{3,}\n/)[0] ?? message;
  const limpa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const m of t.matchAll(PESSOA_SOLTA)) {
    // A captura pode engolir o começo do DESTINO real ("a elas pro pedro"):
    // corta stopwords das DUAS pontas — o que sobra no meio é o nome.
    const palavras = (m[1]?.trim() ?? '').split(/\s+/).filter(Boolean);
    while (palavras.length > 0 && NAO_PESSOA.has(limpa(palavras.at(-1)!))) palavras.pop();
    while (palavras.length > 0 && NAO_PESSOA.has(limpa(palavras[0]!))) palavras.shift();
    if (palavras.length === 0) continue;
    return palavras.join(' ');
  }
  return null;
}

async function clientIdPorLista(listIds: string[]): Promise<Map<string, { id: string; name: string }>> {
  const mapa = new Map<string, { id: string; name: string }>();
  if (listIds.length === 0) return mapa;
  const rows = await db
    .select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(inArray(schema.clients.clickupListId, listIds))
    .catch(() => []);
  for (const row of rows) if (row.clickupListId) mapa.set(row.clickupListId, { id: row.id, name: row.name });
  return mapa;
}

function formatPrazo(ms: number | null): string | null {
  if (!ms) return null;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
}

/**
 * Briefing por FATO, reusando o mesmo pipeline da criação de task (retrieval
 * real do cliente + composição com lacunas declaradas). O gap-fill por LLM só
 * preenche o que o PRÓPRIO pedido determina — nunca inventa dado de cliente.
 */
async function briefingDaTask(params: SelectionMutationParams, task: SelectedTaskRef, clientId: string | null, assigneeName: string | null): Promise<string> {
  const pedido = `${params.message}\n\nTask: ${task.title}`;
  const contexto = await retrieveBriefingContext({ clientId, requestText: pedido, taskId: task.id, config: params.config }).catch(
    () => ({ facts: [], references: [], sourcesConsulted: [] as string[] }),
  );
  const composeInput = {
    taskName: task.title,
    clientName: task.clientName,
    deliveryType: classifyDeliveryType(params.message, task.title),
    facts: contexto.facts,
    references: contexto.references,
    requestedBy: params.userName,
    requestSummary: `Briefing detalhado da task "${task.title}" (${params.selection.reasonLabel}), pedido por ${params.userName} no chat.`,
    dueDateLabel: formatPrazo(task.dueDate),
    assignee: assigneeName ?? (task.assignees[0] ?? null),
  };
  let composto = composeBriefing(composeInput);
  const lacunas = pendingCriticalFields(composeInput);
  if (lacunas.length > 0) {
    const molde = lacunas.map((l) => `${l.key}: `).join('\n');
    const resposta = await params
      .briefingWriter(
        [
          'Leia o PEDIDO abaixo. Preencha o MOLDE copiando ou parafraseando SÓ o que o pedido determina explicitamente — nunca invente, nunca deduza além do que está escrito.',
          'Regras: responda usando EXATAMENTE as chaves do molde, uma por linha, "chave: valor". Se o pedido não determinar aquele campo, apague a linha inteira dele — não deixe "chave:" vazio, não escreva "não informado".',
          '',
          `MOLDE:\n${molde}`,
          '',
          `PEDIDO: ${pedido}`,
        ].join('\n'),
      )
      .catch(() => null);
    if (resposta) {
      const interpretados = extractLabeledFacts(resposta, 'pedido do usuário (interpretado)');
      if (interpretados.length > 0) {
        composto = composeBriefing({ ...composeInput, facts: mergeFacts(composeInput.facts, interpretados) });
      }
    }
  }
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  return `BRIEFING (gerado pelo Bento a pedido de ${params.userName} em ${data}):\n\n${composto.markdown}`;
}

export async function executeSelectionMutation(params: SelectionMutationParams): Promise<ExecuteResponse> {
  const { config, selection, logger } = params;
  const toolCalls: { tool: string; input_summary: string; ok: boolean; duration_ms: number; error?: string }[] = [];
  const startedAt = performance.now();
  const record = (tool: string, input: string, ok: boolean, error?: string) => {
    toolCalls.push({ tool, input_summary: input, ok, duration_ms: Math.round(performance.now() - startedAt), ...(error ? { error } : {}) });
  };
  const respond = (answer: string, ok: boolean, metadata: Record<string, unknown>): ExecuteResponse => ({
    execution_id: '',
    agent: 'bento',
    status: ok ? 'completed' : 'failed',
    answer,
    sources: [],
    tool_calls: toolCalls,
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(ok ? {} : { error: answer }),
    metadata,
  });

  // 1. O ALVO É A SELEÇÃO — ou o subconjunto que a referência resolve.
  let reference = params.reference;
  let withBriefing = params.withBriefing;
  let wantsAssign = params.wantsAssign;
  let personName = params.personName;
  let alvoRest: SelectedTaskRef[] | null = null;

  /**
   * REPETIÇÃO ("faz o mesmo nas outras"): a operação e a pessoa vêm do
   * REGISTRO da última execução, nunca de reparsear a conversa. "Nas outras"
   * é o conjunto MENOS o que já foi confirmado — repetir o que já saiu seria
   * mutação duplicada.
   */
  if (reference.kind === 'repeat') {
    const anterior = params.conversationId ? await loadLatestExecutionState(params.conversationId).catch(() => null) : null;
    if (anterior?.kind !== 'executed' || anterior.record.successIds.length === 0) {
      return respond(
        'Não encontrei uma operação executada nesta conversa pra repetir. Me diz o que fazer com elas (briefing? atribuir?) que eu faço.',
        true,
        { guard: 'bento-action', action: 'repeat_sem_operacao_anterior', write_authorized: false },
      );
    }
    const rec = anterior.record;
    withBriefing = rec.operation === 'briefing_assign' || rec.operation === 'briefing';
    wantsAssign = rec.targetPerson !== null;
    personName = rec.targetPerson?.username ?? null;
    if (reference.scope === 'rest') {
      const feitos = new Set(rec.successIds);
      const restantes = selection.tasks.filter((t) => !feitos.has(t.id));
      if (restantes.length === 0) {
        return respond(answerFromExecutionState(anterior, params.message), true, {
          guard: 'bento-action',
          action: 'selection_mutation_idempotent',
          write_authorized: false,
          execucao: rec,
        });
      }
      alvoRest = restantes;
    }
    reference = reference.scope === 'focus' ? { kind: 'focus' } : { kind: 'all' };
  }

  const resolvida = alvoRest ? { tasks: alvoRest, newFocusTaskId: null } : resolveSelectionReference(selection, reference);
  if (!resolvida) {
    return respond(
      `A seleção atual tem ${selection.tasks.length} tasks (${selection.reasonLabel}). Essa referência não aponta pra nenhuma delas — me diga o número ou o nome dentro dessa lista. Não alterei nada.`,
      true,
      { guard: 'bento-action', action: 'selection_reference_unresolved', write_authorized: false, selection_reason: selection.reason },
    );
  }
  let alvo = resolvida.tasks;

  // 2. A PESSOA (quando o pedido é de despacho). O registro de membros decide.
  if (!withBriefing && !wantsAssign) {
    return respond(
      'Entendi que é sobre a seleção, mas não identifiquei o que fazer com ela (briefing? atribuir?). Não alterei nada.',
      true,
      { guard: 'bento-action', action: 'selection_operation_unclear', write_authorized: false },
    );
  }
  let member: { id: number; username: string } | null = null;
  if (wantsAssign) {
    personName = personName ?? extractPersonNameLoose(params.message);
    if (!personName) {
      return respond(
        `Entendi que é pra despachar ${alvo.length === 1 ? 'essa task' : `essas ${alvo.length} tasks`}, mas não identifiquei pra quem. Me diz o nome da pessoa que eu faço agora.`,
        true,
        { guard: 'bento-action', action: 'selection_assignee_missing', write_authorized: false },
      );
    }
    const resolucao = await resolveMemberByName(config, personName).catch(() => null);
    if (!resolucao || resolucao.status === 'not_found') {
      return respond(
        `Não encontrei "${personName}" entre os membros do ClickUp. Confere o nome pra mim? Não alterei nada.`,
        true,
        { guard: 'bento-action', action: 'assignee_nao_encontrado', write_authorized: false },
      );
    }
    /**
     * Achou UM parecido: pergunta antes de atribuir. Pedido da operação
     * (29/09/2026): "ele não achou o Gui, ele tem que perguntar — não encontrei
     * o Guilherme, achei o Gui, é ele?". Atribuir por semelhança de nome é o
     * tipo de acerto que ninguém confere e o tipo de erro que ninguém percebe.
     */
    if (resolucao.status === 'sugestao') {
      return respond(
        `Não encontrei "${personName}" no ClickUp. Achei "${resolucao.sugerido.username}" — é ele(a)? Se for, eu atribuo. Não alterei nada ainda.`,
        true,
        { guard: 'bento-action', action: 'assignee_sugestao', write_authorized: false },
      );
    }
    if (resolucao.status === 'ambiguous') {
      return respond(
        `"${personName}" casa com mais de uma pessoa no ClickUp (${resolucao.candidates.map((c) => c.username).join(', ')}). Me diz qual delas é que eu atribuo.`,
        true,
        { guard: 'bento-action', action: 'assignee_ambiguo', write_authorized: false },
      );
    }
    member = { id: resolucao.member.id, username: resolucao.member.username };
  }

  const operation = withBriefing && member ? 'briefing_assign' : withBriefing ? 'briefing' : 'assign';

  // 3. DUPLICATA NÃO EXECUTA. A mesma operação confirmada sobre o mesmo
  //    conjunto responde do registro — reescrever corrompe o histórico.
  if (params.conversationId) {
    const anterior = await loadLatestExecutionState(params.conversationId).catch(() => null);
    if (anterior?.kind === 'executed' && sameExecutionAlreadyDone(anterior.record, { operation, taskIds: alvo.map((t) => t.id), memberId: member?.id ?? null })) {
      logger.info({ operation, tasks: alvo.length }, '[seleção] mutação já executada e confirmada; respondendo do registro, sem reescrever');
      return respond(answerFromExecutionState(anterior, params.message), true, {
        guard: 'bento-action',
        action: 'selection_mutation_idempotent',
        write_authorized: false,
        execucao: anterior.record,
      });
    }
    if (anterior?.kind === 'executed' && anterior.record.operation === operation) {
      // Retomada honesta: refaz só o que FALHOU da última vez.
      const feitos = new Set(anterior.record.successIds);
      const mesmoAlvo = anterior.record.targetPerson?.memberId === (member?.id ?? null);
      if (mesmoAlvo && anterior.record.failedIds.length > 0) {
        const pendentes = alvo.filter((t) => !feitos.has(t.id));
        if (pendentes.length < alvo.length) {
          logger.info({ operation, pendentes: pendentes.length, total: alvo.length }, '[seleção] retomando só as tasks que falharam');
          alvo = pendentes;
        }
      }
    }
  }

  // 4. EXECUÇÃO POR TASK, com autorização por cliente e read-back por escrita.
  const listIds = [...new Set(alvo.map((t) => t.listId).filter((x): x is string => Boolean(x)))];
  const clientes = await clientIdPorLista(listIds);

  const outcomes: TaskOutcome[] = [];
  for (const task of alvo) {
    const outcome: TaskOutcome = {
      taskId: task.id,
      title: task.title,
      clientName: task.clientName,
      briefingCommentId: null,
      briefingVerified: false,
      assigneeVerified: false,
      ok: false,
      error: null,
    };
    outcomes.push(outcome);
    try {
      if (!params.mayWriteForClient(task.clientName)) {
        outcome.error = `escrita não autorizada neste cliente (${task.clientName ?? 'sem cliente'})`;
        record('guard.production_authz', task.id, false, outcome.error);
        continue;
      }
      const autorizacao = await params.authorizeTask(task.id);
      if (autorizacao !== 'match') {
        outcome.error = autorizacao === 'unknown' ? 'não consegui confirmar de qual cliente é essa task' : 'a task não pertence ao contexto autorizado';
        record('guard.task_client_authz', task.id, false, outcome.error);
        continue;
      }

      if (withBriefing) {
        const briefing = await briefingDaTask(params, task, (task.listId ? clientes.get(task.listId)?.id : null) ?? null, member?.username ?? null);
        const comentario = await createTaskComment(config, task.id, briefing);
        outcome.briefingCommentId = comentario.id;
        record('clickup.create_comment', `briefing +${briefing.length}c -> ${task.id}`, true);
        // READ-BACK do briefing: o comentário tem que aparecer na releitura.
        const comentarios = await getTaskComments(config, task.id).catch(() => []);
        outcome.briefingVerified = comentarios.some((c) => c.id === comentario.id);
        record('clickup.get_task_comments', `read-back briefing ${task.id}`, outcome.briefingVerified, outcome.briefingVerified ? undefined : 'comentário não apareceu na releitura');
      }

      if (member) {
        await updateTask(config, task.id, { addAssignees: [member.id] });
        record('clickup.update_task', `assign ${member.username} -> ${task.id}`, true);
        // READ-BACK da atribuição: o responsável tem que ESTAR na task relida.
        const relida = await getTask(config, task.id).catch(() => null);
        outcome.assigneeVerified = relida ? relida.assignees.some((a) => a.id === member.id) : false;
        record('clickup.get_task', `read-back assignee ${task.id}`, outcome.assigneeVerified, outcome.assigneeVerified ? undefined : 'responsável não confirmado na releitura');
      }

      const briefingOk = !withBriefing || outcome.briefingVerified;
      const assignOk = !member || outcome.assigneeVerified;
      outcome.ok = briefingOk && assignOk;
      if (!outcome.ok) outcome.error = 'a releitura não confirmou a alteração';
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      record('clickup.selection_mutation', task.id, false, outcome.error);
    }
  }

  // 5. O REGISTRO ESTRUTURADO — é ele que responde "já lançou?" depois.
  const sucesso = outcomes.filter((o) => o.ok);
  const falhas = outcomes.filter((o) => !o.ok);
  const execucao: ExecutionRecord = {
    executionId: randomUUID(),
    operation,
    taskIds: outcomes.map((o) => o.taskId),
    targetPerson: member ? { name: member.username, memberId: member.id, username: member.username } : null,
    successIds: sucesso.map((o) => o.taskId),
    failedIds: falhas.map((o) => ({ id: o.taskId, title: o.title, reason: o.error ?? 'falha não detalhada' })),
    timestamp: new Date().toISOString(),
    verification: outcomes.map((o) => ({ taskId: o.taskId, assigneeVerified: o.assigneeVerified, briefingVerified: o.briefingVerified })),
    selectionReason: selection.reason,
    titles: Object.fromEntries(outcomes.map((o) => [o.taskId, o.title])),
  };

  logger.info(
    { operation, selection: selection.reason, total: outcomes.length, ok: sucesso.length, failed: falhas.length },
    '[seleção] mutação sobre o conjunto selecionado concluída',
  );

  // 6. O RECIBO HUMANO — hierarquia visual: veredito primeiro, contagem por
  // ação depois, falhas nomeadas com motivo. Nunca parede de texto, nunca
  // dump de id. (Padrão de apresentação, adendo de 24/09/2026.)
  const linhas: string[] = [];
  const briefingTotal = withBriefing ? outcomes.length : 0;
  const briefingOk = outcomes.filter((o) => o.briefingVerified).length;
  const assignTotal = member ? outcomes.length : 0;
  const assignOk = outcomes.filter((o) => o.assigneeVerified).length;
  const nomePessoa = member?.username ?? null;

  if (falhas.length === 0) {
    linhas.push('✅ Concluído');
  } else if (sucesso.length > 0) {
    linhas.push('⚠️ Concluído parcialmente');
  } else {
    linhas.push('❌ Não consegui lançar no ClickUp — nada foi alterado lá.');
  }
  linhas.push('');
  if (withBriefing) linhas.push(`📝 Briefings criados: ${briefingOk}/${briefingTotal}`);
  if (member) linhas.push(`👤 Atribuídas a ${nomePessoa}: ${assignOk}/${assignTotal}`);
  if (sucesso.length > 0) linhas.push('🔄 ClickUp: atualizado e conferido por releitura');
  if (falhas.length > 0) {
    linhas.push('');
    for (const o of falhas) {
      linhas.push(`❌ "${o.title}"${o.clientName ? ` (${o.clientName})` : ''} — ${o.error}`);
    }
  }

  return respond(linhas.join('\n'), sucesso.length > 0 || falhas.length === 0, {
    guard: 'bento-action',
    action: 'selection_mutation',
    write_authorized: sucesso.length > 0,
    intent_classification: 'ACTION_REQUEST',
    selection_reason: selection.reason,
    execucao,
  });
}
