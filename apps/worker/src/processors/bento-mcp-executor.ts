import type { Logger } from '@desigual-os/logging';
import {
  buildClickUpMcpTool,
  callResponses,
  pickModel,
  type BudgetTier,
} from '@desigual-os/openai-provider';
import {
  findDuplicateTask,
  getClickUpMcpAccessToken,
  getTask,
  getTaskComments,
  queryOperationTasks,
  resolveMemberByName,
  verifyTaskState,
  type ClickUpConfig,
  type ExpectedTaskState,
  type TaskDetail,
} from '@desigual-os/tool-gateway';
import type { StructuredAction, WriteEnvelope, WriteProvider } from '@desigual-os/bento-core';

/**
 * bento-mcp-executor.ts — "BENTO FINAL RELEASE GATE" §1/§2/§3/§5:
 * seleção real de provider (MCP primary, legacy só quando MCP não suporta
 * ou não está autorizado) e execução via a tool MCP nativa da Responses
 * API já wired em `packages/openai-provider/src/clickup-mcp-tool.ts`.
 *
 * NENHUM nome de tool do ClickUp é hardcoded aqui (§17/§14 da missão
 * original): a instrução descreve a OPERAÇÃO em português, a OpenAI
 * descobre e escolhe a tool MCP real em runtime. `allowed_tools` fica
 * deliberadamente ausente — restringi-lo exigiria saber os nomes reais das
 * tools do servidor MCP, o que só é possível com uma conexão autorizada
 * fazendo uma chamada real (proibido nesta missão).
 *
 * Correções da auditoria forense 26/09/2026 (F-03/F-08, seção 6):
 *  - D.3/F-03: create via MCP tem RECONCILE-FIRST read-only (REST legado,
 *    mesma regra do senior-operation.ts P1-01) antes de instruir o create —
 *    retry/timeout/double-send de UMA operação lógica = UMA task.
 *  - D.5/F-08: o task_id não depende mais só de parse best-effort — camadas:
 *    (1) output estruturado mínimo exigido na instrução, (2) extração
 *    determinística de id (JSON da tool, TASK_ID:, URL ClickUp), (3)
 *    fallback reconcile por título exato criado há < N min, (4) PARTIAL/
 *    UNKNOWN honesto (nunca success pleno, nunca foco falso, NUNCA retryable
 *    — re-executar um create não identificado é o que gerava a duplicata).
 *  - D.6/F-08: read-back REAL (campos conferidos via verifyTaskState, não só
 *    existência). Divergência → verified=false + resposta honesta; read-back
 *    indisponível → degradação explícita no envelope (readback.unavailable).
 */

/** §2: capacidades que este release já cobre — create/update/comment. Delete fica de fora (audit P0-19). */
const MCP_SUPPORTED_INTENTS = new Set<StructuredAction['intent']>(['create_task', 'update_task', 'comment_task']);

/** D.5 camada 3: janela em que uma task com título idêntico é atribuída a ESTA operação. */
const RECONCILE_RECENT_WINDOW_MS = 10 * 60 * 1000;

export type ProviderSelection =
  | { provider: 'MCP'; mcpToken: string }
  | { provider: 'LEGACY_GATEWAY' }
  | { provider: 'UNSUPPORTED'; reason: string };

/**
 * §2 da missão: MCP é PRIMARY quando (a) a operação é uma capacidade que o
 * MCP cobre e (b) o usuário já autorizou o OAuth do MCP (token presente).
 * Sem as duas condições, cai pro legacy gateway — nunca os dois pra uma
 * mesma mutação (garantido pelo caller: esta função devolve EXATAMENTE uma
 * opção, nunca ambas).
 */
export async function selectWriteProvider(intent: StructuredAction['intent'], userId: string): Promise<ProviderSelection> {
  if (!MCP_SUPPORTED_INTENTS.has(intent)) {
    return { provider: 'UNSUPPORTED', reason: `${intent} não tem executor verificado (nem MCP nem gateway legado) nesta versão` };
  }
  const mcpToken = await getClickUpMcpAccessToken(userId).catch(() => null);
  if (mcpToken) return { provider: 'MCP', mcpToken };
  return { provider: 'LEGACY_GATEWAY' };
}

/** D.6: relatório do read-back real — o que foi conferido e o que divergiu. */
export interface McpReadbackReport {
  checked: string[];
  mismatches: string[];
  /** true quando NÃO foi possível reler (config ausente ou leitura falhou) — degradação explícita, nunca silenciosa. */
  unavailable: boolean;
}

/** Envelope do caminho MCP: WriteEnvelope + detalhes que o core usa pra resposta honesta e pro ExecutionRecord. */
export interface McpWriteEnvelope extends WriteEnvelope {
  readback?: McpReadbackReport;
  /** true quando o reconcile-first achou a task já existente e NENHUM create novo foi instruído ao MCP. */
  wasExisting?: boolean;
}

function describeOperation(action: StructuredAction, resolvedResourceId: string | null, listId: string | null, operationId: string): string {
  const marker = `Chave interna da operação (idempotência): ${operationId} — NÃO inclua este identificador no título, na descrição ou no comentário da task.`;
  if (action.intent === 'create_task') {
    // QA 28/09/2026: responsável e prazo do pedido não chegavam a esta
    // instrução — a task nascia só com título mesmo quando o planner tinha
    // extraído os dois campos em `action.changes` (mesmo bug do lado
    // LEGACY_GATEWAY, corrigido em bento-openai-core.ts). Paridade entre os
    // dois providers: a mesma StructuredAction não pode produzir um
    // resultado mais pobre dependendo de qual provider a seleciona.
    return [
      `Crie EXATAMENTE UMA task no ClickUp, na lista de id "${listId}".`,
      `Título: ${action.changes?.title ?? '(gerar um título curto e específico a partir do pedido)'}`,
      action.changes?.description ? `Descrição: ${action.changes.description}` : '',
      action.changes?.dueDate ? `Prazo: ${action.changes.dueDate}` : '',
      action.changes?.assignee ? `Responsável: ${action.changes.assignee}` : '',
      marker,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (action.intent === 'update_task') {
    const parts = [`Atualize a task de id "${resolvedResourceId}" no ClickUp — NÃO crie uma task nova.`];
    if (action.changes?.title) parts.push(`Novo título: ${action.changes.title}`);
    if (action.changes?.description) parts.push(`Nova descrição: ${action.changes.description}`);
    if (action.changes?.dueDate) parts.push(`Novo prazo: ${action.changes.dueDate}`);
    if (action.changes?.assignee) {
      const op = action.changes.assigneeOperation ?? 'add';
      if (op === 'remove') parts.push(`Remova o responsável "${action.changes.assignee}" da task — não adicione ninguém.`);
      else if (op === 'replace') parts.push(`Deixe APENAS "${action.changes.assignee}" como responsável — remova os demais responsáveis atuais.`);
      else parts.push(`Novo responsável: ${action.changes.assignee} (adicione aos responsáveis atuais).`);
    }
    parts.push(marker);
    return parts.join('\n');
  }
  // comment_task
  return `Adicione um comentário na task de id "${resolvedResourceId}" no ClickUp — NÃO crie nem atualize campos da task, só o comentário.\nTexto do comentário: ${action.changes?.comment ?? action.changes?.description ?? ''}\n${marker}`;
}

const MCP_EXEC_INSTRUCTIONS = `Você é o executor do Bento. Sua ÚNICA saída deve ser a chamada da ferramenta MCP do ClickUp que realiza EXATAMENTE a operação descrita — nada além dela. Não peça confirmação (já foi validada por uma camada de política antes desta chamada). Não crie recursos além do pedido. Depois de chamar a ferramenta, responda OBRIGATORIAMENTE neste formato exato (duas linhas, sem mais nada):
TASK_ID: <id da task criada ou alterada>
TASK_URL: <URL completa da task>
Se a ferramenta não devolveu o id, escreva "TASK_ID: desconhecido" — nunca invente um id.`;

export interface ExecuteViaMcpParams {
  action: StructuredAction;
  resolvedResourceId: string | null;
  listId: string | null;
  mcpToken: string;
  budgetTier?: BudgetTier;
  /** Config do gateway legado — usado SÓ PRA LEITURA (reconcile-first e read-back, §5: "sem duplicar mutation"), nunca pra escrever. */
  legacyReadConfig: ClickUpConfig | null;
  /**
   * D.3/F-03: chave estável da operação lógica (conversationId + intent +
   * hash normalizado de título/lista), calculada pelo core. Retry do MESMO
   * pedido regenera a MESMA chave — vai na instrução e no trace.
   */
  operationId: string;
  /** Sinal da policy (C.2/F-05): título idêntico a um create recente da conversa — reconcile-first obrigatório e logado. */
  possibleDuplicate?: boolean;
  logger: Logger;
}

function fail(operation: string, error: string, retryable: boolean, provider: WriteProvider | null = 'MCP'): McpWriteEnvelope {
  return { success: false, verified: false, provider, resourceIds: [], operation, changes: {}, error, retryable, sources: [] };
}

/* ------------------------------------------------------------------ */
/* D.3 — reconcile-first (create idempotente)                          */
/* ------------------------------------------------------------------ */

type ReconcileResult = { status: 'found'; id: string } | { status: 'none' } | { status: 'unknown'; error: string };

/**
 * Busca read-only (REST legado, nunca escreve) de task com o MESMO título
 * normalizado na lista alvo. Mesma regra do P1-01 (senior-operation.ts):
 * se a CHECAGEM falhar, devolve 'unknown' — o caller NÃO cria no escuro.
 */
async function reconcileByTitle(config: ClickUpConfig, listId: string, title: string): Promise<ReconcileResult> {
  try {
    const page = await queryOperationTasks(config, { listIds: [listId], includeClosed: false });
    const existing = findDuplicateTask(page.tasks, title);
    return existing ? { status: 'found', id: existing.id } : { status: 'none' };
  } catch (error) {
    return { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ */
/* D.5 — task_id robusto, em camadas                                   */
/* ------------------------------------------------------------------ */

/** URL canônica do ClickUp: https://app.clickup.com/t/<id>. */
const CLICKUP_URL_ID_RE = /clickup\.com\/t\/([\w-]+)/i;

/**
 * Camada 2 — extração determinística de id: JSON estruturado do output da
 * tool, URLs ClickUp no output da tool, o formato TASK_ID: exigido na
 * instrução (camada 1) e URLs no texto final do modelo.
 */
function extractResourceId(mcpCalls: Array<{ output: string | null }>, outputText: string): string | null {
  for (const call of mcpCalls) {
    if (!call.output) continue;
    try {
      const parsed = JSON.parse(call.output) as { id?: unknown; task_id?: unknown; task?: { id?: unknown } };
      const id = parsed.id ?? parsed.task_id ?? parsed.task?.id;
      if (typeof id === 'string' && id) return id;
    } catch {
      // output não é JSON — comum em texto livre de confirmação; tenta URL abaixo.
    }
    const fromOutput = CLICKUP_URL_ID_RE.exec(call.output);
    if (fromOutput?.[1]) return fromOutput[1];
  }
  const tagged = /TASK_ID:\s*([\w-]+)/.exec(outputText);
  if (tagged?.[1] && tagged[1] !== 'desconhecido') return tagged[1];
  const fromUrl = CLICKUP_URL_ID_RE.exec(outputText);
  if (fromUrl?.[1]) return fromUrl[1];
  return null;
}

/**
 * Camada 3 — fallback reconcile: lista as tasks da lista alvo e casa por
 * título EXATO normalizado criado há < RECONCILE_RECENT_WINDOW_MS. Só roda
 * pra create sem id extraível; falha da consulta vira null logado (nunca
 * inventa id).
 */
async function fallbackReconcileRecentTask(config: ClickUpConfig, listId: string, title: string, logger: Logger): Promise<string | null> {
  try {
    const page = await queryOperationTasks(config, { listIds: [listId], includeClosed: false });
    const existing = findDuplicateTask(page.tasks, title);
    if (!existing) return null;
    if (existing.createdAt !== null && Date.now() - existing.createdAt > RECONCILE_RECENT_WINDOW_MS) {
      // Título idêntico mas criado há muito tempo — não é desta operação;
      // atribuir seria foco falso (pior que PARTIAL honesto).
      return null;
    }
    return existing.id;
  } catch (error) {
    logger.warn({ error, listId }, '[bento-mcp-executor] fallback reconcile de task_id falhou — id fica desconhecido');
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* D.6 — read-back real (campos, não só existência)                    */
/* ------------------------------------------------------------------ */

/**
 * "2026-09-28" → meio-dia LOCAL (evita o furo de fuso do Date.parse em dia
 * puro, que vira o dia anterior em GMT-3). Exportado: o mesmo parser serve
 * o create/update LEGACY_GATEWAY em bento-openai-core.ts — um único ponto
 * de conversão de data em vez de duplicar a lógica por provider.
 */
export function parseDueDateMs(raw: string): number | null {
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (isoDay) return new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]), 12).getTime();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readbackCreate(config: ClickUpConfig, task: TaskDetail, action: StructuredAction, listId: string | null): Promise<McpReadbackReport> {
  const expected: ExpectedTaskState = {};
  if (action.changes?.title) expected.name = action.changes.title;
  if (action.changes?.dueDate) {
    const ms = parseDueDateMs(action.changes.dueDate);
    if (ms !== null) {
      expected.dueDate = ms;
      expected.dueDateGranularity = 'day';
    }
  }
  const verification = verifyTaskState(task, expected);
  const mismatches = [...verification.mismatches];
  const checked = [...verification.checked];
  if (listId) {
    checked.push('lista');
    if (task.listId && task.listId !== listId) mismatches.push(`a task caiu na lista ${task.listId}, mas o destino pedido era ${listId}`);
  }
  // QA 28/09/2026: paridade com readbackUpdate — um create com responsável
  // pedido precisa confirmar que ele foi de fato atribuído, não só que a
  // task existe com o título certo.
  if (action.changes?.assignee) {
    checked.push('responsável');
    const resolution = await resolveMemberByName(config, action.changes.assignee).catch(() => null);
    if (resolution?.status === 'resolved') {
      const present = task.assignees.some((a) => a.id === resolution.member.id);
      if (!present) mismatches.push(`"${action.changes.assignee}" não consta como responsável após a criação`);
    } else {
      mismatches.push(`não consegui confirmar o responsável "${action.changes.assignee}" na releitura (nome não resolveu entre os membros)`);
    }
  }
  return { checked, mismatches, unavailable: false };
}

async function readbackUpdate(config: ClickUpConfig, task: TaskDetail, action: StructuredAction): Promise<McpReadbackReport> {
  const expected: ExpectedTaskState = {};
  if (action.changes?.title) expected.name = action.changes.title;
  if (action.changes?.dueDate) {
    const ms = parseDueDateMs(action.changes.dueDate);
    if (ms !== null) {
      expected.dueDate = ms;
      expected.dueDateGranularity = 'day';
    }
  }
  if (action.changes?.description) expected.descriptionContains = [action.changes.description.slice(0, 120)];
  const verification = verifyTaskState(task, expected);
  const mismatches = [...verification.mismatches];
  const checked = [...verification.checked];
  if (action.changes?.assignee) {
    checked.push('responsável');
    const resolution = await resolveMemberByName(config, action.changes.assignee).catch(() => null);
    if (resolution?.status === 'resolved') {
      const present = task.assignees.some((a) => a.id === resolution.member.id);
      const op = action.changes.assigneeOperation ?? 'add';
      if (op === 'remove' && present) mismatches.push(`"${action.changes.assignee}" deveria ter sido removido(a) e continua responsável pela task`);
      if (op !== 'remove' && !present) mismatches.push(`"${action.changes.assignee}" não consta como responsável após a escrita`);
    } else {
      mismatches.push(`não consegui confirmar o responsável "${action.changes.assignee}" na releitura (nome não resolveu entre os membros)`);
    }
  }
  return { checked, mismatches, unavailable: false };
}

async function readbackComment(config: ClickUpConfig, resourceId: string, action: StructuredAction): Promise<McpReadbackReport> {
  const text = action.changes?.comment ?? action.changes?.description ?? '';
  const trecho = text.slice(0, 120);
  const comments = await getTaskComments(config, resourceId);
  const found = trecho ? comments.some((c) => c.text.includes(trecho)) : comments.length > 0;
  return {
    checked: ['comentário'],
    mismatches: found ? [] : ['o comentário não apareceu na releitura da task'],
    unavailable: false,
  };
}

/**
 * Executa a operação via a tool MCP nativa (server-side, dentro da própria
 * chamada Responses — `require_approval: 'never'`). O gateway legado entra
 * SÓ PRA LEITURA, duas vezes: reconcile-first ANTES do create (D.3) e
 * read-back real DEPOIS de qualquer escrita (D.6) — nunca pra escrever.
 */
export async function executeViaMcp(params: ExecuteViaMcpParams): Promise<McpWriteEnvelope> {
  const provider: WriteProvider = 'MCP';
  const { action } = params;
  const decision = pickModel('clickup_write', params.budgetTier ?? 'normal');
  const operationDescription = describeOperation(action, params.resolvedResourceId, params.listId, params.operationId);
  const createTitle = action.intent === 'create_task' ? action.changes?.title?.trim() || null : null;

  // D.3/F-03 — RECONCILE-FIRST: antes de instruir qualquer create ao MCP,
  // prova que a task não existe (retry de timeout, double send, redelivery
  // da fila — UMA operação lógica = UMA task). Sem conseguir provar, erro
  // retryable: criar no escuro é exatamente o F-03.
  if (action.intent === 'create_task' && createTitle && params.listId) {
    if (params.possibleDuplicate) {
      params.logger.info({ operationId: params.operationId }, '[bento-mcp-executor] policy sinalizou possível duplicata — reconcile-first antes de criar');
    }
    if (params.legacyReadConfig) {
      const reconcile = await reconcileByTitle(params.legacyReadConfig, params.listId, createTitle);
      if (reconcile.status === 'unknown') {
        return fail(action.intent, `não consegui checar duplicata antes de criar (${reconcile.error}) — não vou arriscar uma task duplicada`, true);
      }
      if (reconcile.status === 'found') {
        let readback: McpReadbackReport = { checked: [], mismatches: [], unavailable: true };
        let verified = false;
        try {
          const task = await getTask(params.legacyReadConfig, reconcile.id);
          readback = await readbackCreate(params.legacyReadConfig, task, action, params.listId);
          verified = readback.mismatches.length === 0;
        } catch (error) {
          params.logger.warn({ error, resourceId: reconcile.id }, '[bento-mcp-executor] read-back da task reconciliada falhou');
        }
        params.logger.info({ operationId: params.operationId, resourceId: reconcile.id }, '[bento-mcp-executor] reconcile-first: task já existia — nenhum create instruído');
        return {
          success: true,
          verified,
          provider,
          resourceIds: [reconcile.id],
          operation: action.intent,
          changes: action.changes ?? {},
          error: null,
          retryable: false,
          sources: [`CLICKUP_TASK:${reconcile.id}`],
          readback,
          wasExisting: true,
        };
      }
    } else {
      // Degradação explícita: sem REST legado não há como reconciliar —
      // segue pro create, mas o risco F-03 fica LOGADO, não silencioso.
      params.logger.warn({ operationId: params.operationId }, '[bento-mcp-executor] sem config REST legado: create MCP SEM reconcile-first (degradado)');
    }
  }

  let result;
  try {
    result = await callResponses(
      {
        model: decision.model,
        instructions: MCP_EXEC_INSTRUCTIONS,
        input: operationDescription,
        maxOutputTokens: 400,
        tools: [buildClickUpMcpTool(params.mcpToken)],
      },
      params.logger as never,
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'falha desconhecida na chamada MCP';
    return fail(action.intent, messageText, true);
  }

  if (result.mcpCalls.length === 0) {
    return fail(action.intent, 'O modelo não chamou nenhuma tool MCP — nenhuma mutação real aconteceu', true);
  }

  const failed = result.mcpCalls.find((c) => c.error);
  if (failed) {
    return fail(action.intent, `MCP (${failed.serverLabel}/${failed.name}): ${failed.error}`, true);
  }

  // D.5 — task_id em camadas: (1) o output estruturado foi EXIGIDO na
  // instrução; (2) extração determinística; (3) fallback reconcile por
  // título exato recente; (4) PARTIAL/UNKNOWN honesto.
  let resourceId = params.resolvedResourceId ?? extractResourceId(result.mcpCalls, result.outputText);
  if (!resourceId && action.intent === 'create_task' && createTitle && params.listId && params.legacyReadConfig) {
    resourceId = await fallbackReconcileRecentTask(params.legacyReadConfig, params.listId, createTitle, params.logger);
    if (resourceId) {
      params.logger.info({ operationId: params.operationId, resourceId }, '[bento-mcp-executor] task_id recuperado via fallback reconcile (título exato recente)');
    }
  }

  if (!resourceId && action.intent === 'create_task') {
    // Camada 4 — a mutação provavelmente aconteceu mas o recurso é
    // inidentificável: NUNCA success pleno, NUNCA foco falso e NUNCA
    // retryable (re-executar um create não identificado é o F-03 de novo;
    // num retry manual o reconcile-first acha a task).
    params.logger.warn({ operationId: params.operationId }, '[bento-mcp-executor] create executado sem task_id identificável — PARTIAL/UNKNOWN');
    return fail(
      action.intent,
      'write_unconfirmed_resource: a criação foi enviada ao ClickUp, mas não consegui identificar a task criada (sem id no retorno e sem casamento por título) — verificar a lista antes de repetir o pedido',
      false,
    );
  }

  // D.6 — read-back REAL: confere os campos relevantes, não só a existência.
  let verified = false;
  let readback: McpReadbackReport = { checked: [], mismatches: [], unavailable: true };
  if (resourceId && params.legacyReadConfig) {
    try {
      if (action.intent === 'comment_task') {
        readback = await readbackComment(params.legacyReadConfig, resourceId, action);
      } else {
        const task = await getTask(params.legacyReadConfig, resourceId);
        readback = action.intent === 'create_task'
          ? await readbackCreate(params.legacyReadConfig, task, action, params.listId)
          : await readbackUpdate(params.legacyReadConfig, task, action);
      }
      verified = readback.mismatches.length === 0;
      if (!verified) {
        params.logger.warn({ operationId: params.operationId, resourceId, mismatches: readback.mismatches }, '[bento-mcp-executor] read-back encontrou divergências');
      }
    } catch (error) {
      params.logger.warn({ error, resourceId }, '[bento-mcp-executor] read-back de verificação (leitura, sem escrita) falhou');
    }
  } else if (resourceId) {
    params.logger.warn({ operationId: params.operationId, resourceId }, '[bento-mcp-executor] sem config REST legado: read-back indisponível (degradado)');
  }

  return {
    success: true,
    verified,
    provider,
    resourceIds: resourceId ? [resourceId] : [],
    operation: action.intent,
    changes: action.changes ?? {},
    error: null,
    retryable: false,
    sources: resourceId ? [`CLICKUP_TASK:${resourceId}`] : [],
    readback,
  };
}
