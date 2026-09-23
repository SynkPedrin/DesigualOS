import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { hasPermission } from '@desigual-os/auth';
import { detectJarbasHandoffRequest, detectJarbasResultQuery, detectJarbasStatusQuery, type AgentTaskStore } from '@desigual-os/agent-runtime';
import type { AgentTask, AgentTaskStatus } from '@desigual-os/types';
import type { SeniorToolContext } from '@desigual-os/tool-gateway';
import { PostgresAgentTaskStore } from './agent-task-postgres-store';
import { formatExecutiveAnswer, runJarbasV2Task } from './jarbas-v2-orchestrator';

/**
 * jarbas-handoff.ts — integração NARROW Bento -> Jarbas V2. Único ponto de
 * contato entre bento-action-guard.ts e todo o resto do mecanismo Jarbas —
 * nada mais em bento-action-guard.ts muda.
 *
 * Missão de fechamento de operabilidade em chat (23/09/2026) fecha os TRÊS
 * furos que impediam o uso normal via chat (em vez de só canário/script):
 * (1) resolveMetaAccountId agora lê client_meta_accounts de verdade —
 * nunca inventa, nunca faz fallback pra outro cliente;
 * (2) toda tarefa carrega conversationId, então "o Jarbas terminou?"/"o
 * que ele encontrou?" leem a ÚLTIMA tarefa desta conversa pra este cliente
 * sem precisar do taskId em mãos;
 * (3) troca de cliente na mesma conversa nunca reaproveita tarefa do
 * cliente anterior — a busca usa organizationId + clientId + conversationId
 * juntos, nunca só conversationId.
 */

/**
 * Produção usa SEMPRE PostgresAgentTaskStore — se o Postgres estiver fora,
 * a chamada real dentro de `store.dispatch`/`runJarbasV2Task` lança, e esse
 * erro SOBE (nenhum catch aqui engole pra "sucesso silencioso" nem troca
 * por um store em memória). Testes usam InMemoryAgentTaskStore diretamente
 * (ver jarbas-v2-orchestrator.test.ts) — nunca este arquivo, que é só o
 * caminho real.
 */
let sharedStore: AgentTaskStore | null = null;
function getStore(): AgentTaskStore {
  if (!sharedStore) sharedStore = new PostgresAgentTaskStore();
  return sharedStore;
}

type ResolveAccountResult =
  | { status: 'ok'; accountId: string }
  | { status: 'no_mapping' }
  | { status: 'ambiguous' };

/**
 * `agent_tasks.requested_by` é uma FK real pra `users.id` (uuid) — o Bento
 * só carrega e-mail ao longo de todo o guard (bento-action-guard.ts nunca
 * tem userId em mãos), então esse é o único ponto que precisa da tradução.
 * E-mail sem usuário correspondente -> null (a coluna é nullable): nunca
 * inventa um id, nunca quebra o dispatch por causa disso.
 */
async function resolveUserIdByEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  return row?.id ?? null;
}

/**
 * clientId (Desigual OS) -> Meta Ads accountId, lido de client_meta_accounts
 * (packages/database/src/schema/client-meta-accounts.ts). Fonte autoritativa
 * do mapa COMPLETO continua sendo clientData.js do lado do agentes-desigual
 * (fora deste repositório) — esta tabela é só o registro mínimo, explícito
 * e deliberado necessário aqui. Nunca adivinha, nunca cai pra conta de
 * outro cliente: 0 contas -> no_mapping; 1 conta -> essa; 2+ contas com
 * exatamente 1 marcada isPrimary -> essa; 2+ contas sem primary único ->
 * ambiguous (BLOCKED_NEEDS_DATA, nunca escolhido por ordem arbitrária).
 */
async function resolveMetaAccountId(clientId: string): Promise<ResolveAccountResult> {
  const rows = await db.select().from(schema.clientMetaAccounts).where(eq(schema.clientMetaAccounts.clientId, clientId));
  if (rows.length === 0) return { status: 'no_mapping' };
  const unica = rows.length === 1 ? rows[0] : undefined;
  if (unica) return { status: 'ok', accountId: unica.accountId };
  const primarios = rows.filter((r) => r.isPrimary);
  const primariaUnica = primarios.length === 1 ? primarios[0] : undefined;
  if (primariaUnica) return { status: 'ok', accountId: primariaUnica.accountId };
  return { status: 'ambiguous' };
}

export interface JarbasHandoffParams {
  message: string;
  conversationId: string | null;
  userEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  seniorToolContext: SeniorToolContext | null;
}

export interface JarbasHandoffResult {
  answer: string;
  metadata: Record<string, unknown>;
}

function canAssignJarbasTask(seniorToolContext: SeniorToolContext | null): boolean {
  if (!seniorToolContext) return false;
  return hasPermission(seniorToolContext.permissions as never, 'jarbas', 'assign') || hasPermission(seniorToolContext.permissions as never, '*', '*');
}

/**
 * §7: texto por GRUPO de status — nunca rerroda o Jarbas, só lê o que já
 * está persistido. BLOCKED_* explica o bloqueio de verdade (usa
 * task.retry.lastError quando existe), nunca uma frase genérica que
 * esconde o motivo.
 */
function describeStatus(task: AgentTask): string {
  const status: AgentTaskStatus = task.status;
  if (status === 'assigned' || status === 'acknowledged') {
    return 'Jarbas recebeu o pedido e ainda vai começar a analisar.';
  }
  if (status === 'context_resolved' || status === 'data_required' || status === 'analyzing' || status === 'verifying' || status === 'completed_analysis') {
    return 'Jarbas ainda está analisando — sem resultado pronto ainda.';
  }
  if (status === 'ready_for_review') {
    return 'A análise pronta já está aqui — pergunta o que ele encontrou que eu te mostro.';
  }
  if (status === 'cancelled') {
    return 'Essa análise foi cancelada.';
  }
  // blocked_*
  const motivo = task.retry.lastError ? ` Motivo: ${task.retry.lastError}.` : '';
  if (status === 'blocked_needs_data') return `A análise ficou bloqueada porque faltam dados pra continuar.${motivo}`;
  if (status === 'blocked_ambiguous') return `A análise ficou bloqueada porque ficou ambíguo o que analisar (mais de uma conta de Meta Ads pro cliente, sem uma marcada como principal).${motivo}`;
  if (status === 'blocked_permission') return `A análise ficou bloqueada por falta de permissão.${motivo}`;
  return `A análise ficou bloqueada porque o serviço do Jarbas ficou indisponível.${motivo}`;
}

/** null = não é handoff nem status/resultado query — quem chama segue pro resto do guard normalmente. */
export async function tryJarbasHandoff(params: JarbasHandoffParams): Promise<JarbasHandoffResult | null> {
  const isStatusQuery = detectJarbasStatusQuery(params.message);
  const isResultQuery = detectJarbasResultQuery(params.message);

  if (isStatusQuery || isResultQuery) {
    if (!params.clientId || !params.seniorToolContext || !params.conversationId) {
      return {
        answer: 'Preciso saber de qual cliente e de qual conversa você está falando antes de checar o Jarbas.',
        metadata: { guard: 'jarbas-handoff', action: 'blocked_ambiguous_client' },
      };
    }
    const store = getStore();
    const task = await store.getLatestTaskForClientConversation(params.seniorToolContext.organizationId, params.clientId, params.conversationId);
    if (!task) {
      return {
        answer: 'Não achei nenhuma tarefa do Jarbas nesta conversa pra esse cliente ainda.',
        metadata: { guard: 'jarbas-handoff', action: 'no_task_for_conversation' },
      };
    }

    if (isResultQuery && task.status === 'ready_for_review') {
      const result = await store.getResult(task.taskId);
      if (!result) {
        return {
          answer: 'A tarefa está marcada como pronta, mas não achei o resultado gravado — isso não deveria acontecer, melhor eu não inventar nada aqui.',
          metadata: { guard: 'jarbas-handoff', action: 'result_missing_inconsistent', task_id: task.taskId },
        };
      }
      const metricVerified = result.analysisConfidence !== 'insufficient_data';
      return {
        answer: formatExecutiveAnswer(task, result, metricVerified),
        metadata: { guard: 'jarbas-handoff', action: 'result_query_answered', task_id: task.taskId },
      };
    }

    // Pergunta de status, ou pergunta de resultado numa tarefa ainda não
    // pronta — mesma resposta honesta sobre o status, nunca inventa resultado.
    return {
      answer: describeStatus(task),
      metadata: { guard: 'jarbas-handoff', action: 'status_query_answered', task_id: task.taskId, status: task.status },
    };
  }

  const handoff = detectJarbasHandoffRequest(params.message);
  if (!handoff) return null;

  if (!canAssignJarbasTask(params.seniorToolContext)) {
    return {
      answer: 'Você não tem permissão pra atribuir análise ao Jarbas ainda — fala com um master pra liberar.',
      metadata: { guard: 'jarbas-handoff', action: 'denied_permission' },
    };
  }

  if (!params.clientId || !params.seniorToolContext) {
    return {
      answer: 'Preciso saber de qual cliente você está falando antes de mandar pro Jarbas.',
      metadata: { guard: 'jarbas-handoff', action: 'blocked_ambiguous_client' },
    };
  }

  const resolved = await resolveMetaAccountId(params.clientId);
  if (resolved.status === 'no_mapping') {
    return {
      answer: 'Esse cliente ainda não tem uma conta Meta vinculada ao Jarbas.',
      metadata: { guard: 'jarbas-handoff', action: 'blocked_no_account_mapping' },
    };
  }

  const store = getStore();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Chave de idempotência normalizada (espaço/maiúscula não vira tarefa
  // nova) — duplicata/quase-duplicata do mesmo pedido na mesma conversa é
  // UMA tarefa lógica só (§11), nunca duas análises rodando à toa.
  const objetivoNormalizado = params.message.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  const dispatchKey = `msg:${params.conversationId ?? 'no-conversation'}:${params.clientId}:${objetivoNormalizado}`;
  const requestedByUserId = await resolveUserIdByEmail(params.userEmail);

  if (resolved.status === 'ambiguous') {
    // Conta ambígua (múltiplas contas, nenhuma marcada como principal) — a
    // tarefa É criada e registrada como BLOCKED_NEEDS_DATA (§3), nunca uma
    // conta escolhida por adivinhação. Nunca chama o Jarbas V2.
    const { task } = await store.dispatch({
      dispatchKey,
      organizationId: params.seniorToolContext.organizationId,
      clientId: params.clientId,
      conversationId: params.conversationId,
      requestedBy: requestedByUserId,
      objective: handoff.objective,
      scope: `${params.clientName ?? params.clientId}, últimos 30 dias`,
      entityRefs: [],
      timeWindow: { start: since.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
      originalUserRequest: params.message,
    });
    if (task.status !== 'blocked_needs_data') {
      await store.transition(task.taskId, 'acknowledged', params.seniorToolContext.organizationId);
      await store.transition(task.taskId, 'context_resolved', params.seniorToolContext.organizationId);
      await store.transition(task.taskId, 'blocked_needs_data', params.seniorToolContext.organizationId);
    }
    return {
      answer: `${params.clientName ?? 'Esse cliente'} tem mais de uma conta de Meta Ads vinculada e nenhuma marcada como principal — preciso que alguém defina qual conta usar antes do Jarbas conseguir puxar dado real.`,
      metadata: { guard: 'jarbas-handoff', action: 'blocked_ambiguous_account', task_id: task.taskId },
    };
  }

  const { task, wasAlreadyDispatched } = await store.dispatch({
    dispatchKey,
    organizationId: params.seniorToolContext.organizationId,
    clientId: params.clientId,
    conversationId: params.conversationId,
    requestedBy: requestedByUserId,
    objective: handoff.objective,
    scope: `${params.clientName ?? params.clientId}, últimos 30 dias`,
    entityRefs: [{ type: 'account', id: resolved.accountId }],
    timeWindow: { start: since.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
    originalUserRequest: params.message,
  });

  // §11: duplicata/quase-duplicata do mesmo pedido — a tarefa já existe
  // (mesma dispatchKey). Se ela já chegou num estado TERMINAL, nunca chama
  // o Jarbas de novo (rerodar análise à toa, ou pior, tentar transicionar
  // uma tarefa terminal e devolver um erro confuso pro funcionário) — só
  // devolve o que já está persistido, exatamente como uma pergunta de
  // status/resultado faria.
  if (wasAlreadyDispatched) {
    if (task.status === 'ready_for_review') {
      const result = await store.getResult(task.taskId);
      if (result) {
        const metricVerified = result.analysisConfidence !== 'insufficient_data';
        return { answer: formatExecutiveAnswer(task, result, metricVerified), metadata: { guard: 'jarbas-handoff', action: 'analysis_already_ready', task_id: task.taskId } };
      }
    }
    if (task.status === 'cancelled' || task.status.startsWith('blocked_')) {
      return { answer: describeStatus(task), metadata: { guard: 'jarbas-handoff', action: 'duplicate_of_blocked_task', task_id: task.taskId } };
    }
    // Ainda em andamento (assigned/acknowledged/analyzing/...) — deixa
    // seguir pro fluxo normal abaixo, que resume onde a tarefa já está
    // (as transições em runJarbasV2Task são idempotentes por estado atual).
  }

  const url = process.env.JARBAS_V2_URL;
  const token = process.env.AGENTES_ASK_TOKEN;
  if (!url || !token) {
    return { answer: 'Jarbas V2 não está configurado neste ambiente ainda.', metadata: { guard: 'jarbas-handoff', action: 'blocked_not_configured' } };
  }

  const outcome = await runJarbasV2Task(store, task.taskId, params.seniorToolContext.organizationId, { url, token });
  if (!outcome.ok) {
    return {
      answer: `Não consegui completar a análise agora (${outcome.reason}). Nada foi confirmado.`,
      metadata: { guard: 'jarbas-handoff', action: 'blocked_external_service', task_id: task.taskId },
    };
  }
  return { answer: outcome.answer, metadata: { guard: 'jarbas-handoff', action: 'analysis_ready', task_id: task.taskId } };
}
