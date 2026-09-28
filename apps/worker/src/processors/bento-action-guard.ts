import { and, desc, eq, gt } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  createTaskComment,
  deleteTask,
  findMemberByName,
  getTask,
  getTaskComments,
  getTaskListId,
  listStatusesForTask,
  updateTask,
  verifyTaskState,
  type ClickUpConfig,
  type ExpectedTaskState,
  type TaskDetail,
  type TaskVerification,
} from '@desigual-os/tool-gateway';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import { classifyDeliveryType, composeBriefing, pendingCriticalFields } from './briefing-composer';
import { extractLabeledFacts, mergeFacts } from './briefing-facts';
import { evaluateBriefing } from './briefing-quality';
import { retrieveBriefingContext } from './briefing-retrieval';
import { classifyActionIntent } from './action-intent';
import { classifyActionIntentV2 } from './action-intent-v2';
import { buildDeliverableTitle, buildItemTitle, buildOperationalTitle, resolveWriteTarget } from './write-target';
import { buildOperationalActionPlan } from './operational-action-plan';
import { createManyTasks, type CreateOneInput, type CreateOutcome, type TaskAttachment } from './multi-create-executor';
import type { SeniorToolContext } from '@desigual-os/tool-gateway';
import { conversationArtifact, requestsExternalTask } from './conversation-artifact';
import { tryJarbasHandoff } from './jarbas-handoff';
import { executeSelectionMutation, extractPersonNameLoose } from './bento-selection-executor';
import { executeTaskUpdate, type TaskUpdateFields } from './bento-update-executor';
import { detectSelectionReference, parseDataNatural, parseSelectionSnapshot, resolveSelectionReference, type SelectionSnapshot } from '@desigual-os/context-engine';

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
/**
 * "manda essa task pro Pedro" — vocabulário real que faltava (mission
 * linguistic matrix, 22/09/2026). "coloca"/"passa" são AMBÍGUOS com status
 * ("coloca como concluída") — resolvido checando UPDATE_STATUS primeiro no
 * classifyIntent (ela exige palavra de status junto, então só vence quando
 * é de status de verdade).
 */
const UPDATE_ASSIGNEE = /(atribu|designa|delega|passa|coloca|coloqu|manda|joga|jogue|deix(a|e|ar))/i;
/** "troca o responsável dessa pro Gui" — troca/muda + a palavra responsável. */
const UPDATE_ASSIGNEE_RESP = /(tro[cq]|mud|alter)[a-z]*\b[^.!?]{0,30}\brespons/i;
/**
 * UPDATE_DUE (alargado em 25/09/2026, incidente D. Carvalho): o verbo de
 * edição genérico ("altere a data", "atualize o prazo", "corrija a data") não
 * estava no vocabulário — caía em `criacaoPadrao` e NASCIA UMA TASK NOVA.
 * Verbo de edição + palavra de campo temporal (prazo/vencimento/data/entrega)
 * é sempre update de data, nunca criação.
 */
const UPDATE_DUE = /(muda|mude|mudar|reagend|adi(a|ar|e)|remarca|passa|troc(a|ar|ue)|troque|alter(a|e|ar)|atualiz(a|e|ar)|edit(a|e|ar)|corrij(a|e|ir)|coloc(a|ar|ue)|adicion(a|e|ar)|bot(a|e|ar)|p[oõ](e|em|nha))\b[^.!?]{0,60}(prazo|vencimento|data|entrega|deadline|hoje|amanh|sexta|segunda|terça|quarta|quinta|sábado|sabado|domingo|\d{1,2}\/\d{1,2}|\d{1,2}\s+de\s+[a-zç]+)/i;
/** Verbo de edição solto — é o sinal de INVARIANTE anti-create no boundary. */
const VERBO_EDICAO = /(alter(a|e|ar)|mud(a|e|ar)|troc(a|ar|ue)|atualiz(a|e|ar)|edit(a|e|ar)|corrij(a|e|ir)|reagend|remarc|adi(a|ar|e)|renome)/i;
/** "troca o prazo pra 25/09" / "pra 25/09/2026" — data explícita, não só hoje/amanhã. */
const DUE_EXPLICIT_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/;
/**
 * P0-01 (auditoria 22/09/2026): "altere essa task para o status 'pronto'"
 * usava "altere", fora do vocabulário original (marcar/concluir/finalizar/
 * fechar) — caía em `criacaoPadrao` e nascia uma task chamada "pronto".
 * Ampliado com os verbos genéricos de troca já usados em UPDATE_DUE/
 * UPDATE_ASSIGNEE ("altere/altera/muda/troca/coloca"), exigindo — como
 * antes — uma palavra de status do outro lado pra não confundir com
 * qualquer outra troca (prazo, responsável).
 */
const UPDATE_STATUS =
  /(marc(ar|a|que)|conclu(i|ir|ida)|finaliz(a|ar)|fech(a|ar)|alter(e|a|ar)|mud(a|e|ar)|troc(a|ar|ue)|troque|coloc(a|ar|ue)|pass(a|ar|e))\b.*(conclu|pront|revis|feito|andamento|aberto|to\s+do|doing|progress|fazendo)/i;
/**
 * "atualize/edite/complemente o BRIEFING/descrição dessa task" — achado real
 * (21/09/2026): sem esta categoria, `classifyIntent` devolvia 'none' e
 * `criacaoPadrao` (linha ~525) tratava isso como CREATE, gerando uma SEGUNDA
 * task idêntica em vez de editar a existente (BENTO_CREATE_NOT_UPDATE).
 * Precisa vir ANTES de `CREATE_TASK` na ordem de checagem: "adicionando" não
 * casa com `adicione?` (falta o `e` final antes de "ando"), mas o verbo
 * "atualiz" sozinho não é ambíguo o bastante pra dispensar exigir menção a
 * briefing/descrição — sem isso "atualiza o prazo" também cairia aqui.
 */
const UPDATE_BRIEF = /(atualiz|edit|complement|revis|acrescent|adicion|faz|faca|mont|cri[ae]|ger)[a-z]*\b[^.!?]{0,30}(briefing|brief|descri[çc][ãa]o)/i;
/**
 * UPDATE_TITLE/UPDATE_PRIORITY/COMMENT (mission CRUD gate, 22/09/2026):
 * vocabulário sem primitiva própria ainda — caíam em `decideFallbackIntent`
 * (pede esclarecimento, nunca cria; seguro, mas não executa a ação de
 * verdade). Mesma régua de UPDATE_BRIEF: verbo de troca genérico só conta
 * quando acompanhado da palavra do CAMPO específico, senão "muda X" vira
 * ambíguo demais com update_status/update_due/update_assignee.
 */
const UPDATE_TITLE = /(tro[cq]|mud|alter|renom|revis)[a-z]*\b.*(t[íi]tulo|nome)\b/i;
const UPDATE_PRIORITY = /(muda|tro[cq]|alter|coloc|defin|ajust|marc)[a-z]*\b.*priorid/i;
/** "coloca ela como urgente", "marca como urgente", "bota como alta" — sem a palavra "prioridade". */
const PRIORITY_DIRECT = /(coloc|marc|bot|p[oõ](e|em|nha)|deix|defin|joga|passa)[a-z]*\b[^.!?]{0,40}\b(como|em)\s+(urgente|urgency|alta|normal|média|media|baixa)\b/i;
/** "tira da urgência", "remove a urgência" → volta pra normal. */
const PRIORITY_REMOVE = /(tira|remove|sai|tir[a]?[ae]?\w*)\b[^.!?]{0,25}\burg[êe]ncia\b/i;
const PRIORITY_WORD_TO_VALUE: Record<string, 1 | 2 | 3 | 4> = { urgente: 1, urgent: 1, alta: 2, high: 2, normal: 3, media: 3, média: 3, baixa: 4, low: 4 };
const COMMENT_REQUEST = /(adicion|coloc|deix|escrev|manda|posta)[a-z]*\b.*coment[áa]rio/i;
const CREATE_TASK = /(cri(e|a|ar)|adicione?|nova (task|tarefa)|nova task|nova tarefa)\b/i;
const REFERENCE_WORDS = /(essa|esse|aquela|aquele|a task|a tarefa|esta task|esta tarefa|ela|ele|isso|dela|dele|nesta|nessa|dessa|desta|disso|a anterior|essa demanda|essa que voc[êe] (listou|mostrou)|aquela que voc[êe] (listou|mostrou)|(item|task|tarefa|demanda|n[úu]mero|n[º°])\s*#?\s*\d+)\b|\bd[ao]s?\s+(primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|quint[ao]|sext[ao]|s[eé]tim[ao]|oitav[ao]|non[ao]|d[eé]cim[ao]|[uú]ltim[ao]|pen[uú]ltim[ao])\b/i;
const BRIEFING_ASK = /(briefing|brief)\b/i;
const ATTACH_ASK = /(anex(e|a|ar)|anexo|attach)\b/i;
const TASK_URL = /app\.clickup\.com\/t\/([a-z0-9]+)/gi;
const DUE_TODAY = /(hoje|pra hoje|pro hoje)/i;
const DUE_TOMORROW = /(amanh|pra amanh)/i;
/**
 * "vence(m) hoje" / "vencendo amanhã" descreve o PRAZO de tasks EXISTENTES
 * (filtro de leitura pra achar quais tasks entram num resumo/briefing) —
 * nunca deve virar o prazo da task NOVA sendo criada. Achado na auditoria
 * sênior (24/09/2026): "cria uma task resumindo as tasks vencendo hoje"
 * atribuía hoje como prazo da task-resumo, quando "hoje" descrevia as
 * tasks de ORIGEM, não a task nova.
 */
const DUE_FILTER_DESCRIBES_OTHER_TASKS = /\b(venc[a-z]*|fecha[m]?|encerra[m]?|expira[m]?)\b[^.!?]{0,25}(hoje|amanh)/i;
const DUE_EXPLICIT_FOR_NEW_TASK_TOMORROW = /\b(pra|pro|prazo)\s+amanh[ãa]/i;
const DUE_EXPLICIT_FOR_NEW_TASK_TODAY = /\b(pra|pro|prazo)\s+hoje/i;

/**
 * Prazo herdado por CREATE: separado de UPDATE_DUE porque ali o alvo já é
 * uma task existente e referenciada — "hoje"/"amanhã" soltos são inequívocos.
 * Aqui a task ainda não existe, então uma cláusula de FILTRO (ver comentário
 * acima) só vale se houver também um marcador explícito de prazo da task
 * nova; sem ele, a task nasce sem due_date em vez de herdar o filtro.
 */
function inferCreateDueDate(message: string): number | null {
  const now = new Date();
  if (DUE_FILTER_DESCRIBES_OTHER_TASKS.test(message)) {
    if (DUE_EXPLICIT_FOR_NEW_TASK_TOMORROW.test(message)) return endOfDay(addDays(now, 1)).getTime();
    if (DUE_EXPLICIT_FOR_NEW_TASK_TODAY.test(message)) return endOfDay(now).getTime();
    return null;
  }
  if (DUE_TOMORROW.test(message)) return endOfDay(addDays(now, 1)).getTime();
  if (DUE_TODAY.test(message)) return endOfDay(now).getTime();
  return null;
}
/**
 * DELETE (mission linguistic matrix, 22/09/2026): "apaga essa task"/"exclui
 * essa demanda". Exige palavra de referência — sem ela, "apaga" sozinho é
 * demais pra agir sobre algo (mesma régua de UPDATE_DUE/UPDATE_BRIEF acima).
 */
const DELETE_REQUEST = /(delet|apag|remov|exclu)[a-z]*\b/i;
/**
 * OBJETO da destruição decide o que é apagado (25/09/2026, incidente Tammy):
 * "delete todo o briefing" virou pedido de confirmação pra apagar A TASK.
 * Verbo destrutivo + objeto de CONTEÚDO (briefing, descrição, prazo,
 * responsável, comentário, imagem) é edição de campo — nunca DELETE_TASK.
 */
const DELETE_OBJECT_TASK = /\b(task|tarefa|demanda|item|card)\b/i;
const DELETE_OBJECT_FIELD = /\b(briefing|brief|descri[çc][ãa]o|conte[úu]do|texto|prazo|vencimento|data|respons[áa]vel|coment[áa]rio|imagem|anexo|arquivo)\b/i;
/** DELETE_TASK só quando o objeto é a ENTIDADE (25/09/2026): "apaga o
 * briefing" edita conteúdo, nunca apaga task. Ver DELETE_OBJECT_*. */
export function isTaskDeleteRequestForTest(message: string): boolean {
  return isTaskDeleteRequest(message);
}

/**
 * QA 28/09/2026 (achado ao vivo — é literalmente o script de teste da
 * missão de release): "agora apaga ela" NÃO tinha DELETE_OBJECT_TASK (nenhum
 * "task"/"tarefa"/... na frase, só o pronome) e caía fora — a exigência
 * antiga tratava DELETE_OBJECT_TASK como obrigatório, quando ele só precisa
 * ser um SINAL POSITIVO opcional. REFERENCE_WORDS já garante que há um
 * referente; DELETE_OBJECT_FIELD já exclui "apaga o briefing dela" (edição
 * de campo). Sem nenhum objeto CITADO (nem task, nem campo), o pronome
 * sozinho aponta pra a própria task — é a leitura mais natural de "apaga
 * ela"/"deleta isso".
 */
function isTaskDeleteRequest(message: string): boolean {
  if (!DELETE_REQUEST.test(message) || !REFERENCE_WORDS.test(message)) return false;
  if (DELETE_OBJECT_FIELD.test(message)) return false;
  return true;
}

/** Marcador auto-contido no texto da própria pergunta de confirmação — não
 * depende de link ClickUp existir na mensagem, então funciona mesmo quando
 * `readBackVerify`/`lastTaskId` não encontrou URL nenhuma no histórico. */
const DELETE_CONFIRM_MARKER = 'CONFIRMAÇÃO PARA APAGAR';
const DELETE_CONFIRM_TASK_ID = /CONFIRMAÇÃO PARA APAGAR \(id:([a-z0-9]+)\)/i;
const DELETE_AFFIRMATIVE = /^\s*(sim|confirmo|confirmado|pode (apagar|deletar|excluir)|isso mesmo|com certeza)\b/i;

type GuardIntent =
  | { kind: 'update_assignee'; personName: string }
  | { kind: 'update_due'; dueDate: number }
  | { kind: 'update_status'; statusHint: string }
  | { kind: 'update_brief'; addition: string }
  | { kind: 'update_title'; newTitle: string }
  | { kind: 'update_priority'; priority: 1 | 2 | 3 | 4 }
  /** Vários campos da MESMA task numa frase só — um PUT, uma releitura. */
  | { kind: 'update_multi'; fields: FieldUpdates }
  | { kind: 'comment'; text: string }
  | { kind: 'create'; taskName: string; personName: string | null; dueDate: number | null; wantsBriefing: boolean }
  | { kind: 'none' };

interface ConversationContext {
  lastArtifact?: string | null;
  lastTaskId: string | null;
  lastTaskName: string | null;
  lastPersonName: string | null;
  /** Material mandado em turnos anteriores — "o print que mandei", "o arquivo acima". */
  previousAttachments: TaskAttachment[];
  /**
   * Task aguardando confirmação de exclusão: só é setado quando a mensagem
   * mais recente do ASSISTENTE (a pergunta que o próprio guard fez) contém o
   * marcador `DELETE_CONFIRM_MARKER`. Delete real exige duas voltas: pedir,
   * confirmar — nunca apaga no mesmo turno do pedido.
   */
  pendingDeleteTaskId: string | null;
  /**
   * Conteúdo do último turno do usuário ANTES deste. "Tenho a solicitação
   * acima" é o jeito normal de a operação trabalhar: a demanda vem colada
   * numa mensagem, a ordem na seguinte. Sem recuperar esse texto, a task
   * nascia com o briefing dizendo "tenho a solicitação acima" — a meta-
   * instrução no lugar do trabalho (medido na task QA 86bc34xtt).
   */
  solicitacaoAnterior: string | null;
  /**
   * O CONJUNTO SELECIONADO da conversa (context-engine/selection.ts): as tasks
   * que um turno anterior listou. É o alvo de "delas", "cada uma", "lança
   * elas pro Pedro" — sem isto, o follow-up caía na consulta global de 1209
   * tasks e nenhuma mutação real acontecia (medido ao vivo em 24/09/2026).
   */
  selection: SelectionSnapshot | null;
}

function extractPersonName(message: string): string | null {
  // "atribua a task ao Pedro", "passa pra Jamile", "deixa ela COM O Pedro"
  const match = message.match(/(?:a|à|ao|pro|pra|para|com(?:\s+[oa])?)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+){0,2})/);
  return match?.[1]?.trim() ?? null;
}

function extractTaskName(message: string): string | null {
  // nome entre aspas ou após "chamada/nomeada/com o nome"
  const quoted = message.match(/["“]([^"”]{3,120})["”]/);
  if (quoted) return quoted[1]!.trim();
  const named = message.match(/(?:chamad[ao]|nomead[ao]|com (?:o )?nome|nome:?)\s+(.{3,120}?)(?:[.,;]|$)/i);
  return named?.[1]?.trim() ?? null;
}

/** "troca o título pra 'X'" / "troca o título pra X" — aspas OU texto livre após "pra/para". */
function extractNewTitle(message: string): string | null {
  const quoted = message.match(/["“]([^"”]{2,120})["”]/);
  if (quoted) return quoted[1]!.trim();
  const livre = message.match(/(?:t[íi]tulo|nome)\b.*?(?:pra|para|pro)\s+(.{2,120}?)(?:[.!?]|$)/i);
  return livre?.[1]?.trim() ?? null;
}

/** Mapeia a PALAVRA de prioridade citada (não a lista real do ClickUp — prioridade é sempre a mesma escala 1-4, ao contrário de status). */
function extractPriorityValue(message: string): 1 | 2 | 3 | 4 | null {
  const palavra = Object.keys(PRIORITY_WORD_TO_VALUE).find((p) => new RegExp(`\\b${p}\\b`, 'i').test(message));
  return palavra ? PRIORITY_WORD_TO_VALUE[palavra]! : null;
}

/** "adiciona um comentário dizendo/com 'X'" — aspas OU texto livre após dizendo/com/que diz. */
function extractCommentText(message: string): string | null {
  const quoted = message.match(/["“]([^"”]{1,500})["”]/);
  if (quoted) return quoted[1]!.trim();
  const livre = message.match(/(?:dizendo|que diz|com o texto|com|:)\s+(.{1,500})$/i);
  return livre?.[1]?.trim() ?? null;
}

export function classifyIntentForTest(message: string): GuardIntent {
  return classifyIntent(message);
}

/** DELETE é tratado FORA de `classifyIntent` (precisa do contexto da
 * conversa pra saber se já há confirmação pendente) — estes três helpers
 * testam as três regras isoladamente, sem precisar montar banco/ClickUp. */
export function isDeleteRequestForTest(message: string): boolean {
  return DELETE_REQUEST.test(message) && REFERENCE_WORDS.test(message);
}
export function isDeleteAffirmativeForTest(message: string): boolean {
  return DELETE_AFFIRMATIVE.test(message.trim());
}
export function extractPendingDeleteTaskIdForTest(lastAssistantMessage: string): string | null {
  return lastAssistantMessage.match(DELETE_CONFIRM_TASK_ID)?.[1] ?? null;
}
export function buildDeleteConfirmMarkerForTest(taskId: string): string {
  return `${DELETE_CONFIRM_MARKER} (id:${taskId})`;
}

/**
 * ALVO EXPLÍCITO NO PRÓPRIO TURNO ganha de qualquer inferência de
 * histórico. Achado real no E2E de release (22/09/2026, gate de DELETE):
 * `lastTaskId` só vinha de link ClickUp em mensagem ANTERIOR do assistente
 * — numa conversa longa (comum depois de várias idas e voltas de UPDATE),
 * a mensagem que tinha o link envelhecia pra fora da janela de histórico,
 * e "apaga essa task https://app.clickup.com/t/86bc5dm9t" — com o alvo
 * dito da forma mais explícita possível — respondia "não encontrei
 * nenhuma task". Quem cita o link na própria mensagem não devia precisar
 * que o Bento "lembre" de nada. Pega o ÚLTIMO link citado no turno, mesmo
 * padrão já usado em loadConversationContext pra histórico.
 */
export function extractExplicitTaskIdFromMessage(message: string): string | null {
  const urls = [...message.matchAll(TASK_URL)];
  return urls.length > 0 ? urls[urls.length - 1]![1]! : null;
}

/**
 * Coleção de CAMPOS de edição (25/09/2026): "troca o prazo e o responsável
 * dessa" é UMA ordem sobre a MESMA task existente — duas mudanças, uma task,
 * uma releitura. Cada campo é detectado sozinho; com 2+ presentes a intenção
 * vira update_multi e o executor aplica tudo num único PUT.
 */
interface FieldUpdates {
  dueDate?: number;
  personName?: string;
  priority?: 1 | 2 | 3 | 4;
  statusHint?: string;
  newTitle?: string;
  briefAddition?: string;
  /** "apaga o briefing" / "limpa o conteúdo" — esvazia a descrição da MESMA task. */
  clearDescription?: boolean;
  /** "apaga o briefing e coloca esse texto" — substitui o conteúdo (gerado quando o texto é pedido, não dado). */
  replaceDescription?: string;
  /** "remove o prazo dela". */
  clearDueDate?: boolean;
  /** "remove o Pedro dela" / "tira o responsável" ('' = qualquer responsável atual). */
  removePersonName?: string;
  /** "crie um título pra task" sem título dado — gerado do conteúdo pedido. */
  generateTitle?: boolean;
  /** "coloca a imagem nela" — anexo da conversa na MESMA task. */
  attachImage?: boolean;
}

/**
 * Referente de FOCO: task existente da conversa ("dela", "essa", "item 3").
 * Diferente de REFERENCE_WORDS por um detalhe que decide create-vs-update:
 * 'a task' está em REFERENCE_WORDS, mas "crie uma task chamada X" não é
 * referência a task EXISTENTE — é criação. Aqui só dêiticos e ordinais.
 */
const REFERENTE_FOCO_RE = /\b(del[ae]|dess[ae]|dest[ae]|ness[ae]|nest[ae]|ela|essa|aquela|isso)\b|\b(item|task|tarefa|demanda|n[úu]mero|n[º°])\s*#?\s*\d+/i;

function collectFieldUpdates(message: string): FieldUpdates {
  const campos: FieldUpdates = {};
  if (UPDATE_DUE.test(message)) {
    const due = parseDataNatural(message, new Date());
    if (due !== null) campos.dueDate = due;
  }
  if (UPDATE_ASSIGNEE.test(message) || UPDATE_ASSIGNEE_RESP.test(message)) {
    const pessoa = extractPersonName(message) ?? extractPersonNameLoose(message);
    if (pessoa) campos.personName = pessoa;
  }
  if (UPDATE_PRIORITY.test(message) || PRIORITY_DIRECT.test(message)) {
    const prioridade = extractPriorityValue(message);
    if (prioridade) campos.priority = prioridade;
  }
  if (PRIORITY_REMOVE.test(message)) {
    campos.priority = 3;
  }
  if (UPDATE_STATUS.test(message)) {
    campos.statusHint = message;
  }
  if (UPDATE_TITLE.test(message)) {
    const titulo = extractNewTitle(message);
    if (titulo) campos.newTitle = titulo;
  }
  if (UPDATE_BRIEF.test(message)) {
    campos.briefAddition = message;
  }
  /**
   * Destruição de CAMPO, nunca de task (adendo 25/09/2026): "apaga o
   * briefing", "remove o prazo dela", "tira o responsável". O objeto decide.
   */
  const verboDestrutivo = /(delet|apag|remov|exclu|limp|tir)[a-z]*\b/i.test(message);
  if (verboDestrutivo && !DELETE_OBJECT_TASK.test(message)) {
    if (DELETE_OBJECT_FIELD.test(message)) {
      if (/\b(briefing|brief|descri[çc][ãa]o|conte[úu]do|texto)\b/i.test(message)) {
        // Substituição quando a frase já pede conteúdo novo junto ("apaga o
        // briefing e coloca esse texto") — uma operação semântica, não duas.
        const querSubstituir = /(coloc|crie|cria|escrev|redig|substitu|reescrev|p[oõ](e|em)|bota|troca|atualiz|atualize)[a-z]*\b/.test(message) || /\bpor (esse|este|isso)\b/i.test(message);
        if (querSubstituir) campos.replaceDescription = message;
        else campos.clearDescription = true;
      }
      if (/\b(prazo|vencimento|data)\b/i.test(message)) campos.clearDueDate = true;
      if (/respons/i.test(message)) {
        campos.removePersonName = extractPersonName(message) ?? extractPersonNameLoose(message) ?? '';
      }
    }
    // "remove o Pedro dela" — remoção de PESSOA pelo nome, sem palavra de campo.
    if (!campos.clearDescription && !campos.replaceDescription && !campos.clearDueDate && campos.removePersonName === undefined) {
      const direta = message.match(/(?:remove|tira|apaga|exclui|deleta|tire)[a-z]*\s+(?:o|a|os|as)?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)/);
      const pessoa = extractPersonName(message) ?? extractPersonNameLoose(message) ?? direta?.[1] ?? null;
      if (pessoa) campos.removePersonName = pessoa;
    }
  }
  // Conteúdo novo pra task existente: "crie um texto de boas-vindas pra ela".
  // Só com referente de FOCO ("dela", "essa", "item 3") — "crie uma task
  // chamada 'Boas-vindas'" tem 'a task' mas é CRIAÇÃO de task nova, e o nome
  // entre aspas não é pedido de texto (achado na regressão de 25/09/2026).
  const focoPresente = REFERENTE_FOCO_RE.test(message);
  if (focoPresente && !campos.replaceDescription && /(crie|cria|escrev|redig|reescrev)[^.!?]{0,50}\b(texto|copy|mensagem|boas.?vindas|conte[úu]do)\b/i.test(message)) {
    campos.replaceDescription = message;
  }
  // Título pedido SEM texto explícito: "crie um título pra task" → gerado.
  // Só com verbo de GERAR — "troca o título" sem valor é esclarecimento,
  // nunca título inventado.
  if (focoPresente && !campos.newTitle && /(crie|cria|gera|gere|monta|bota|coloca|põe|poe)[a-z]*\b[^.!?]{0,30}\b(?:um|novo|nova|o|pra|d[ae])?[^.!?]{0,15}\bt[íi]tulo\b/i.test(message) && !extractNewTitle(message) && !extractTaskName(message)) {
    campos.generateTitle = true;
  }
  // Anexo na MESMA task: "coloca a imagem nela".
  if (/(coloc|coloqu|anex|adicion|p[oõ](e|em)|bota|manda|joga)[a-z]*\b[^.!?]{0,25}\b(imagem|print|foto|anexo|arquivo)/i.test(message)) {
    campos.attachImage = true;
  }
  return campos;
}

function classifyIntent(message: string): GuardIntent {
  const hasReference = REFERENCE_WORDS.test(message);
  const person = extractPersonName(message);

  /**
   * MULTI-CAMPO antes dos ramos singulares: "muda o status pra pronto E o
   * prazo pra sexta" não pode executar só metade. Com um campo só, os ramos
   * de sempre respondem exatamente como antes.
   */
  const campos = collectFieldUpdates(message);
  const nCampos = [
    campos.dueDate, campos.personName, campos.priority, campos.statusHint, campos.newTitle, campos.briefAddition,
    campos.clearDescription, campos.replaceDescription, campos.clearDueDate, campos.removePersonName, campos.generateTitle, campos.attachImage,
  ].filter((v) => v !== undefined).length;
  if (nCampos >= 2 && hasReference) {
    return { kind: 'update_multi', fields: campos };
  }
  // Campo novo (clear/replace/anexo/título gerado) também é update da task
  // existente — nunca create, nunca delete de task. Sem referente resolvível
  // o UPDATE responde "qual task?" honestamente (o executor exige taskId).
  if (
    campos.clearDescription || campos.replaceDescription || campos.clearDueDate || campos.removePersonName !== undefined || campos.generateTitle || campos.attachImage
  ) {
    return { kind: 'update_multi', fields: campos };
  }

  /**
   * STATUS checado ANTES de ASSIGNEE (22/09/2026, matriz linguística da
   * missão): "coloca"/"passa" são verbos AMBÍGUOS entre os dois — "coloca
   * essa task como concluída" (status) vs "coloca pro Pedro" (assignee).
   * UPDATE_STATUS exige uma palavra de status junto ("como concluída",
   * "em andamento"...), então só vence quando é status de verdade; sem essa
   * palavra, cai corretamente em ASSIGNEE mais abaixo.
   */
  if (UPDATE_STATUS.test(message) && hasReference) {
    return { kind: 'update_status', statusHint: message };
  }
  if (!CREATE_TASK.test(message) && (UPDATE_ASSIGNEE.test(message) || UPDATE_ASSIGNEE_RESP.test(message)) && (person || hasReference)) {
    // "atribua a ele": o "ele" é a pessoa do TURNO ANTERIOR, resolvida no contexto.
    return { kind: 'update_assignee', personName: person ?? '' };
  }
  if (UPDATE_DUE.test(message) && hasReference) {
    /**
     * Data natural EXTENSA (25/09/2026): "28 de setembro de 2026", "dia 28",
     * "sexta", "próxima segunda", "fim do mês" — resolvida por
     * parseDataNatural ANTES de qualquer tool call. Sem data reconhecível,
     * cai pros outros campos da frase (briefing/título...) — "edita o
     * briefing e adiciona um prazo de 3 dias" é BRIEF, não 'none'.
     */
    const due = parseDataNatural(message, new Date());
    if (due !== null) return { kind: 'update_due', dueDate: due };
  }
  if (UPDATE_BRIEF.test(message) && hasReference) {
    return { kind: 'update_brief', addition: message };
  }
  if (UPDATE_TITLE.test(message) && hasReference) {
    const newTitle = extractNewTitle(message);
    if (newTitle) return { kind: 'update_title', newTitle };
    return { kind: 'none' };
  }
  if ((UPDATE_PRIORITY.test(message) || PRIORITY_DIRECT.test(message)) && hasReference) {
    const priority = extractPriorityValue(message);
    if (priority) return { kind: 'update_priority', priority };
    return { kind: 'none' };
  }
  if (PRIORITY_REMOVE.test(message) && hasReference) {
    return { kind: 'update_priority', priority: 3 };
  }
  if (COMMENT_REQUEST.test(message) && hasReference) {
    const text = extractCommentText(message);
    if (text) return { kind: 'comment', text };
    return { kind: 'none' };
  }
  if (CREATE_TASK.test(message)) {
    const taskName = extractTaskName(message);
    const dueDate = inferCreateDueDate(message);
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

/**
 * MULTI-WRITE fica atrás de flag própria enquanto a V2 está em validação.
 *
 * O parser passou a enxergar N demandas numa mensagem; o executor já sabia
 * criar N. Mas "entendeu certo no corpus" e "pode criar quatro tasks na conta
 * de um cliente" são decisões diferentes, e a segunda merece uma chave
 * separada — errar em escala é pior do que errar uma vez.
 *
 *   BENTO_MULTI_ACTION_WRITE=true  -> executa o plano inteiro
 *   ausente/false                  -> mostra o plano e NÃO escreve nada
 *
 * DESLIGADA por default nesta fase, a pedido do release. Plano de uma task só
 * não é afetado: a chave só pesa quando há mais de uma.
 */
const LIGADO = new Set(['true', '1', 'on', 'yes', 'sim']);

export function multiActionWriteHabilitado(env: NodeJS.ProcessEnv = process.env): boolean {
  return LIGADO.has((env.BENTO_MULTI_ACTION_WRITE ?? '').trim().toLowerCase());
}

/** Intenção de criação montada dos mesmos extratores, sem exigir o verbo "criar". */
function criacaoPadrao(message: string): GuardIntent {
  return {
    kind: 'create',
    taskName: extractTaskName(message) ?? '',
    personName: extractPersonName(message),
    dueDate: inferCreateDueDate(message),
    wantsBriefing: BRIEFING_ASK.test(message) || ATTACH_ASK.test(message),
  };
}

export type FallbackDecision =
  | { kind: 'ask_clarification' }
  | { kind: 'intent'; intent: GuardIntent };

/**
 * P0-01 (auditoria de release readiness, 22/09/2026): decide o que fazer
 * quando `classifyIntent` não reconheceu NENHUMA forma de escrita
 * (`kind: 'none'`). Extraída de `tryBentoActionGuard` pra ser testável sem
 * precisar montar banco/ClickUp — é literalmente o coração do P0.
 *
 * REGRA GLOBAL: UNKNOWN OPERATION = NO MUTATION. Só cai em `criacaoPadrao`
 * (cria mesmo sem verbo "criar" reconhecido — vocabulário real como "separa
 * essa demanda"/"essa fica pra Sofia") quando a mensagem NÃO está se
 * referindo a uma task que já existe nesta conversa. Existindo
 * `lastTaskId` E a mensagem usando palavra de referência ("essa
 * task"/"ela"/"a anterior"...), a única leitura seria "aja sobre a task que
 * já existe" — e como nenhum verbo reconhecido bateu, agir seria adivinhar.
 * Pede esclarecimento em vez de criar uma task nova com o texto do pedido
 * como nome (era exatamente esse o bug: "altere essa task para o status
 * 'pronto'" virava uma task chamada "pronto").
 *
 * REGRESSÃO REAL encontrada no E2E de release (22/09/2026, gate de
 * ambiguidade): "atualiza aquela task" numa conversa NOVA (sem
 * `lastTaskId` nenhum) criava uma task chamada "Executar demanda" — o
 * mesmo bug estrutural do P0-01, só que pelo lado SEM histórico. A regra
 * acima só protegia quando `lastTaskId` já existia; aqui não existia
 * task nenhuma na conversa, mas a mensagem CITA EXPLICITAMENTE "task"/
 * "tarefa" (não "essa"/"isso" genérico, que legitimamente significa "essa
 * DEMANDA que estou discutindo" — ver "essa fica pra Sofia" abaixo).
 * "aquela task"/"essa tarefa" é a pessoa dizendo que um recurso já
 * existe, mesmo que o Bento não tenha visto nenhum nesta conversa — a
 * honestidade aqui é perguntar QUAL task, nunca inventar uma criando do
 * zero com o texto do pedido como nome.
 */
const EXPLICIT_TASK_REFERENCE = /\b(essa|aquela|esta|nessa|nesta|essas|aquelas|estas)\s+(task|tarefa)s?\b/i;

export function decideFallbackIntent(message: string, lastTaskId: string | null): FallbackDecision {
  if (lastTaskId && REFERENCE_WORDS.test(message)) return { kind: 'ask_clarification' };
  if (EXPLICIT_TASK_REFERENCE.test(message)) return { kind: 'ask_clarification' };
  /**
   * Verbo de EDIÇÃO sem forma reconhecida NUNCA vira create (25/09/2026):
   * "muda o prazo" sem alvo/data clara é pedido de alteração sobre algo que
   * existe — a resposta honesta é perguntar QUAL task/campo, não nascer uma
   * task nova com o texto do pedido. Mesmo sem lastTaskId nesta conversa.
   */
  if (VERBO_EDICAO.test(message)) return { kind: 'ask_clarification' };
  return { kind: 'intent', intent: criacaoPadrao(message) };
}

/* ================================================================== */
/* ETAPA 1 DA CONVERGÊNCIA (ADR-bento-core-convergence, 26/09/2026):   */
/* kill switch de escrita externa (F-01) + checkpoint anti UPDATE→     */
/* CREATE (F-02). As duas peças dividem o MESMO vocabulário de         */
/* detecção — um phrasing que escapa de uma não pode escapar da outra. */
/* ================================================================== */

/**
 * KILL SWITCH DE ESCRITA EXTERNA (F-01, P0 — forense 26/09/2026).
 *
 * O defeito medido no harness B.4 (bento-guard-matrix.test.ts): 16 de 31
 * phrasings naturais de UPDATE morriam no portão 1 (`READ_ONLY`) e caíam no
 * `return null` — que despacha a mensagem pro serviço externo bento-qa. O
 * bento-qa é OPACO: tem credencial real de escrita no ClickUp, nenhuma
 * idempotência conhecida, payload de 3 campos sem task_id de retorno e sem
 * estado de conversa (ver bento-qa-client.ts e o ADR, seção 2). O Desigual
 * OS não tem como saber se ele vai ler ou escrever — e o incidente real
 * documentado no cabeçalho deste arquivo prova que ele escreve.
 *
 *   BENTO_EXTERNAL_WRITE_ENABLED=false (DEFAULT) → nenhuma mensagem com
 *     potencial de escrita sai pelo fallback externo: o guard responde
 *     esclarecimento/bloqueio explícito em vez de devolver null.
 *   BENTO_EXTERNAL_WRITE_ENABLED=true → comportamento legado (rollback
 *     operacional apenas; reativa F-01 — ver ADR, seção 7: a Etapa 1 é
 *     permanente e não participa de rollback).
 *
 * À prova de esquecimento: o default é FECHADO. Esquecer a flag em ambiente
 * novo mantém o externo somente-leitura; abrir exige ato explícito.
 */
export function externalWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return LIGADO.has((env.BENTO_EXTERNAL_WRITE_ENABLED ?? '').trim().toLowerCase());
}

/** Referentes que REFERENCE_WORDS não cobre: "nela", "aquilo", "que você acabou de...". */
const REFERENTE_EXTRA_RE = /\b(nela|nele|nisso|disso|daquilo|naquilo|aquilo)\b|\bque (você|voce|vc|a gente) acabou de\b|\bacabamos de\b/i;
/** Campo de task citado na frase — verbo de ação + campo = escrita, nunca leitura. */
const CAMPO_DE_TASK_RE = /\b(task|tasks|tarefa|tarefas|demanda|demandas|card|cards|item|itens|prazo|vencimento|data|entrega|deadline|status|respons[áa]vel|t[íi]tulo|prioridade|briefing|brief|descri[çc][ãa]o|coment[áa]rio|anexo|imagem|print|foto)\b/i;
/** Marcador temporal — verbo de agendamento + isto = mudança de prazo ("joga pra sexta"). */
const DESTINO_TEMPORAL_RE = /\b(hoje|amanh[ãa]|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo|semana|fim do m[êe]s|\d{1,2}\/\d{1,2})\b/i;
/** Destino de lugar solto — só conta com verbo de despacho ("coloca fulano lá").
 * Lookahead em vez de `\b` final: "á" não é word char no JS, então `\b` depois
 * de "lá" nunca casa no fim da frase. */
const DESTINO_LUGAR_RE = /\b(lá|ali)(?![a-záàâãéêíóôõúç])/i;
/**
 * Verbo de ACRÉSCIMO sobre recurso existente ("adiciona o Matheus também").
 * Separado do VERBO_EDICAO porque "adiciona" não é edição de campo — é a
 * frase-canônico do F-02 (virava CREATE local via `criacaoPadrao`).
 * `[a-z]*` antes do `\b` final: sem ele, "adicion"+\b não casa "adiciona" (o
 * `a` seguinte é word char) — mesma armadilha documentada em UPDATE_BRIEF.
 * `\b` no INÍCIO também: sem ele "demanda" casaria "manda" por dentro.
 */
const VERBO_ACRESCIMO_RE = /\b(adicion|acrescent|increment|inclu|complement)[a-z]*\b/i;
/** Verbo de DESPACHO mutável — só conta com qualificador (referente/campo/pessoa/lugar). */
const VERBO_DESPACHO_MUTAVEL_RE = /\b(coloc(a|ar|ue)|bot(a|e|ar)|p[oõ](e|em|nha)|tir(a|e|ar)|pass(a|ar|e)|jog(a|ar|ue)|lan[cç](a|e|ar)|mand(a|e|ar)|faz|fa[cç]a|marc(a|ar|ue)|atribu(i|ir|a|ar|em)|design(a|e|ar)|deleg(a|ue|ar)|anex(a|e|ar))\b/i;
/** Verbo de AGENDAMENTO — só conta com marcador temporal ("bota pra terça").
 * `reagend[a-z]*`/`remarc[a-z]*`: prefixo + `\b` não casa "reagenda"/"remarcar". */
const VERBO_AGENDAMENTO_RE = /\b(reagend[a-z]*|remarc[a-z]*|adi(a|ar|e)|empurr(a|e|ar)|bot(a|e|ar)|p[oõ](e|em|nha)|jog(a|ar|ue)|coloc(a|ar|ue)|pass(a|ar|e)|troc(a|ar|ue)|mud(a|e|ar)|faz)\b/i;
/**
 * Pergunta clara de leitura — referente sem verbo de ação ("o que falta nessa
 * task?", "e a segunda?") é consulta e segue pro externo normalmente. Sem a
 * marca de pergunta, o mesmo referente solto ("nessa mesma task") é tratado
 * como potencial de escrita: o externo não tem estado de conversa e o F-01
 * já provou que meta-pedido vira task real lá.
 */
const PERGUNTA_CLARA_RE = /\?\s*$|^\s*(o que|qual|quais|quem|como|quando|onde|por\s*que|porque|quant[ao]s?|cad[êe]|será|existe|há|tem)\b/i;
/** Reação/feedback puro sobre o recurso ("gostei dessa task") não é escrita. */
const REACAO_PURA_RE = /^\s*(gostei|adorei|amei|odiei|detestei|curti|perfeito|[óo]timo|bom|legal|show|valeu|obrigad[oa]|ok|beleza|isso a[ií]|exato|concordo|discordo)\b/i;
/** Leitura dirigida ao próprio usuário ("me passa", "me manda", "me atualiza aí"). */
const LEITURA_DIRIGIDA_RE = /\bme\s+(mostra|mostre|lista|liste|exibe|exiba|traz|traga|conta|conte|explica|explique|fala|fale|diz|diga|passa|passe|manda|mande|atualiza|atualize|resume|resuma)\b/i;

export interface WritePotential {
  /** Rótulos dos sinais que dispararam — vão pro trace estruturado. */
  signals: string[];
}

/**
 * POTENCIAL DE ESCRITA — o classificador compartilhado do kill switch (F-01),
 * do checkpoint anti UPDATE→CREATE (F-02) e do desvio do fast_path de
 * conhecimento (F-14, via `looksLikeMutationOnResource`).
 *
 * Devolve null quando a mensagem é claramente leitura/pergunta/conversa —
 * essas seguem pro bento-qa normalmente. Devolve os sinais quando a frase
 * carrega verbo de ação sobre recurso (edição, acréscimo, despacho,
 * agendamento, destruição, criação) ou referente a recurso sem marca de
 * pergunta. A régua é CONSERVADORA de propósito: o falso positivo aqui vira
 * um pedido de esclarecimento honesto; o falso negativo vira escrita cega
 * num serviço sem idempotência.
 *
 * Prova da régua nos dois lados (bateria B.4 + leituras reais do bento-qa):
 *   potencial: "coloca o Matheus nela", "troca o responsável pra Sofia",
 *     "bota pra terça", "joga pra sexta-feira", "empurra ela pra semana que
 *     vem", "adiciona o Matheus também", "nessa mesma task".
 *   leitura: "quais tasks vencem hoje?", "me atualiza aí", "me atualiza
 *     sobre a Cliente Teste 7", "qual o briefing dela?", "gostei dessa
 *     task", "manda o relatório da semana".
 */
export function detectExternalWritePotential(message: string): WritePotential | null {
  const texto = message.trim();
  if (texto.length === 0) return null;

  const temReferente = REFERENCE_WORDS.test(texto) || REFERENTE_FOCO_RE.test(texto) || REFERENTE_EXTRA_RE.test(texto);
  const temCampo = CAMPO_DE_TASK_RE.test(texto);
  const temPessoa = extractPersonName(texto) !== null;
  const temTemporal = DESTINO_TEMPORAL_RE.test(texto);
  const ehPerguntaClara = PERGUNTA_CLARA_RE.test(texto);

  const signals: string[] = [];
  // Verbo de edição explícito qualificado ("troca o responsável pra Sofia").
  if (VERBO_EDICAO.test(texto) && (temReferente || temCampo || temPessoa || temTemporal)) signals.push('verbo_edicao');
  // Campo de edição reconhecido pelo MESMO coletor que alimenta o update do
  // guard (prazo/prioridade/status/título/briefing/anexo/remoção) — "bota
  // pra terça" tem campo de prazo mesmo sem referente. `personName` SOZINHO
  // não conta: o extrator solto casa nome dentro de qualquer frase de
  // criação ("separa a demanda do cliente novo" vira pessoa "cliente novo"
  // pelo "manda" dentro de "demanda") — pessoa solta é sinal fraco demais.
  const camposColetados = collectFieldUpdates(texto);
  if (Object.keys(camposColetados).some((k) => k !== 'personName')) signals.push('campo_de_edicao');
  // Acréscimo sobre recurso existente ("adiciona o Matheus também").
  if (VERBO_ACRESCIMO_RE.test(texto) && (temReferente || temCampo || temPessoa || /\btamb[ée]m\b/i.test(texto))) signals.push('verbo_acrescimo');
  // Despacho mutável qualificado ("coloca o Matheus nela", "faz ela pra amanhã").
  if (VERBO_DESPACHO_MUTAVEL_RE.test(texto) && (temReferente || temCampo || temPessoa || DESTINO_LUGAR_RE.test(texto))) signals.push('verbo_despacho');
  // Agendamento ("joga pra sexta-feira", "empurra ela pra semana que vem").
  if (VERBO_AGENDAMENTO_RE.test(texto) && temTemporal) signals.push('verbo_agendamento');
  // Destruição ("apaga essa task") — o fluxo de confirmação mora DEPOIS do
  // portão 1; sem este sinal o pedido de delete ia direto pro externo.
  if (DELETE_REQUEST.test(texto) && (temReferente || DELETE_OBJECT_TASK.test(texto))) signals.push('verbo_destrutivo');
  // Criação/despacho explícito de task que o portão 1 não autorizou — melhor
  // esclarecer e criar LOCAL (com read-back) do que deixar o externo criar.
  if (CREATE_TASK.test(texto) && /\b(task|tarefa|tarefas|demanda|demandas|card)\b/i.test(texto)) signals.push('verbo_criacao');
  // Referente a recurso SEM verbo e SEM marca de pergunta ("nessa mesma
  // task") — o externo não sabe do que se está falando e pode inventar.
  if (!ehPerguntaClara && temReferente && !REACAO_PURA_RE.test(texto)) signals.push('referente_sem_verbo');

  if (signals.length === 0) return null;
  // Leitura dirigida ao próprio usuário sem nenhum qualificador de recurso:
  // "me atualiza sobre a Cliente Teste 7" — o nome do cliente não torna a
  // frase uma escrita.
  if (LEITURA_DIRIGIDA_RE.test(texto) && !temReferente && !temCampo && !temTemporal && !DELETE_REQUEST.test(texto)) return null;
  return { signals };
}

/**
 * F-14 (P1, forense 26/09/2026 — provado ao vivo T05/T12): o fast_path de
 * registro de conhecimento (`registrarConhecimentoDoTurno`, execute-job.ts)
 * capturava "troca o responsável pra Sofia" e "corrige a task que você
 * acabou de criar" como se fossem ENSINO ("Registrado: ..."), e a mutação
 * real nunca acontecia. Verbo de ação sobre recurso é MUTAÇÃO, não
 * conhecimento — o caller usa esta função pra deixar o turno seguir pro
 * core/guard. Feedback genuíno ("ficou genérico", "gostei", "anota que o
 * cliente prefere X") não casa aqui e continua capturado.
 */
export function looksLikeMutationOnResource(message: string): boolean {
  return detectExternalWritePotential(message) !== null;
}

/**
 * Criação SUBORDINADA não é ordem de criação: "a task que você acabou de
 * criar" fala de uma task que JÁ EXISTE — o "criar" ali é passado, não
 * pedido. Sem esta exclusão, o sinal explícito de criação (CREATE_TASK)
 * casaria nessas frases e o checkpoint abaixo deixaria o create passar.
 */
const CRIACAO_SUBORDINADA_RE = /(acab\w+\s+de|sem|de|deix\w+\s+de)\s+cri(ar|e|a|em)\b/i;

export interface AntiCreateVerdict {
  allowed: boolean;
  /** Sinais que sustentaram o bloqueio — vão pro trace estruturado. */
  signals: string[];
}

/**
 * CHECKPOINT ÚNICO ANTI UPDATE→CREATE (F-02, P0 — forense 26/09/2026).
 *
 * A falha medida no harness B.4: "adiciona o Matheus também" não casa com
 * nenhum UPDATE_* nem com REFERENCE_WORDS, caía em `criacaoPadrao` e NASCIA
 * UMA TASK NOVA (createTask=1) num pedido que era atribuição sobre a task em
 * foco. Não é problema de regex — é arquitetura: nenhuma estrutura impedia
 * um pedido de alteração de terminar num caminho que cria.
 *
 * A guarda é ESTRUTURAL e fica no único ponto por onde TODO create do guard
 * passa (inclusive o multi — `createManyTasks` mora logo abaixo do call site
 * em tryBentoActionGuard). PROIBIDO criar quando as três condições valem:
 *
 *   (a) há referente a recurso existente NA CONVERSA (lastTaskId, foco da
 *       seleção, ou referência explícita tipo "nessa task");
 *   (b) a mensagem NÃO carrega sinal explícito de criação nova ("cria uma
 *       task...", "crie...") — quem pede criação em voz alta tem direito a
 *       ela mesmo numa conversa com task recente;
 *   (c) a mensagem carrega sinal de mutação sobre o existente (mesmo
 *       vocabulário do kill switch) ou referente na própria frase.
 *
 * O bloqueio NÃO cria nada e responde esclarecimento — a mesma resposta
 * honesta do invariante de 25/09/2026 que este checkpoint substitui e
 * amplia (o antigo só enxergava VERBO_EDICAO; "adiciona o Matheus também"
 * passava por ele).
 */
export function assertNotUpdateMisroutedAsCreate(params: {
  message: string;
  lastTaskId: string | null;
  hasSelectionFocus: boolean;
}): AntiCreateVerdict {
  const { message } = params;
  const temRecursoExistente =
    params.lastTaskId !== null || params.hasSelectionFocus || EXPLICIT_TASK_REFERENCE.test(message);
  if (!temRecursoExistente) return { allowed: true, signals: [] };
  if (CREATE_TASK.test(message) && !CRIACAO_SUBORDINADA_RE.test(message)) return { allowed: true, signals: [] };

  const potencial = detectExternalWritePotential(message);
  const signals = [...(potencial?.signals ?? [])];
  if (
    (REFERENCE_WORDS.test(message) || REFERENTE_FOCO_RE.test(message) || REFERENTE_EXTRA_RE.test(message)) &&
    !signals.includes('referente_na_mensagem')
  ) {
    signals.push('referente_na_mensagem');
  }
  if (signals.length === 0) return { allowed: true, signals: [] };
  return { allowed: false, signals };
}

/**
 * P0-01 (22/09/2026): só reconhecia "revisão" ou "pronto/concluído" —
 * "altere essa task para em andamento" não mapeava pra nenhum status real e
 * caía no `status_sem_mapeamento` do caller, quando a lista tinha um status
 * "em andamento" de verdade. Ordem importa: cada categoria checa o HINT
 * primeiro (o que a pessoa pediu), só então procura na lista real — nunca o
 * contrário, que inventaria status.
 *
 * Achado real no E2E de release (22/09/2026, lista de QA "Cliente Teste
 * 7"): status do ClickUp em INGLÊS ("complete") não casava com o padrão do
 * lado da LISTA — só o hint do usuário ("pronto") era checado em português.
 * "altere essa task para o status pronto" (reprodução exata do P0-01
 * original) caía em "não consegui mapear", mesmo a lista tendo um status de
 * conclusão de verdade. O padrão do lado da lista precisa reconhecer as
 * duas línguas: quem hospeda a conta ClickUp escolhe o idioma do status,
 * não quem fala com o Bento.
 */
export function mapStatusHintToRealStatus(hint: string, statuses: string[]): string | undefined {
  return /revis/i.test(hint)
    ? statuses.find((status) => /revis/i.test(status))
    : /(pront|conclu|feito|encerr)/i.test(hint)
      ? statuses.find((status) => /(pront|conclu|feito|encerr|complet|done|closed|finish)/i.test(status))
      : /(andamento|progress|fazendo|doing)/i.test(hint)
        ? statuses.find((status) => /(andamento|progress|fazendo|doing|in\s*progress)/i.test(status))
        : /(aberto|to\s*do|a\s*fazer|open)/i.test(hint)
          ? statuses.find((status) => /(aberto|to\s*do|a\s*fazer|open|new|backlog)/i.test(status))
          : undefined;
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

/**
 * QA 28/09/2026: quando o BENTO_OPENAI_CORE_ENABLED está ligado, o planner
 * (LLM) roda ANTES deste guard — e uma resposta pura de confirmação ("sim,
 * confirmo") não carrega nenhum verbo de exclusão, então o planner não tem
 * como saber que está diante de uma confirmação pendente e classifica
 * errado (achado ao vivo: virou "não identifiquei o que devo alterar").
 * Checagem determinística, sem LLM, que `execute-job.ts` usa para desviar
 * do core DIRETO pro guard legado quando a ÚLTIMA resposta do assistente é
 * a própria pergunta de confirmação de delete — só então "sim"/"confirmo"
 * tem uma chance de ser interpretado corretamente.
 */
export async function hasPendingDeleteConfirmation(conversationId: string | null): Promise<boolean> {
  if (!conversationId) return false;
  const [lastAssistant] = await db
    .select({ content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.role, 'assistant')))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1)
    .catch(() => []);
  return Boolean(lastAssistant?.content && DELETE_CONFIRM_TASK_ID.test(lastAssistant.content));
}

async function loadConversationContext(
  conversationId: string | null,
  agent = 'bento',
  config: ClickUpConfig | null = null,
): Promise<ConversationContext> {
  if (!conversationId) return { lastTaskId: null, lastTaskName: null, lastPersonName: null, previousAttachments: [], solicitacaoAnterior: null, pendingDeleteTaskId: null, selection: null };
  const recent = await db
    .select({
      role: schema.messages.role,
      agent: schema.messages.agent,
      content: schema.messages.content,
      attachmentUrl: schema.messages.attachmentUrl,
      attachmentType: schema.messages.attachmentType,
      attachmentFilename: schema.messages.attachmentFilename,
      metadata: schema.messages.metadata,
    })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(40);

  let lastTaskId: string | null = null;
  let lastTaskName: string | null = null;
  let lastPersonName: string | null = null;
  let pendingDeleteTaskId: string | null = null;
  // A seleção mais recente da conversa, lida da metadata gravada pela API no
  // turno da listagem. Sobrevive a reload porque nunca morou em memória.
  let selection: SelectionSnapshot | null = null;
  for (const message of recent) {
    if (selection) break;
    selection = parseSelectionSnapshot((message.metadata as { selecao?: unknown } | null)?.selecao);
  }
  let vistoPrimeiroAssistente = false;
  // A mensagem ATUAL já está gravada quando o guard roda: a solicitação
  // anterior é a primeira mensagem de usuário que não é ela.
  let solicitacaoAnterior: string | null = null;
  let achouAMensagemAtual = false;
  /**
   * "tenho a solicitação acima" quase sempre vem com o material num turno
   * ANTERIOR. Sem ler os anexos das mensagens recentes, a task nascia sem a
   * única coisa que o designer precisava abrir — e o chat virava o lugar onde
   * o arquivo mora, que é exatamente o que uma task deveria evitar.
   */
  const previousAttachments: TaskAttachment[] = [];
  for (const message of recent) {
    if (message.role !== 'user') continue;
    for (const a of anexosDaMensagem(message)) {
      if (!previousAttachments.some((x) => x.url === a.url)) previousAttachments.push({ ...a, fromPreviousTurn: true });
    }
  }
  let lastTaskIdResolved = false;
  for (const message of recent) {
    if (!lastTaskIdResolved && message.role === 'assistant') {
      const urls = [...message.content.matchAll(TASK_URL)];
      if (urls.length === 1) {
        // Uma task só citada — confirmação de CREATE/READ/UPDATE de uma
        // operação singular. Essa é "a task" que "essa"/"muda o status"
        // legitimamente resolve.
        lastTaskId = urls[0]![1]!;
        lastTaskIdResolved = true;
      } else if (urls.length > 1) {
        // Resposta de LISTA (várias demandas). Não existe "a task" aqui —
        // escolher a última da lista por acaso da ordem em que apareceu é
        // exatamente o que fazia "e a segunda?"/"e o prazo?" virar update
        // sobre uma task arbitrária, nunca escolhida pelo usuário. Trava a
        // busca neste ponto (não deixa cair numa referência mais antiga,
        // que já não é o que está na tela do usuário) — o resultado é
        // "sem task resolvida", que já tem resposta honesta própria.
        lastTaskIdResolved = true;
      }
    }
    // Confirmação de exclusão só é válida quando vem IMEDIATAMENTE depois da
    // pergunta do guard — ou seja, quando a mensagem mais recente do
    // assistente (a primeira encontrada, por causa do desc por createdAt) é
    // ela mesma o pedido de confirmação. Uma resposta a QUALQUER outra
    // pergunta do assistente não reativa uma exclusão pendente antiga.
    if (!vistoPrimeiroAssistente && message.role === 'assistant') {
      vistoPrimeiroAssistente = true;
      const match = message.content.match(DELETE_CONFIRM_TASK_ID);
      if (match) pendingDeleteTaskId = match[1]!;
    }
    if (!lastPersonName && message.role === 'user') {
      lastPersonName = extractPersonName(message.content);
    }
    if (message.role === 'user') {
      // Pula a primeira mensagem de usuário da lista (a mais recente = a
      // atual) e guarda a anterior. Comparar por identidade de conteúdo é
      // frágil; a ordem desc por createdAt garante que a primeira é a atual.
      if (!achouAMensagemAtual) {
        achouAMensagemAtual = true;
      } else if (!solicitacaoAnterior && ehMaterialDeDemanda(message.content)) {
        solicitacaoAnterior = message.content;
      }
    }
  }
  /**
   * NOME REAL, não fragmento da fala do agente. Achado real (21/09/2026): o
   * regex antigo lia o nome da task de dentro da PRÓPRIA resposta do Bento
   * ("Separei a demanda e criei a task na Cliente Teste 7. Reli cada uma...")
   * e pegava "na Cliente Teste 7. Reli cada uma" como se fosse o título —
   * lixo que ia direto pro prefixo de toda resposta de update seguinte. A
   * ÚNICA fonte confiável do nome de um recurso é o próprio recurso.
   */
  if (lastTaskId && config) {
    lastTaskName = await getTask(config, lastTaskId).then((t) => t.name).catch(() => null);
  }
  return { lastTaskId, lastTaskName, lastPersonName, previousAttachments, solicitacaoAnterior, pendingDeleteTaskId,
    selection,
    lastArtifact: conversationArtifact([...recent].reverse(), agent) };
}

/**
 * Anexos de uma linha de `messages`. A rota do chat grava o PRIMEIRO anexo nas
 * colunas dedicadas e a lista completa em `metadata.attachments` (ver
 * apps/api/src/chat/routes.ts) — ler os dois é o que evita perder o segundo
 * arquivo de uma solicitação com print e PDF juntos.
 */
function anexosDaMensagem(row: {
  attachmentUrl: string | null;
  attachmentType: string | null;
  attachmentFilename: string | null;
  metadata: Record<string, unknown>;
}): TaskAttachment[] {
  const achados: TaskAttachment[] = [];
  const lista = Array.isArray(row.metadata?.attachments) ? (row.metadata.attachments as unknown[]) : [];
  for (const item of lista) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as { url?: unknown; filename?: unknown; contentType?: unknown };
    if (typeof a.url !== 'string' || a.url.length === 0) continue;
    achados.push({
      url: a.url,
      filename: typeof a.filename === 'string' && a.filename ? a.filename : nomeDaUrl(a.url),
      contentType: typeof a.contentType === 'string' ? a.contentType : null,
    });
  }
  if (achados.length === 0 && row.attachmentUrl) {
    achados.push({
      url: row.attachmentUrl,
      filename: row.attachmentFilename ?? nomeDaUrl(row.attachmentUrl),
      contentType: row.attachmentType,
    });
  }
  return achados;
}

function nomeDaUrl(url: string): string {
  const bruto = url.split('?')[0]?.split('/').pop() ?? 'arquivo';
  try {
    return decodeURIComponent(bruto) || 'arquivo';
  } catch {
    return bruto || 'arquivo';
  }
}

/**
 * ALLOWLIST DE EMERGÊNCIA — nariz de cera opcional, não é mais o portão
 * principal de produção (esse virou capacidade/papel, já checado antes de
 * chegar aqui via `seniorToolContext.permissions`). Continua existindo só
 * pra operação poder estreitar o raio na mão sem deploy de código, do jeito
 * que fez durante a homologação:
 *
 *   BENTO_WRITE_ALLOWLIST=tammy@institutoalmada.org
 *
 * Vazio/unset (padrão de produção) = a allowlist não filtra ninguém; quem
 * chegou até aqui já provou capacidade (`clickup:write`) e organização.
 */
export function bentoWriteAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.BENTO_WRITE_ALLOWLIST?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0));
}

/**
 * IDENTIDADE DO BOT DE QA — não é papel nem organização, é uma conta fixa de
 * teste automatizado. O raio dela é sempre o cliente de QA, nunca a carteira
 * real, e essa restrição é estrutural: não depende da allowlist de
 * emergência estar configurada ou não.
 */
export function ehQaBot(email: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const configurado = (env.BENTO_QA_BOT_EMAIL ?? 'qa-bot@institutoalmada.org').trim().toLowerCase();
  return email !== null && email.toLowerCase() === configurado;
}

function ehClienteDeQa(clientName: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const configurado = (env.BENTO_QA_CLIENT_NAME ?? 'Cliente Teste 7').trim().toLowerCase();
  return typeof clientName === 'string' && clientName.trim().toLowerCase() === configurado;
}

/**
 * PORTÃO DE PRODUÇÃO — substitui o allowlist fixo de homologação por
 * papel/capacidade real (achado no aceite: `super@institutoalmada.org`
 * tinha `clickup:write` pela RBAC e mesmo assim era recusado só por não
 * estar no allowlist por e-mail).
 *
 * Nesta altura da chamada, `seniorToolContext.permissions` já garantiu
 * capacidade (`clickup:write`, via papel master/colaborador) e
 * `loadSeniorRuntimeContext` já garantiu organização (o `organizationId`
 * resolvido bateu com uma membership do usuário) — cross-tenant já morreu
 * antes daqui. O que falta checar aqui é só:
 *
 *   1. allowlist de emergência, SE estiver configurada (operação estreitando
 *      o raio na mão);
 *   2. bot de QA só escreve no cliente de QA, nunca na carteira real —
 *      mesmo tendo a mesma capacidade RBAC que qualquer colaborador.
 */
export function podeEscreverEmProducao(
  params: { userEmail: string | null; clientName?: string | null | undefined },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const lista = bentoWriteAllowlist(env);
  if (lista.size > 0 && (params.userEmail === null || !lista.has(params.userEmail.toLowerCase()))) {
    return false;
  }
  if (ehQaBot(params.userEmail, env)) return ehClienteDeQa(params.clientName, env);
  return true;
}

/**
 * A "solicitação acima" é MATERIAL, nunca outra ordem.
 *
 * Medido no aceite pelo frontend (18/09/2026): a Tammy repetiu o mesmo pedido
 * duas vezes. Na segunda, a mensagem anterior já era a própria ordem ("Bento,
 * tenho a solicitação acima..."), ela entrou como material, e o título saiu
 * "Criar Bento, tenho a solicitação acima. Separa e lança pro Gui...". Título
 * diferente do primeiro, então a idempotência não reconheceu a demanda e uma
 * SEGUNDA task nasceu (86bc36nvw) — uma duplicata com nome de mensagem de
 * chat, que é exatamente o defeito de 15/09 voltando por outra porta.
 *
 * Uma ordem operacional descreve o que FAZER com a demanda; ela não é a
 * demanda. E meta-conversa sobre a ação ("não cria ainda", perguntas) também
 * não é. Só texto que é o trabalho em si vira material.
 */
export function ehMaterialDeDemanda(texto: string): boolean {
  const limpo = texto.trim();
  // Piso de tamanho: "valeu, obrigada" não é ordem e também não é a demanda.
  // Uma solicitação colada tem corpo; um aceno tem quinze caracteres.
  if (limpo.length < 40) return false;
  if (/\b(acima|anterior)\b/i.test(limpo) && limpo.length < 200) return false;
  // Pergunta é pedido de resposta ("como está a operação?"), não descrição de
  // demanda — inclusive quando a pergunta vem no meio e o texto não termina
  // em "?".
  if (limpo.endsWith('?')) return false;
  /**
   * A régua não pode ser só "não autoriza escrita". Medido no aceite
   * (18/09/2026): o turno "Bento, não cria nada ainda, só analisa" tem
   * writeAuthorized=false — entrou como material, virou item do plano e virou
   * task CRIADA com a frase da negação no título. Fala SOBRE a ação (negada
   * ou restrita) é meta-conversa com o agente, não é o trabalho.
   *
   * No outro sentido: a solicitação do cliente ("Chegou uma solicitação nova:
   * precisamos de um roteiro...") descreve o trabalho e é material, mesmo
   * quando o texto traz vocabulário operacional.
   */
  const v2 = classifyActionIntentV2(limpo);
  if (v2.writeAuthorized) return false;
  if (v2.negations.length > 0 && v2.signals.length > 0) return false;
  // Pedido de análise/panorama dirigido ao agente ("me conta", "como está",
  // "me explica") é conversa, não demanda — mesmo sem "?" no fim.
  if (v2.signals.length === 0 && /\b(me conta|me explica|me diz|me mostra|me fala|como est[aá]|como t[aá])\b/i.test(limpo)) {
    return false;
  }
  return true;
}

/**
 * IDENTIDADE DAS ESCRITAS DO BENTO (28/09/2026, relato da Tammy).
 *
 * O ClickUp atribui toda ação ao DONO DO TOKEN. Com a chave pessoal do Pedro,
 * a Tammy recebeu "Pedro atribuiu essa task a você" quando quem atribuiu foi o
 * Bento, a pedido dela. A notificação mente sobre quem agiu, e num time sênior
 * isso vira decisão errada — a pessoa responde ao humano errado.
 *
 * A conta "Bento Desigual" já existe no workspace (membro 112266418). Basta um
 * token pessoal dela em CLICKUP_BOT_API_KEY e TODA escrita do Bento passa a
 * aparecer como Bento. Sem a variável, nada muda: continua a chave de sempre.
 *
 * Vale para o Bento e só pra ele — Otto, Jarbas, Suzy, Studio e as automações
 * montam o config por conta própria e seguem com a chave da agência.
 */
export function getClickUpConfigOrNull(): ClickUpConfig | null {
  const apiKey = process.env.CLICKUP_BOT_API_KEY?.trim() || process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Checagem barata de seleção existente, pro early-return de pedido criativo:
 * uma query de metadata, sem ClickUp. O snapshot completo é carregado depois
 * por `loadConversationContext` — aqui só interessa SE existe.
 */
async function selectionSnapshotExists(conversationId: string): Promise<boolean> {
  return (await loadSelectionSnapshot(conversationId)) !== null;
}

/** Leitura leve do snapshot de seleção (só banco, sem ClickUp). */
/**
 * O MESMO SNAPSHOT, QUANDO A CONVERSA É NOVA (28/09/2026, relato da Tammy).
 *
 * Ela listou tarefas num chat, mexeu numa delas, abriu OUTRO chat e mandou o
 * pedido já com o NOME da task. O Bento não sabia de nada — não porque falte
 * memória no sistema, mas porque a memória que existe (`metadata.selecao`, a
 * mesma que resolve "item 11" e nome de task) é lida só dentro da conversa
 * corrente. Chat novo, leitura vazia, e a ponte determinística que já
 * funcionava nem chegava a rodar.
 *
 * Aqui a leitura passa a atravessar a conversa: não achando snapshot no chat
 * atual, pega o mais recente DESSA PESSOA, em qualquer conversa, dentro de uma
 * janela curta. É a mesma estrutura e o mesmo dado — muda só o alcance.
 *
 * A janela é curta de propósito. Memória operacional envelhece: a lista de
 * ontem não descreve a operação de hoje, e ressuscitar um conjunto velho é
 * pior que não ter conjunto nenhum.
 */
const JANELA_MEMORIA_ENTRE_CONVERSAS_HORAS = 12;

export interface SnapshotComOrigem {
  snapshot: SelectionSnapshot;
  /** 'conversa' = deste chat. 'outra_conversa' = herdado; o chamador decide o que aceitar. */
  origem: 'conversa' | 'outra_conversa';
}

export async function loadSelectionSnapshotComFallback(
  conversationId: string,
  userId: string | null,
): Promise<SnapshotComOrigem | null> {
  const daConversa = await loadSelectionSnapshot(conversationId);
  if (daConversa) return { snapshot: daConversa, origem: 'conversa' };
  if (!userId) return null;

  const desde = new Date(Date.now() - JANELA_MEMORIA_ENTRE_CONVERSAS_HORAS * 3_600_000);
  const linhas = await db
    .select({ metadata: schema.messages.metadata })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.conversations.userId, userId), gt(schema.messages.createdAt, desde)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(40)
    .catch(() => []);
  for (const l of linhas) {
    const parsed = parseSelectionSnapshot((l.metadata as { selecao?: unknown } | null)?.selecao);
    if (parsed) return { snapshot: parsed, origem: 'outra_conversa' };
  }
  return null;
}

export async function loadSelectionSnapshot(conversationId: string): Promise<SelectionSnapshot | null> {
  const linhas = await db
    .select({ metadata: schema.messages.metadata })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(12)
    .catch(() => []);
  for (const l of linhas) {
    const parsed = parseSelectionSnapshot((l.metadata as { selecao?: unknown } | null)?.selecao);
    if (parsed) return parsed;
  }
  return null;
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

/**
 * DELETE, segunda volta: já confirmado ("sim"), já passou por
 * permissão/canary — só falta alvo (já resolvido: `taskId`), execução e
 * READ-BACK DE AUSÊNCIA (nunca declara sucesso só porque a chamada não jogou
 * erro).
 */
/**
 * 404 CONFIRMADO ("a task não existe") é uma resposta bem diferente de
 * "não consegui checar" (timeout, rate limit, instabilidade de rede) — mas
 * `getTask(...).catch(() => null/false)` tratava as duas igual. Achado real
 * no E2E de release (22/09/2026): um erro transitório na checagem PRÉ-delete
 * fez o guard responder "já pode ter sido apagada antes" quando a task
 * seguia intacta (nunca tentou apagar, e a mensagem sugeria que sim). O
 * mesmo padrão do lado PÓS-delete seria pior: um erro transitório ali vira
 * `aindaExiste = false`, que é literalmente "SUCESSO CONFIRMADO" mesmo
 * quando o delete pode ter falhado silenciosamente — a categoria exata de
 * falsa confirmação que este release inteiro existe pra fechar.
 *
 * `null` aqui significa "não sei", nunca "não existe" — quem chama decide o
 * que fazer com a incerteza, em vez de o helper decidir por omissão.
 */
export async function taskExisteForTest(config: ClickUpConfig, taskId: string): Promise<boolean | null> {
  return taskExiste(config, taskId);
}

async function taskExiste(config: ClickUpConfig, taskId: string): Promise<boolean | null> {
  try {
    await getTask(config, taskId);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return /\(404\)/.test(detail) ? false : null;
  }
}

/**
 * ALVO CITADO É AUTORIZADO PRO CONTEXTO ATUAL. Achado na auditoria sênior
 * (24/09/2026), consequência direta de abrir escrita de produção pra
 * clientes reais nesta mesma missão: nada verificava que um ID/URL de task
 * CITADO NA MENSAGEM (extractExplicitTaskIdFromMessage) ou herdado do
 * histórico (context.lastTaskId) pertencia ao cliente resolvido da
 * conversa. Um colaborador com acesso ao Cliente A podia colar o link de
 * uma task do Cliente B e mutar lá — a checagem de organização valida o
 * USUÁRIO contra o cliente da CONVERSA (loadSeniorRuntimeContext), nunca a
 * TASK citada contra esse mesmo cliente.
 *
 * PARA ESCRITA, FALHA FECHADA — revisão da versão anterior (que deixava
 * passar em qualquer caso inconclusivo): mutação nunca pode seguir sem
 * confirmação positiva. Três resultados:
 *
 *   'match'    — a task pertence ao cliente ATIVO da conversa; ou, em
 *                conversa de escopo agência (sem cliente único), pertence
 *                a um cliente da MESMA organização do usuário.
 *   'mismatch' — pertence a outro cliente (mesma org ou org diferente).
 *                Mesmo dentro da mesma org, cliente diferente do ativo é
 *                mismatch: "trocar de cliente" é uma decisão explícita do
 *                turno (clientId muda), nunca inferida da task citada.
 *   'unknown'  — não deu pra confirmar (lookup falhou, a lista da task não
 *                bate com NENHUM cliente cadastrado, ou não há cliente
 *                ativo nem organização pra comparar). Chamador de ESCRITA
 *                trata 'unknown' IGUAL a 'mismatch': nenhuma mutação sem
 *                prova positiva. Leitura pode ser mais tolerante — ver
 *                comentário no portão de leitura, se/quando existir.
 */
export type TaskClientAuthorization = 'match' | 'mismatch' | 'unknown';

export async function resolveTaskClientAuthorizationForTest(
  config: ClickUpConfig,
  taskId: string,
  activeClientId: string | null,
  activeOrganizationId: string | null,
): Promise<TaskClientAuthorization> {
  return resolveTaskClientAuthorization(config, taskId, activeClientId, activeOrganizationId);
}

async function resolveTaskClientAuthorization(
  config: ClickUpConfig,
  taskId: string,
  activeClientId: string | null,
  activeOrganizationId: string | null,
): Promise<TaskClientAuthorization> {
  let listaReal: string;
  try {
    listaReal = await getTaskListId(config, taskId);
  } catch {
    return 'unknown';
  }
  const [dono] = await db
    .select({ id: schema.clients.id, organizationId: schema.clients.organizationId })
    .from(schema.clients)
    .where(eq(schema.clients.clickupListId, listaReal))
    .limit(1)
    .catch(() => []);
  if (!dono) return 'unknown';
  if (activeClientId) return dono.id === activeClientId ? 'match' : 'mismatch';
  if (activeOrganizationId && dono.organizationId) {
    return dono.organizationId === activeOrganizationId ? 'match' : 'mismatch';
  }
  return 'unknown';
}

async function executeConfirmedDelete(config: ClickUpConfig, taskId: string, logger: Logger): Promise<ExecuteResponse> {
  const toolCalls: { tool: string; input_summary: string; ok: boolean; duration_ms: number; error?: string }[] = [];
  const start = performance.now();
  const record = (tool: string, input: string, ok: boolean, error?: string) => {
    toolCalls.push({ tool, input_summary: input, ok, duration_ms: Math.round(performance.now() - start), ...(error ? { error } : {}) });
  };
  // LATÊNCIA (P1 ao vivo, 28/09/2026): taskExiste() é literalmente getTask()
  // por dentro (linha ~1217) descartando o resultado — só pra saber se
  // existe — e o getTask() logo abaixo repetia a MESMA chamada de rede de
  // novo, só pra pegar `.name`. Uma leitura só decide os três ramos (existe
  // com dado / 404 / erro desconhecido) sem perder nenhuma distinção que já
  // existia; o read-back de AUSÊNCIA depois do delete continua sendo uma
  // segunda chamada de verdade, porque verifica um estado diferente (depois
  // da mutação), não o mesmo antes de mutar nada.
  let antes: TaskDetail | null = null;
  let lookupFailed = false;
  try {
    antes = await getTask(config, taskId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!/\(404\)/.test(detail)) lookupFailed = true;
  }
  if (lookupFailed) {
    return guardResponse({
      ok: false,
      toolCalls,
      answer: `Não consegui checar a task (${taskId}) no ClickUp antes de apagar — pode ter sido uma instabilidade de rede. Não apaguei nada; tenta de novo em instantes.`,
      metadata: { guard: 'bento-action', action: 'delete', task_id: taskId, errorCode: 'CLICKUP_LOOKUP_FAILED', verified: false },
    });
  }
  if (!antes) {
    return guardResponse({
      ok: true,
      toolCalls,
      answer: `Não encontrei mais a task (${taskId}) no ClickUp — já pode ter sido apagada antes.`,
      metadata: { guard: 'bento-action', action: 'delete', task_id: taskId, reason: 'task_nao_encontrada' },
    });
  }
  try {
    await deleteTask(config, taskId);
    record('clickup.delete_task', taskId, true);
    const aindaExisteDepois = await taskExiste(config, taskId);
    const aindaExiste = aindaExisteDepois !== false;
    record(
      'clickup.get_task',
      `read-back-absence ${taskId}`,
      !aindaExiste,
      aindaExisteDepois === null ? 'não consegui reler pra confirmar ausência' : aindaExiste ? 'task ainda existe após delete' : undefined,
    );
    logger.info({ intent_classification: 'delete', task_id: taskId, confirmed: true, verified: !aindaExiste, read_back_uncertain: aindaExisteDepois === null }, '[guard] exclusão executada');
    return guardResponse({
      ok: true,
      toolCalls,
      answer:
        aindaExisteDepois === null
          ? `Enviei a exclusão da task "${antes.name}" (${taskId}), mas não consegui reler pra confirmar a ausência. Confere no ClickUp.`
          : aindaExiste
            ? `Enviei a exclusão da task "${antes.name}" (${taskId}), mas ao reler ela ainda aparece no ClickUp. Confere lá — não confirmo sucesso sem isso.`
            : `Task "${antes.name}" (${taskId}) apagada e CONFIRMADA por leitura: ela não existe mais no ClickUp.`,
      metadata: { guard: 'bento-action', action: 'delete', task_id: taskId, verified: !aindaExiste, read_back_uncertain: aindaExisteDepois === null },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record('clickup.delete_task', taskId, false, detail);
    return guardResponse({
      ok: false,
      toolCalls,
      answer: `Não consegui apagar a task no ClickUp: ${detail}`,
      metadata: { guard: 'bento-action', action: 'delete', task_id: taskId, errorCode: 'CLICKUP_DELETE_FAILED' },
    });
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

export function detectDeleteScopeCorrectionForTest(message: string): boolean {
  return detectDeleteScopeCorrection(message);
}

/** Ver docstring de uso no guard: correção de escopo de delete = edição de
 * conteúdo na MESMA task, nunca negação de escrita. */
function detectDeleteScopeCorrection(message: string): boolean {
  return (
    /\b(n[aã]o|nn)\b[^.!?]{0,60}\b(apag|delet|exclu|remov)/i.test(message) &&
    /\b(task|tarefa|demanda|ela|essa|dela|dessa)\b/i.test(message) &&
    /\b(conte[úu]do|briefing|descri[çc][ãa]o|texto|s[óo])\b/i.test(message)
  );
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
  /** E-mail de login — é a chave do allowlist do canary. */
  userEmail?: string | null;
  seniorToolContext?: SeniorToolContext | null;
  agencyListId: string | null;
  briefingWriter: (prompt: string) => Promise<string | null>;
  /** Cliente da execução, quando houver: é a chave do retrieval do briefing. */
  clientId?: string | null;
  clientName?: string | null;
  /** Anexos do turno ATUAL (o print/PDF que veio junto do pedido). */
  attachments?: TaskAttachment[];
  logger: Logger;
}): Promise<ExecuteResponse | null> {
  const { message, conversationId, logger } = params;
  if (params.seniorToolContext && !requestsExternalTask(message) && /\b(cri[ae]|faz|fa[cç]a|mont[ae])\b/i.test(message) && /briefing|reel|roteiro|copy|legenda|conceito/i.test(message)) {
    /**
     * EXCEÇÃO DA SELEÇÃO (24/09/2026): "crie um briefing detalhado de cada uma
     * DELAS e lança pro Pedro" não é pedido criativo — é ESCRITA sobre o
     * conjunto que a conversa acabou de listar. Este early-return devolvia
     * null, o turno caía no serviço remoto sem memória, e a resposta era um
     * trabalho global de 1209 tasks sem relação com as 10 selecionadas.
     * Só vale o retorno cedo quando NÃO há referência a uma seleção existente.
     */
    const referencia = detectSelectionReference(message);
    const selecaoExiste = referencia && conversationId ? await selectionSnapshotExists(conversationId) : false;
    if (!selecaoExiste) return null;
  }

  // HANDOFF BENTO -> JARBAS (missão de wiring operacional, 24/09/2026).
  // Ponto único de contato — tryJarbasHandoff é o único lugar que sabe
  // qualquer coisa sobre AgentTask/Jarbas V2. Devolve null quando a
  // mensagem não é handoff/status, e o resto do guard segue como sempre.
  const jarbasHandoff = await tryJarbasHandoff({
    message,
    conversationId,
    userEmail: params.userEmail ?? null,
    clientId: params.clientId ?? null,
    clientName: params.clientName ?? null,
    seniorToolContext: params.seniorToolContext ?? null,
  });
  if (jarbasHandoff) {
    return guardResponse({ ok: true, toolCalls: [], answer: jarbasHandoff.answer, metadata: jarbasHandoff.metadata });
  }

  /**
   * SEGUNDA VOLTA DA CONFIRMAÇÃO DE EXCLUSÃO — precisa rodar ANTES do portão
   * de `classifyActionIntent` logo abaixo: uma resposta como "sim" não tem
   * verbo de família nenhuma, `acao.writeAuthorized` sairia `false`, e o
   * pedido cairia no agente remoto sem nunca apagar nada, mesmo já tendo
   * pedido e recebido confirmação explícita no turno anterior.
   *
   * Filtro barato ANTES de qualquer DB: só carrega o contexto da conversa
   * (query real) quando a mensagem em si já parece uma afirmação — o volume
   * normal de chat (análise, perguntas) nunca paga essa consulta extra.
   */
  if (DELETE_AFFIRMATIVE.test(message.trim())) {
    const confirmConfigBase = getClickUpConfigOrNull();
    const confirmConfig = confirmConfigBase
      ? { ...confirmConfigBase, writeScope: { authorizedForProduction: !ehQaBot(params.userEmail ?? null) } }
      : null;
    if (confirmConfig) {
      const confirmContext = await loadConversationContext(conversationId, params.seniorToolContext?.agent, confirmConfig);
      if (confirmContext.pendingDeleteTaskId) {
        if (params.seniorToolContext === null || (params.seniorToolContext && !params.seniorToolContext.permissions.some((p) => p.resource === 'clickup' && p.action === 'write'))) {
          return guardResponse({ ok: false, toolCalls: [], answer: 'Não fiz alterações: não consegui validar sua organização e permissão de escrita no ClickUp.', metadata: { errorCode: 'PERMISSION_DENIED', verified: false } });
        }
        if (!podeEscreverEmProducao({ userEmail: params.userEmail ?? null, clientName: params.clientName })) {
          return guardResponse({
            ok: true,
            toolCalls: [],
            answer: 'Entendi a confirmação, mas apagar task nesse cliente não está autorizado pra essa conta — não vou executar por enquanto.',
            metadata: { guard: 'bento-action', action: 'blocked_write_authz', write_authorized: false, write_reason: 'fora da autorização de produção do Bento' },
          });
        }
        const autorizacao = await resolveTaskClientAuthorization(
          confirmConfig,
          confirmContext.pendingDeleteTaskId,
          params.clientId ?? null,
          params.seniorToolContext?.organizationId ?? null,
        );
        if (autorizacao !== 'match') {
          logger.warn(
            { task_id: confirmContext.pendingDeleteTaskId, client_id: params.clientId ?? null, authorization: autorizacao },
            '[guard] DELETE recusado: não confirmei que a task citada pertence ao contexto ativo',
          );
          return guardResponse({
            ok: true,
            toolCalls: [],
            answer:
              autorizacao === 'unknown'
                ? 'Não consegui confirmar que essa task pertence ao cliente ativo, então não apaguei nada.'
                : 'Não encontrei essa task neste cliente — não apaguei nada.',
            metadata: { guard: 'bento-action', action: 'denied_cross_client_target', write_authorized: false, verified: false, authorization: autorizacao },
          });
        }
        return executeConfirmedDelete(confirmConfig, confirmContext.pendingDeleteTaskId, logger);
      }
    }
  }

  // PORTÃO 1 — ANÁLISE NÃO É ESCRITA. Classificação determinística ANTES de
  // qualquer ferramenta. Caso real: pedido de análise virou task na hora.
  const acao = classifyActionIntent(message);

  /**
   * CORREÇÃO DE ESCOPO (25/09/2026, incidente Tammy): "nn e pra apagar a task,
   * e pra deletar o conteúdo dela" — o usuário REPARANDO a leitura errada do
   * turno anterior. O alvo (a task focada) se mantém; a operação vira edição
   * de conteúdo. Não é negação de escrita: é correção de objeto.
   */
  const ehCorrecaoDeDelete = detectDeleteScopeCorrection(message);

  // O HARD DENY de "concluir/fechar trabalho humano" foi REMOVIDO em
  // 28/09/2026 por decisão da operação: o Bento atende um time sênior, e
  // quando a pessoa manda fechar a decisão é dela. O risco que o deny cobria
  // (status falso quebrando o planejamento de todo mundo) agora é coberto por
  // procedência — o fechamento registra quem pediu e o read-back confirma o
  // status real no ClickUp. `FORBIDDEN_ACTION` continua no tipo porque nada
  // mais o produz; se voltar a existir uma fronteira de verdade, ela reaparece
  // aqui com a recusa explícita.

  /**
   * NEGAÇÃO EXPLÍCITA nunca pode seguir pro agente remoto. Achado real no
   * E2E de release (22/09/2026): "Analisa a Cliente Teste 7, mas não cria
   * nem altera nenhuma task." — o guard corretamente recusava a ESCREVER
   * (acao.writeAuthorized=false) e devolvia null, "seguindo pra análise".
   * Mas o agente remoto tem ferramenta de escrita autônoma própria, e NADA
   * além do PROMPT lembrava ele da negação — ele criou a task mesmo assim,
   * de verdade, numa lista real ("Agência Desigual"), sob um bot próprio
   * ("Bento Desigual"). "Unknown operation = no mutation" não bastava aqui:
   * a operação nem era desconhecida, era EXPLICITAMENTE PROIBIDA pela
   * própria pessoa, e mesmo assim o sistema escreveu.
   *
   * A defesa não pode ser "lembrar o agente remoto melhor" (prompt não é
   * capability gate — é o mesmo princípio do P1-08 da auditoria, pra
   * Jarbas/Suzy). Tem que ser estrutural: quando a NEGAÇÃO é do próprio
   * verbo (não "operação não reconhecida"), o guard responde aqui mesmo,
   * sem tool nenhuma — nunca despacha pro node que TEM ferramenta.
   */
  if (acao.negated && !ehCorrecaoDeDelete) {
    logger.info(
      { intent_classification: acao.kind, write_authorized: false, write_reason: acao.reason },
      '[guard] escrita negada explicitamente no pedido; respondendo sem despachar pro agente remoto'
    );
    return guardResponse({
      ok: true,
      toolCalls: [],
      answer: 'Entendido — não criei nem alterei nada no ClickUp, como pedido.',
      metadata: { guard: 'bento-action', action: 'negated_no_dispatch', intent_classification: acao.kind, write_authorized: false, write_reason: acao.reason },
    });
  }

  // QA 28/09/2026 (achado ao vivo — script de teste da missão): "agora apaga
  // ela" não bate em NENHUM padrão de classifyActionIntent (não é
  // update/comment/create reconhecido), então `acao.writeAuthorized` fica
  // false e o kill switch abaixo respondia esclarecimento genérico — a
  // detecção REAL de delete (isTaskDeleteRequest, mais abaixo no arquivo)
  // nunca era alcançada. Mesmo desvio que `ehCorrecaoDeDelete` já usa: um
  // pedido de exclusão de verdade não é "escrita não reconhecida", é uma
  // categoria própria com seu próprio fluxo de confirmação logo adiante.
  const ehPedidoDeDelete = isTaskDeleteRequest(message);
  if (!acao.writeAuthorized && !ehCorrecaoDeDelete && !ehPedidoDeDelete) {
    /**
     * EXCEÇÃO DE REPETIÇÃO (24/09/2026): "faz igual nas outras" / "faz o mesmo
     * nela" tem verbo fraco ("faz") e não passa no portão — mas a ORDEM real
     * está no registro da última execução, que o executor relê e revalida
     * (permissão por task, produção, read-back) como qualquer escrita. Sem
     * esta ponte, o pedido caía no serviço remoto, que respondia "não houve
     * interação anterior" logo depois de uma mutação real (medido no aceite).
     */
    const ehRepeticaoDeSelecao =
      conversationId && detectSelectionReference(message)?.kind === 'repeat'
        ? await selectionSnapshotExists(conversationId)
        : false;
    if (!ehRepeticaoDeSelecao) {
      /**
       * KILL SWITCH DE ESCRITA EXTERNA (F-01, P0 — Etapa 1 da convergência).
       * Este `return null` despachava a mensagem pro bento-qa EXTERNO, que é
       * opaco (tem credencial real de escrita, zero idempotência conhecida)
       * — 16/31 UPDATE-intent da bateria B.4 caíam aqui. Com
       * BENTO_EXTERNAL_WRITE_ENABLED=false (default), mensagem com potencial
       * de escrita NÃO devolve null: vira esclarecimento/bloqueio explícito
       * aqui mesmo, com trace estruturado. Leitura/pergunta clara segue pro
       * externo normalmente.
       */
      if (!externalWriteEnabled()) {
        const potencial = detectExternalWritePotential(message);
        if (potencial) {
          logger.warn(
            {
              intent_classification: acao.kind,
              write_authorized: false,
              write_reason: acao.reason,
              branch: 'blocked_external_write_fallback',
              signals: potencial.signals,
              metric: 'bento_fallback_external_write_blocked_total',
            },
            '[guard] kill switch: mensagem com potencial de escrita NÃO segue pro bento-qa externo; respondendo esclarecimento'
          );
          return guardResponse({
            ok: true,
            toolCalls: [],
            answer:
              'Entendi que isso parece uma alteração no ClickUp, mas não consegui confirmar com segurança o que mudar e em qual task — então não executei nada por aqui nem despachei pra fora. ' +
              'Reformula pra mim? Por exemplo: "muda o prazo da task pra amanhã", "atribui a task pro Pedro" ou "atualiza o briefing dela".',
            metadata: {
              guard: 'bento-action',
              action: 'blocked_external_write_fallback',
              intent_classification: acao.kind,
              write_authorized: false,
              write_reason: acao.reason,
              branch: 'blocked_external_write_fallback',
              signals: potencial.signals,
            },
          });
        }
      }
      logger.info(
        { intent_classification: acao.kind, write_authorized: false, write_reason: acao.reason },
        '[guard] pedido sem autorização de escrita; segue para análise'
      );
      // null = segue pro agente, que ANALISA e responde. Nenhuma escrita aqui.
      // ATENÇÃO (F-01): o "agente" é o bento-qa externo — SOMENTE-LEITURA por
      // política. Só chega aqui o que não tem potencial de escrita (kill
      // switch acima) ou o que a operação deliberadamente reabriu com
      // BENTO_EXTERNAL_WRITE_ENABLED=true (rollback; reativa F-01).
      return null;
    }
    logger.info({ executionHint: 'repeat' }, '[guard] repetição de operação da conversa; segue pro caminho de escrita validado');
  }

  if (params.seniorToolContext === null || (params.seniorToolContext && !params.seniorToolContext.permissions.some(p => p.resource === 'clickup' && p.action === 'write'))) {
    return guardResponse({ ok: false, toolCalls: [], answer: 'Não fiz alterações: não consegui validar sua organização e permissão de escrita no ClickUp.', metadata: { errorCode: 'PERMISSION_DENIED', verified: false } });
  }

  // PORTÃO DE AUTORIZAÇÃO DE PRODUÇÃO. Vem ANTES de qualquer ferramenta: quem
  // não está autorizado não dispara nem a consulta de membros do ClickUp. E a
  // recusa é explícita — deixar cair no caminho de análise faria a pessoa
  // achar que o Bento não entendeu, quando ele entendeu e está proibido.
  if (!podeEscreverEmProducao({ userEmail: params.userEmail ?? null, clientName: params.clientName })) {
    logger.info(
      { intent_classification: acao.kind, write_authorized: false, write_reason: 'fora da autorização de produção do Bento', user_email: params.userEmail ?? null },
      '[guard] escrita bloqueada: usuário fora da autorização de produção'
    );
    /**
     * A RECUSA RETÉM A OPERAÇÃO (24/09/2026): "já fez?" depois de uma escrita
     * bloqueada não pode esquecer O QUE foi pedido. Quando o pedido mirava a
     * seleção da conversa, o recibo do bloqueio carrega os ids e a pessoa-alvo
     * — lidos da metadata (banco), sem tocar em ferramenta nenhuma, então o
     * portão continua estrutural: nenhuma consulta ao ClickUp aqui.
     */
    let blockedOperation: Record<string, unknown> | undefined;
    let resposta =
      'Entendi o pedido, mas criar e alterar task no ClickUp não está autorizado pra essa conta neste cliente — não vou escrever por enquanto. ' +
      'Posso organizar a demanda, montar o briefing e te dizer exatamente o que lançar.';
    if (conversationId) {
      const selecaoBloqueada = await loadSelectionSnapshot(conversationId).catch(() => null);
      const refBloqueada = selecaoBloqueada ? detectSelectionReference(message) : null;
      if (selecaoBloqueada && refBloqueada) {
        const resolvida = resolveSelectionReference(selecaoBloqueada, refBloqueada);
        if (resolvida && resolvida.tasks.length > 0) {
          const pessoa = extractPersonName(message) ?? extractPersonNameLoose(message);
          const comBriefing = BRIEFING_ASK.test(message);
          blockedOperation = {
            operation: comBriefing && pessoa ? 'briefing_assign' : comBriefing ? 'briefing' : 'assign',
            taskIds: resolvida.tasks.map((t) => t.id),
            targetPerson: pessoa,
            requested: message.slice(0, 200),
          };
          const quantas = resolvida.tasks.length;
          resposta =
            `Entendi: ${comBriefing ? `montar o briefing detalhado${pessoa ? ' e ' : ''}` : ''}${pessoa ? `atribuir a ${pessoa}` : 'atribuir'} ` +
            `${quantas === 1 ? 'a task selecionada' : `as ${quantas} tasks que eu acabei de listar`}. ` +
            'Mas esta conta não tem permissão de escrita no ClickUp, então NADA foi alterado — as tasks continuam exatamente como estão.';
        }
      }
    }
    return guardResponse({
      ok: true,
      toolCalls: [],
      answer: resposta,
      metadata: {
        guard: 'bento-action',
        action: 'blocked_write_authz',
        intent_classification: acao.kind,
        write_authorized: false,
        write_reason: 'fora da autorização de produção do Bento',
        ...(blockedOperation ? { blocked_operation: blockedOperation } : {}),
      },
    });
  }

  const configBase = getClickUpConfigOrNull();
  if (!configBase) {
    /**
     * KILL SWITCH (F-01): quem chegou até aqui passou pelo portão 1 como
     * ESCRITA (ou exceção de repetição). Sem config ClickUp local o guard não
     * pode executar — mas devolver null mandaria esse pedido de escrita pro
     * bento-qa externo (opaco, sem idempotência). Com a escrita externa
     * desabilitada, a resposta honesta é falhar fechado aqui mesmo.
     */
    if (!externalWriteEnabled()) {
      logger.warn(
        { intent_classification: acao.kind, branch: 'blocked_external_write_fallback', metric: 'bento_fallback_external_write_blocked_total' },
        '[guard] kill switch: escrita autorizada sem config ClickUp local; NÃO despachando pro bento-qa externo'
      );
      return guardResponse({
        ok: false,
        toolCalls: [],
        answer:
          'Não consegui validar a configuração do ClickUp aqui no Orchestrator, então não executei a alteração nem despachei ela pra fora. ' +
          'Avisa o time de plataforma pra revisar as credenciais do ClickUp no worker.',
        metadata: {
          guard: 'bento-action',
          action: 'blocked_external_write_fallback',
          intent_classification: acao.kind,
          write_authorized: false,
          write_reason: 'CLICKUP_API_KEY/CLICKUP_TEAM_ID ausentes no worker',
          errorCode: 'CLICKUP_CONFIG_MISSING',
          verified: false,
        },
      });
    }
    return null;
  }
  const config: ClickUpConfig = { ...configBase, writeScope: { authorizedForProduction: !ehQaBot(params.userEmail ?? null) } };

  const context = await loadConversationContext(conversationId, params.seniorToolContext?.agent, config);

  // Link explícito NESTE turno ganha do histórico — ver docstring da função.
  const alvoExplicitoNesteTurno = extractExplicitTaskIdFromMessage(message);
  if (alvoExplicitoNesteTurno) context.lastTaskId = alvoExplicitoNesteTurno;

  /**
   * FOCO DA SELEÇÃO (24/09/2026): "muda o prazo DELA pra amanhã" numa
   * conversa cuja última resposta foi uma LISTA. O resolvedor por URL recusa
   * lista de propósito (urls.length > 1 → sem task resolvida), então "dela"
   * nunca tinha alvo. Quando a referência singular resolve pra UMA task do
   * conjunto selecionado, essa task é o alvo — e passa pelo mesmo portão de
   * cliente cruzado logo abaixo, como qualquer alvo citado.
   */
  const referenciaSelecao = context.selection ? detectSelectionReference(message) : null;
  if (!context.lastTaskId && context.selection && referenciaSelecao) {
    if (
      referenciaSelecao.kind === 'focus' ||
      referenciaSelecao.kind === 'ordinal' ||
      referenciaSelecao.kind === 'name' ||
      referenciaSelecao.kind === 'attribute' ||
      (referenciaSelecao.kind === 'urgent' && referenciaSelecao.mode === 'top')
    ) {
      const resolvida = resolveSelectionReference(context.selection, referenciaSelecao);
      if (resolvida && resolvida.tasks.length === 1) {
        context.lastTaskId = resolvida.tasks[0]!.id;
        context.lastTaskName = resolvida.tasks[0]!.title;
      }
    }
  }

  // TASK CITADA É AUTORIZADA PRO CONTEXTO ATIVO — ver docstring de
  // resolveTaskClientAuthorization. Vale pra todo caminho de escrita abaixo
  // (update, comment, delete) que usa `context.lastTaskId` como alvo.
  // Falha fechada: 'mismatch' E 'unknown' bloqueiam a mutação.
  if (context.lastTaskId) {
    const autorizacao = await resolveTaskClientAuthorization(
      config,
      context.lastTaskId,
      params.clientId ?? null,
      params.seniorToolContext?.organizationId ?? null,
    );
    if (autorizacao !== 'match') {
      logger.warn(
        { task_id: context.lastTaskId, client_id: params.clientId ?? null, authorization: autorizacao },
        '[guard] escrita recusada: não confirmei que a task citada pertence ao contexto ativo',
      );
      return guardResponse({
        ok: true,
        toolCalls: [],
        answer:
          autorizacao === 'unknown'
            ? 'Não consegui confirmar que essa task pertence ao cliente ativo, então não alterei nada.'
            : 'Não encontrei essa task neste cliente — não alterei nada.',
        metadata: { guard: 'bento-action', action: 'denied_cross_client_target', write_authorized: false, verified: false, authorization: autorizacao },
      });
    }
  }

  // PEDIDO NOVO DE EXCLUSÃO (primeira volta): pede confirmação, NÃO apaga
  // ainda. A segunda volta ("sim"/"confirmo") é tratada mais acima, antes do
  // portão de `classifyActionIntent` — ver comentário lá.
  // OBJETO OBRIGATÓRIO (25/09/2026): DELETE_TASK só quando o objeto é a
  // ENTIDADE (task/tarefa/demanda/item). "delete todo o briefing" é edição de
  // conteúdo — jamais confirmação pra apagar a task.
  if (isTaskDeleteRequest(message)) {
    if (!context.lastTaskId) {
      return guardResponse({
        ok: true,
        toolCalls: [],
        answer: 'Não encontrei nenhuma task criada ou citada recentemente nesta conversa pra apagar. Me diga o nome ou o link da task no ClickUp.',
        metadata: { guard: 'bento-action', reason: 'delete_sem_alvo_resolvivel' },
      });
    }
    const prefixo = context.lastTaskName ? `"${context.lastTaskName}" ` : '';
    logger.info({ intent_classification: 'delete', task_id: context.lastTaskId, confirmed: false }, '[guard] pedido de exclusão: aguardando confirmação, nenhuma mutação ainda');
    return guardResponse({
      ok: true,
      toolCalls: [],
      answer:
        `Tem certeza que quer apagar a task ${prefixo}(${context.lastTaskId})? Essa ação não pode ser desfeita. ` +
        `Responda "sim" pra confirmar, ou qualquer outra coisa pra cancelar.\n\n${DELETE_CONFIRM_MARKER} (id:${context.lastTaskId})`,
      metadata: { guard: 'bento-action', action: 'delete_pending_confirmation', task_id: context.lastTaskId, write_authorized: false },
    });
  }

  /**
   * MUTAÇÃO SOBRE O CONJUNTO SELECIONADO (24/09/2026). "crie um briefing
   * detalhado de cada uma delas e lança pro Pedro" tem verbo de criação, mas
   * o objeto é a SELEÇÃO da conversa — não é task nova, é briefing+atribuição
   * em cada task listada. Sem este ramo, `classifyIntent` casava "crie" e o
   * pedido virava CREATE de task nova sem cliente (recusa "me diz qual
   * cliente") ou pior. Roda depois dos portões de permissão/produção e antes
   * da classificação fina: o alvo já está provado aqui.
   *
   * Despacho exige pessoa identificável NA FRASE (estrita ou solta — quem
   * confirma é o registro de membros). "me manda o briefing" (pra mim) não é
   * atribuição: vira briefing-only.
   */
  const pedeBriefingDaSelecao = BRIEFING_ASK.test(message);
  const verboDespacho =
    UPDATE_ASSIGNEE.test(message) ||
    UPDATE_ASSIGNEE_RESP.test(message) ||
    /\blan[cç](a|e|ar|am)?\b/i.test(message) ||
    // Despacho DECLARATIVO: "essas aí vão pro Pedro", "todas ficam com o Gui".
    /\b(vão|vai|ficam|fica)\s+(pro|pra|para|com)\b/i.test(message) ||
    /(troca|muda|altera)[a-z]*\b[^?]{0,40}\brespons/i.test(message);
  const pessoaDoDespacho = extractPersonName(message) ?? (verboDespacho ? extractPersonNameLoose(message) : null);
  // "faz o mesmo nas outras" não tem verbo de despacho nem a palavra briefing:
  // a operação vem do registro de execução, resolvida dentro do executor.
  const ehRepeticao = referenciaSelecao?.kind === 'repeat';
  /**
   * Referência SINGULAR com task recém-citada ("faz um briefing DESSA TASK"
   * logo depois de um recibo de criação): o alvo é a task do recibo, não o
   * foco da listagem antiga. Sem esta precedência, o ramo da seleção mutava
   * o item em foco ERRADO quando a conversa já tinha uma task nova criada.
   */
  const referenciaEhDoRecibo = referenciaSelecao?.kind === 'focus' && context.lastTaskId !== null;
  if (!referenciaEhDoRecibo && context.selection && referenciaSelecao && (pedeBriefingDaSelecao || ehRepeticao || (verboDespacho && pessoaDoDespacho !== null) || (verboDespacho && !pedeBriefingDaSelecao))) {
    return executeSelectionMutation({
      message,
      config,
      selection: context.selection,
      reference: referenciaSelecao,
      withBriefing: pedeBriefingDaSelecao,
      wantsAssign: verboDespacho && pessoaDoDespacho !== null ? true : verboDespacho && !pedeBriefingDaSelecao,
      personName: pessoaDoDespacho,
      userName: params.userName,
      userEmail: params.userEmail ?? null,
      conversationId,
      authorizeTask: (taskId) =>
        resolveTaskClientAuthorization(config, taskId, params.clientId ?? null, params.seniorToolContext?.organizationId ?? null),
      mayWriteForClient: (clientName) => podeEscreverEmProducao({ userEmail: params.userEmail ?? null, clientName }),
      briefingWriter: params.briefingWriter,
      logger,
    });
  }

  /**
   * A classificação fina só escolhe ENTRE as formas de escrita; o portão 1 já
   * decidiu QUE é escrita. Quando ela não reconhece a forma, o default
   * HISTÓRICO era CRIAR — e isso é exatamente o P0-01 da auditoria de
   * 22/09/2026: "altere essa task para o status 'pronto'" tem verbo
   * ("altere") fora do vocabulário de nenhum UPDATE_*, caía aqui, e nascia
   * uma task chamada "pronto" em vez de mudar o status da task real.
   *
   * REGRA GLOBAL NOVA: UNKNOWN OPERATION = NO MUTATION. O default só pode
   * ser CRIAR quando a mensagem não está se referindo a uma task JÁ
   * EXISTENTE nesta conversa (`context.lastTaskId`) — é assim que
   * "separa essa demanda"/"essa fica pra Sofia" continuam criando (não há
   * task anterior: "essa" é a DEMANDA discutida, não uma task do ClickUp) e
   * "altere essa task pra pronto" (existe `lastTaskId`, verbo não
   * reconhecido) para e pergunta, em vez de criar uma task com o texto
   * do pedido como nome.
   */
  const classified = classifyIntent(message);
  let intent: GuardIntent;
  if (ehCorrecaoDeDelete) {
    // Correção de escopo: o alvo é a MESMA task (focada ou a que quase foi
    // apagada por engano); a operação vira edição de conteúdo.
    intent = { kind: 'update_multi', fields: { replaceDescription: message } };
  } else if (classified.kind !== 'none') {
    intent = classified;
  } else {
    const fallback = decideFallbackIntent(message, context.lastTaskId);
    if (fallback.kind === 'ask_clarification') {
      logger.info(
        { intent_classification: acao.kind, write_authorized: false, write_reason: 'operação desconhecida sobre task existente', task_id: context.lastTaskId },
        '[guard] operação não reconhecida sobre referência existente; nenhuma mutação'
      );
      return guardResponse({
        ok: true,
        toolCalls: [],
        answer:
          'Entendi que é sobre uma task que já existe, mas não reconheci o que fazer com ela — não alterei nada. ' +
          'Pode reformular? Por exemplo: "muda o status pra concluído", "atribui pro Pedro", "muda o prazo pra amanhã" ou "atualiza o briefing".',
        metadata: { guard: 'bento-action', reason: 'unknown_operation_on_existing_reference', task_id: context.lastTaskId },
      });
    }
    intent = fallback.intent;
  }
  // §6: pedido que ANALISA e manda criar entrega a análise dentro da task — o
  // briefing é onde o resultado da análise vira instrução executável. Sem isso
  // a task nasce sem o contexto que acabou de ser levantado.
  if (intent.kind === 'create' && acao.requiresAnalysisFirst) intent.wantsBriefing = true;
  if (intent.kind === 'none') return null;
  const toolCalls: { tool: string; input_summary: string; ok: boolean; duration_ms: number; error?: string }[] = [];
  const startedAt = performance.now();
  const record = (tool: string, input: string, ok: boolean, error?: string) => {
    toolCalls.push({ tool, input_summary: input, ok, duration_ms: Math.round(performance.now() - startedAt), ...(error ? { error } : {}) });
  };

  // -------- UPDATE --------
  if (intent.kind !== 'create') {
    // Na correção de escopo o alvo pode ser a task que QUASE foi apagada por
    // engano (pendingDeleteTaskId) — é exatamente ela que o usuário quer dizer.
    const taskId = context.lastTaskId ?? (ehCorrecaoDeDelete ? context.pendingDeleteTaskId : null);
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

    /**
     * TODAS as formas de update passam pelo MESMO executor (25/09/2026,
     * incidente D. Carvalho): leitura prévia do estado real, idempotência por
     * campo ("já estava assim" não reescreve), um PUT com tudo que mudou,
     * read-back campo a campo, recibo hierárquico. O executor NÃO importa
     * createTask — task existente + verbo de edição nunca vira create, nem por
     * falha de classificação rio acima.
     */
    if (intent.kind === 'update_multi' || intent.kind === 'update_assignee' || intent.kind === 'update_due' || intent.kind === 'update_status' || intent.kind === 'update_brief' || intent.kind === 'update_title' || intent.kind === 'update_priority') {
      const fields: TaskUpdateFields =
        intent.kind === 'update_multi'
          ? intent.fields
          : intent.kind === 'update_due'
            ? { dueDate: intent.dueDate }
            : intent.kind === 'update_assignee'
              ? { personName: intent.personName }
              : intent.kind === 'update_status'
                ? { statusHint: intent.statusHint }
                : intent.kind === 'update_priority'
                  ? { priority: intent.priority }
                  : intent.kind === 'update_title'
                    ? { newTitle: intent.newTitle }
                    : { briefAddition: intent.addition };
      return executeTaskUpdate({
        config,
        taskId,
        knownTaskName: context.lastTaskName,
        fields,
        personFromContext: context.lastPersonName,
        briefingWriter: params.briefingWriter,
        attachments: [...(params.attachments ?? []), ...context.previousAttachments],
        solicitacaoAnterior: context.solicitacaoAnterior,
        mapStatus: mapStatusHintToRealStatus,
        logger,
      });
    }

    if (intent.kind === 'comment') {
      try {
        const criado = await createTaskComment(config, taskId, intent.text);
        record('clickup.create_comment', `+${intent.text.length}c -> ${taskId}`, true);
        const prefixo = context.lastTaskName ? `"${context.lastTaskName}" ` : '';
        const comentarios = await getTaskComments(config, taskId).catch(() => []);
        const presente = comentarios.some((c) => c.id === criado.id) || comentarios.some((c) => c.text.includes(intent.text));
        record('clickup.get_task_comments', `read-back ${taskId}`, presente, presente ? undefined : 'comentário não apareceu na releitura');
        return guardResponse({
          ok: true,
          toolCalls,
          answer: presente
            ? `Comentário adicionado e CONFIRMADO por leitura no ClickUp na task ${prefixo}(${taskId}).`
            : `Enviei o comentário na task ${prefixo}(${taskId}), mas não consegui confirmar por leitura que ele apareceu. Confere no ClickUp.`,
          metadata: { guard: 'bento-action', action: 'comment', task_id: taskId, comment_id: criado.id, verified: presente },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        record('clickup.create_comment', `-> ${taskId}`, false, detail);
        return guardResponse({ ok: false, toolCalls, answer: `Não consegui comentar no ClickUp: ${detail}`, metadata: { guard: 'bento-action', action: 'comment', task_id: taskId, errorCode: 'CLICKUP_UPDATE_FAILED' } });
      }
    }
    return null;
  }

  /**
   * CHECKPOINT ÚNICO ANTI UPDATE→CREATE (F-02, P0 — forense 26/09/2026).
   * Substitui e amplia o invariante de 25/09/2026 (incidente D. Carvalho),
   * que só enxergava VERBO_EDICAO: "adiciona o Matheus também" passava por
   * ele e nascia uma task nova (medido no harness B.4, createTask=1). Este é
   * o ÚNICO portão por onde TODO create do guard passa — inclusive o multi
   * (`createManyTasks` logo abaixo). A regra mora em
   * `assertNotUpdateMisroutedAsCreate`: com recurso existente na conversa e
   * sem sinal explícito de criação nova, sinal de mutação = PROIBIDO criar.
   */
  if (intent.kind === 'create') {
    const veredito = assertNotUpdateMisroutedAsCreate({
      message,
      lastTaskId: context.lastTaskId,
      hasSelectionFocus: context.selection !== null && referenciaSelecao !== null,
    });
    if (!veredito.allowed) {
      logger.warn(
        { intent_classification: acao.kind, task_id: context.lastTaskId, signals: veredito.signals, metric: 'bento_invariant_update_create_blocked_total' },
        '[guard] CHECKPOINT anti UPDATE→CREATE: pedido de alteração sobre recurso existente classificado como create — bloqueado',
      );
      return guardResponse({
        ok: true,
        toolCalls,
        answer:
          'Entendi que você quer ALTERAR uma task que já existe, não criar uma nova — então não criei nada. ' +
          'Me confirma qual task da lista (o número ou o nome) e o que mudar, que eu altero ela mesma.',
        metadata: { guard: 'bento-action', action: 'blocked_update_never_create', write_authorized: false, task_id: context.lastTaskId, signals: veredito.signals },
      });
    }
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
    ...(params.seniorToolContext ? { organizationId: params.seniorToolContext.organizationId } : {}),
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
  const clientName = alvo.clientName ?? params.clientName ?? null;

  /**
   * "TENHO A SOLICITAÇÃO ACIMA" — o trabalho está no turno ANTERIOR.
   *
   * Quando o pedido referencia o que veio antes, o texto da solicitação entra
   * junto no plano e no briefing. Sem isto a task nascia carregando a meta-
   * instrução ("tenho a solicitação acima...") no lugar da demanda — o
   * designer abria a task e não encontrava as quatro placas.
   */
  const referenciaAnterior =
    /\b(solicita[cç][aã]o|pedido|demanda|material|arquivo|print|imagem|texto|briefing)?\s*(acima|anterior)|\b(mandei|enviei|encaminhei|colei) (antes|acima|aqui)/i.test(params.message);
  const fonteDoPedido =
    referenciaAnterior && context.solicitacaoAnterior
      ? `${params.message}\n\n[Solicitação anterior]\n${context.solicitacaoAnterior}`
      : params.message;

  // O cliente já foi resolvido contra a carteira; passar o nome impede que ele
  // seja lido como responsável ("separa pro Gui na Clinica Teste Fase 7").
  const plano = buildOperationalActionPlan(fonteDoPedido, { excludeNames: [clientName, params.clientName] });

  // BRIEFING: obrigatório quando há material colado pra organizar. É o que
  // transforma "separa a demanda" em instrução executável dentro da task, em
  // vez de um título solto que manda a pessoa voltar no chat.
  const querBriefing = intent.wantsBriefing || plano.items.length > 0 || plano.splitRequested || resumoDoPedido(fonteDoPedido).length > 180;
  const artifact = /\bisso\b|essa|aprovad|agora gostei|agora ficou bom|cria (?:a|uma) task/i.test(message)
    ? context.lastArtifact : null;

  /**
   * O material do turno ATUAL manda; o dos turnos anteriores entra em seguida
   * e marcado como tal, porque "a solicitação acima" é literalmente o caso da
   * Tammy. Deduplicado por URL: o mesmo print reenviado não vira duas linhas.
   */
  const anexosDoPedido: TaskAttachment[] = [];
  for (const a of [...(params.attachments ?? []), ...context.previousAttachments]) {
    if (!anexosDoPedido.some((x) => x.url === a.url)) anexosDoPedido.push(a);
  }

  const entradas: CreateOneInput[] = [];
  for (const t of plano.tasks) {
    const titulo = t.item
      ? buildItemTitle({ item: t.item, clientName })
      : t.deliverable !== null
        ? buildDeliverableTitle({ deliverable: t.deliverable, items: plano.items, clientName })
        : buildOperationalTitle({
            // `fonteDoPedido`, não `params.message`: o plano e o briefing já
            // liam a solicitação anterior, mas o TÍTULO continuava lendo só a
            // meta-instrução ("tenho a solicitação acima") — e por isso saía
            // genérico e colidia na idempotência com outra demanda qualquer.
            message: fonteDoPedido,
            explicitName: intent.taskName || null,
            clientName,
          });
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
      attachments: anexosDoPedido,
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
  if (querBriefing || params.seniorToolContext) {
    const contexto = await retrieveBriefingContext({
      clientId: alvo.clientId ?? params.clientId ?? null,
      requestText: fonteDoPedido,
      taskId: null,
      config,
    }).catch(() => ({ facts: [], references: [], sourcesConsulted: [] as string[] }));
    briefingSources = contexto.sourcesConsulted;
    const prazoLabel = intent.dueDate
      ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(intent.dueDate))
      : null;

    for (const entrada of entradas) {
      const deliveryType = classifyDeliveryType(params.message, entrada.title);
      const composeInput = {
        taskName: entrada.title,
        clientName,
        deliveryType,
        facts: contexto.facts,
        references: contexto.references,
        requestedBy: params.userName,
        dueDateLabel: prazoLabel,
        assignee: entrada.planned.assigneeName,
        requestSummary: resumoDoPedido(fonteDoPedido),
      };
      let composto = composeBriefing(composeInput);

      /**
       * LACUNA REAL vs LACUNA DE FORMATO. `retrieveBriefingContext` só lê fato
       * de texto no formato "Rótulo: valor" (dossiê, comentário) — um pedido em
       * prosa como "um briefing de boas-vindas, parabenizando pelo esforço"
       * não tem essa forma, então `objetivo`/`entregaveis`/`aprovação` saíam
       * MISSING mesmo com a resposta escrita, em português corrido, dentro do
       * próprio pedido (achado real, 21/09/2026: task "Executar briefing —
       * Cliente Teste 7" saiu só com [CONFIRMAR] nos três campos, e a
       * mensagem de boas-vindas pedida nunca apareceu na task).
       *
       * Corrige SEM regenerar o briefing inteiro: pergunta ao LLM só pelos
       * campos que faltam, só a partir do PRÓPRIO PEDIDO (nunca inventando
       * dado de cliente), no mesmo formato "campo: valor" que
       * `extractLabeledFacts` já sabe ler — reusa o parser e o merge por
       * precedência que já existem, não cria caminho novo.
       *
       * SEM CONDIÇÃO DE `seniorToolContext`: esse contexto é a autorização
       * normal de qualquer execução autenticada (ver senior-runtime-context.ts
       * — não é exclusivo de um fluxo especial), então quase toda criação de
       * task passa por aqui. `params.briefingWriter` agora é seguro
       * (`completeTextSafely`, sem ferramenta nenhuma — ver execute-job.ts).
       */
      const lacunas = pendingCriticalFields(composeInput);
      if (lacunas.length > 0) {
        // Um "chave (rótulo)" por linha, pronto pra virar molde: modelos
        // menores (fallback local, ver completeTextViaOllama) seguem um
        // template explícito com muito mais consistência do que uma
        // instrução solta pedindo "uma linha por campo, formato chave:valor".
        const molde = lacunas.map((l) => `${l.key}: `).join('\n');
        const resposta = await params
          .briefingWriter(
            [
              'Leia o PEDIDO abaixo. Preencha o MOLDE copiando ou parafraseando SÓ o que o pedido determina explicitamente — nunca invente, nunca deduza além do que está escrito.',
              'Regras: responda usando EXATAMENTE as chaves do molde, uma por linha, "chave: valor". Se o pedido não determinar aquele campo, apague a linha inteira dele — não deixe "chave:" vazio, não escreva "não informado".',
              '',
              `MOLDE:\n${molde}`,
              '',
              `PEDIDO: ${fonteDoPedido}`,
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

      /**
       * DRAFT APROVADO (Otto -> task): o conteúdo já foi escrito e aprovado
       * na conversa — preservar INTEGRALMENTE, sem chamar LLM nenhum aqui.
       * Único ramo que ainda sobrescreve `composto`, e só porque não é um
       * briefing operacional: é a peça criativa em si.
       */
      if (artifact) {
        entrada.briefing = `CONTEXTO\n${clientName ?? 'Demanda da conversa'}\n\nMATERIAL DA CONVERSA — PRESERVAR INTEGRALMENTE\n${artifact}\n\nORIENTAÇÃO DE PRODUÇÃO\n${params.message}\n\nCRITÉRIO DE CONCLUSÃO\nEntregar o material solicitado, preservando o conteúdo aprovado, para revisão da solicitante.`;
      } else {
        entrada.briefing = [composto.markdown, blocoDePendencias(plano.items, plano.pendencies)].filter(Boolean).join('\n\n');
      }
      briefingEvaluation = evaluateBriefing(composto, { clientName });
      record('guard.briefing_quality', `tipo=${deliveryType} score=${briefingEvaluation.score} executável=${briefingEvaluation.executable}`, briefingEvaluation.executable);
    }
  }

  // PORTÃO DO MULTI-WRITE. Entre planejar e executar N escritas existe uma
  // decisão de risco que não é a mesma de entender a frase.
  if (entradas.length > 1 && !multiActionWriteHabilitado()) {
    const lista = entradas
      .map((e) => `- "${e.title}"${e.planned.assigneeName ? ` — ${e.planned.assigneeName}` : ' — sem responsável indicado'}`)
      .join('\n');
    logger.info(
      { intent_classification: acao.kind, action_plan_count: entradas.length, write_authorized: false, write_reason: 'multi-write desabilitado' },
      '[guard] plano multi-ação montado, execução represada por flag',
    );
    return guardResponse({
      ok: true,
      toolCalls,
      answer:
        `Entendi ${entradas.length} demandas nesse pedido${clientName ? ` pra ${clientName}` : ''}:\n${lista}\n\n` +
        'Criar várias de uma vez ainda está em validação, então não lancei nada. Me confirma que eu crio, ou me diz qual delas você quer primeiro.',
      metadata: {
        guard: 'bento-action',
        action: 'multi_action_plan_only',
        intent_classification: acao.kind,
        write_authorized: false,
        write_reason: 'BENTO_MULTI_ACTION_WRITE desligado',
        action_plan_count: entradas.length,
        attachments_in_request: anexosDoPedido.length,
        tasks: entradas.map((e) => ({
          title: e.title,
          deliverable: e.planned.deliverable,
          item: e.planned.item ?? null,
          assignee_requested: e.planned.assigneeName,
          status: 'planned',
        })),
      },
    });
  }

  const resultados = await createManyTasks(
    config,
    listId,
    { name: params.userName, clickUpEmail: params.userClickUpEmail },
    entradas,
    undefined,
    params.seniorToolContext ?? undefined,
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
      attachments_in_request: anexosDoPedido.length,
      attachments_referenced: criadas.reduce((n, r) => n + r.attachments.filter((a) => a.referenced).length, 0),
      attachments_uploaded: criadas.reduce((n, r) => n + r.attachments.filter((a) => a.uploaded).length, 0),
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
      attachments_in_request: anexosDoPedido.length,
      tasks: resultados.map((r) => ({
        task_id: r.taskId,
        title: r.title,
        idempotency_key: r.idempotencyKey,
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
        attachments: r.attachments.map((a) => ({ filename: a.filename, referenced: a.referenced, uploaded: a.uploaded, error: a.error })),
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
 * A FRASE SOBRE O MATERIAL sai do estado VERIFICADO, nunca da tentativa.
 *
 * "anexei o arquivo" e "incluí a referência ao arquivo" descrevem coisas
 * diferentes: na primeira a pessoa abre a task e o arquivo está lá; na segunda
 * ela abre e encontra um link. Confundir as duas faz alguém procurar no lugar
 * errado e concluir que o Bento mentiu — que é o que teria acontecido se a
 * frase saísse do fato de termos TENTADO o upload.
 */
function fraseDoMaterial(r: CreateOutcome): string | null {
  if (r.attachments.length === 0) return null;
  const anexados = r.attachments.filter((a) => a.uploaded);
  const referenciados = r.attachments.filter((a) => !a.uploaded && a.referenced);
  const perdidos = r.attachments.filter((a) => !a.uploaded && !a.referenced);
  const partes: string[] = [];
  if (anexados.length > 0) {
    partes.push(`anexei ${anexados.length === 1 ? 'o arquivo' : `${anexados.length} arquivos`} (${anexados.map((a) => a.filename).join(', ')})`);
  }
  if (referenciados.length > 0) {
    partes.push(
      `incluí ${referenciados.length === 1 ? 'a referência ao arquivo' : `as referências aos ${referenciados.length} arquivos`} na task (${referenciados.map((a) => a.filename).join(', ')})`,
    );
  }
  if (perdidos.length > 0) {
    partes.push(`NÃO consegui levar ${perdidos.map((a) => a.filename).join(', ')} — confere no chat e me manda de novo`);
  }
  return partes.length > 0 ? `Material: ${partes.join('; ')}.` : null;
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
      const material = fraseDoMaterial(r);
      if (material) linhas.push(`  ${material}`);
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
