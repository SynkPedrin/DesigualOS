import { hasPermission } from '@desigual-os/auth';
import { detectJarbasHandoffRequest, detectJarbasStatusQuery, type AgentTaskStore } from '@desigual-os/agent-runtime';
import type { SeniorToolContext } from '@desigual-os/tool-gateway';
import { PostgresAgentTaskStore } from './agent-task-postgres-store';
import { runJarbasV2Task } from './jarbas-v2-orchestrator';

/**
 * jarbas-handoff.ts — integração NARROW Bento -> Jarbas V2 (missão de
 * wiring operacional, 24/09/2026). Único ponto de contato entre
 * bento-action-guard.ts e todo o resto do mecanismo Jarbas — nada mais em
 * bento-action-guard.ts muda.
 *
 * Escopo consciente do que falta: este repositório não tem, hoje, uma
 * tabela mapeando clientId (Desigual OS) -> Meta Ads accountId (o mapa
 * mora em clientData.js, do lado do agentes-desigual, fora deste
 * repositório). Sem esse mapa, um pedido em linguagem natural não tem
 * como virar uma conta Meta real — a resposta honesta é dizer isso, nunca
 * adivinhar. `resolveMetaAccountId` é o único ponto que precisaria mudar
 * quando esse mapa existir aqui.
 */

/**
 * §11 da missão de wiring: produção usa SEMPRE PostgresAgentTaskStore — se
 * o Postgres estiver fora, a chamada real dentro de `store.dispatch`/
 * `runJarbasV2Task` lança, e esse erro SOBE (nenhum catch aqui engole
 * pra "sucesso silencioso" nem troca por um store em memória). Testes
 * usam InMemoryAgentTaskStore diretamente (ver jarbas-v2-orchestrator.
 * test.ts) — nunca este arquivo, que é só o caminho real.
 */
let sharedStore: AgentTaskStore | null = null;
function getStore(): AgentTaskStore {
  if (!sharedStore) sharedStore = new PostgresAgentTaskStore();
  return sharedStore;
}

/** Ponto único de troca — hoje sempre null (mapa não existe neste repo ainda). */
async function resolveMetaAccountId(_clientId: string): Promise<string | null> {
  return null;
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

/** null = não é handoff nem status query — quem chama segue pro resto do guard normalmente. */
export async function tryJarbasHandoff(params: JarbasHandoffParams): Promise<JarbasHandoffResult | null> {
  const statusQuery = detectJarbasStatusQuery(params.message);
  if (statusQuery) {
    // TODO (fora do escopo desta missão): rastrear "última tarefa Jarbas
    // desta conversa" pra responder sem precisar do taskId em mãos.
    return {
      answer: 'Ainda não tenho como saber qual foi a última análise do Jarbas nesta conversa — isso exige rastrear a tarefa pela conversa, que ainda não está ligado aqui.',
      metadata: { guard: 'jarbas-handoff', action: 'status_query_unimplemented' },
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

  const accountId = await resolveMetaAccountId(params.clientId);
  if (!accountId) {
    return {
      answer: `Entendi o pedido, mas ainda não tenho a conta de Meta Ads de ${params.clientName ?? 'esse cliente'} mapeada aqui — preciso que alguém cadastre isso antes do Jarbas conseguir puxar dado real.`,
      metadata: { guard: 'jarbas-handoff', action: 'blocked_no_account_mapping' },
    };
  }

  const store = getStore();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const { task } = await store.dispatch({
    dispatchKey: `msg:${params.conversationId ?? 'no-conversation'}:${params.message.slice(0, 80)}`,
    organizationId: params.seniorToolContext.organizationId,
    clientId: params.clientId,
    requestedBy: params.userEmail ?? 'unknown',
    objective: handoff.objective,
    scope: `${params.clientName ?? params.clientId}, últimos 30 dias`,
    entityRefs: [{ type: 'account', id: accountId }],
    timeWindow: { start: since.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
    originalUserRequest: params.message,
  });

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
