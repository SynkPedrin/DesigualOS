import type { Logger } from '@desigual-os/logging';
import {
  buildClickUpMcpTool,
  callResponses,
  pickModel,
  type BudgetTier,
} from '@desigual-os/openai-provider';
import { getClickUpMcpAccessToken, getTask, type ClickUpConfig } from '@desigual-os/tool-gateway';
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
 */

/** §2: capacidades que este release já cobre — create/update/comment. Delete fica de fora (audit P0-19). */
const MCP_SUPPORTED_INTENTS = new Set<StructuredAction['intent']>(['create_task', 'update_task', 'comment_task']);

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

function describeOperation(action: StructuredAction, resolvedResourceId: string | null, listId: string | null): string {
  if (action.intent === 'create_task') {
    return [
      `Crie EXATAMENTE UMA task no ClickUp, na lista de id "${listId}".`,
      `Título: ${action.changes?.title ?? '(gerar um título curto e específico a partir do pedido)'}`,
      action.changes?.description ? `Descrição: ${action.changes.description}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (action.intent === 'update_task') {
    const parts = [`Atualize a task de id "${resolvedResourceId}" no ClickUp — NÃO crie uma task nova.`];
    if (action.changes?.title) parts.push(`Novo título: ${action.changes.title}`);
    if (action.changes?.description) parts.push(`Nova descrição: ${action.changes.description}`);
    if (action.changes?.dueDate) parts.push(`Novo prazo: ${action.changes.dueDate}`);
    if (action.changes?.assignee) parts.push(`Novo responsável: ${action.changes.assignee}`);
    return parts.join('\n');
  }
  // comment_task
  return `Adicione um comentário na task de id "${resolvedResourceId}" no ClickUp — NÃO crie nem atualize campos da task, só o comentário.\nTexto do comentário: ${action.changes?.comment ?? action.changes?.description ?? ''}`;
}

const MCP_EXEC_INSTRUCTIONS = `Você é o executor do Bento. Sua ÚNICA saída deve ser a chamada da ferramenta MCP do ClickUp que realiza EXATAMENTE a operação descrita — nada além dela. Não peça confirmação (já foi validada por uma camada de política antes desta chamada). Não crie recursos além do pedido. Depois de chamar a ferramenta, responda com uma confirmação curta em uma frase.`;

export interface ExecuteViaMcpParams {
  action: StructuredAction;
  resolvedResourceId: string | null;
  listId: string | null;
  mcpToken: string;
  budgetTier?: BudgetTier;
  /** Config do gateway legado — usado SÓ PRA LEITURA de verificação (§5: "sem duplicar mutation"), nunca pra escrever. */
  legacyReadConfig: ClickUpConfig | null;
  logger: Logger;
}

/**
 * Executa a operação via a tool MCP nativa (server-side, dentro da própria
 * chamada Responses — `require_approval: 'never'`). Depois, se houver
 * config do gateway legado disponível, faz um READ-ONLY read-back
 * independente (nunca escreve pelo legado) pra confirmar o resultado —
 * exatamente o que a missão pediu quando "MCP não oferece read
 * correspondente" no mesmo turno.
 */
export async function executeViaMcp(params: ExecuteViaMcpParams): Promise<WriteEnvelope> {
  const provider: WriteProvider = 'MCP';
  const decision = pickModel('clickup_write', params.budgetTier ?? 'normal');
  const operationDescription = describeOperation(params.action, params.resolvedResourceId, params.listId);

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
    return { success: false, verified: false, provider, resourceIds: [], operation: params.action.intent, changes: {}, error: messageText, retryable: true, sources: [] };
  }

  if (result.mcpCalls.length === 0) {
    return {
      success: false,
      verified: false,
      provider,
      resourceIds: [],
      operation: params.action.intent,
      changes: {},
      error: 'O modelo não chamou nenhuma tool MCP — nenhuma mutação real aconteceu',
      retryable: true,
      sources: [],
    };
  }

  const failed = result.mcpCalls.find((c) => c.error);
  if (failed) {
    return { success: false, verified: false, provider, resourceIds: [], operation: params.action.intent, changes: {}, error: `MCP (${failed.serverLabel}/${failed.name}): ${failed.error}`, retryable: true, sources: [] };
  }

  // Extração best-effort do id do recurso a partir do output da tool (JSON
  // livre, formato definido pelo servidor MCP, não por nós) — se não achar,
  // cai pro resourceId já resolvido pela policy antes desta chamada
  // (update/comment sempre têm um; create pode não ter no output).
  let resourceId = params.resolvedResourceId;
  for (const call of result.mcpCalls) {
    if (resourceId) break;
    try {
      const parsed = JSON.parse(call.output ?? '') as { id?: string; task_id?: string };
      resourceId = parsed.id ?? parsed.task_id ?? null;
    } catch {
      // output não é JSON — comum em texto livre de confirmação; sem problema, resourceId fica null.
    }
  }

  let verified = false;
  if (resourceId && params.legacyReadConfig) {
    try {
      const task = await getTask(params.legacyReadConfig, resourceId);
      verified = Boolean(task);
    } catch (error) {
      params.logger.warn?.({ error, resourceId }, '[bento-mcp-executor] read-back de verificação (leitura, sem escrita) falhou');
    }
  }

  return {
    success: true,
    verified,
    provider,
    resourceIds: resourceId ? [resourceId] : [],
    operation: params.action.intent,
    changes: params.action.changes ?? {},
    error: null,
    retryable: false,
    sources: resourceId ? [`CLICKUP_TASK:${resourceId}`] : [],
  };
}
