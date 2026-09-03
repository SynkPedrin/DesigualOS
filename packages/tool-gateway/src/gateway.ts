import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AgentName } from '@desigual-os/types';

export interface ToolAccessEntry {
  access: 'none' | 'read' | 'write';
  requiresApproval: boolean;
}

/**
 * Matriz de permissões do Tool Gateway (seção 6.6 do prompt mestre),
 * seedada em packages/database/src/seed.ts. Sem linha na matriz, trata
 * como acesso negado (nunca permite por omissão).
 */
export async function checkAgentToolAccess(agent: AgentName, tool: string): Promise<ToolAccessEntry | null> {
  const [entry] = await db
    .select({ access: schema.agentTools.access, requiresApproval: schema.agentTools.requiresApproval })
    .from(schema.agentTools)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.agentTools.agentId))
    .where(and(eq(schema.agents.name, agent), eq(schema.agentTools.tool, tool)));

  return entry ?? null;
}

export type ToolCallOutcome =
  | { status: 'denied'; toolCallId: string }
  | { status: 'pending_approval'; toolCallId: string }
  | { status: 'approved'; toolCallId: string };

/**
 * Ponto único de passagem pra uma ação sensível (seção 6.6: "toda chamada
 * de ferramenta passa pelo Tool Gateway"). Registra sempre em tool_calls
 * antes de decidir; se a matriz exigir aprovação, não executa aqui, quem
 * chamou precisa esperar approveToolCall antes de rodar a ação de verdade.
 */
export async function requestToolCall(params: {
  executionId?: string | null;
  agent: AgentName;
  tool: string;
  input: Record<string, unknown>;
}): Promise<ToolCallOutcome> {
  const entry = await checkAgentToolAccess(params.agent, params.tool);
  const requiresApproval = entry?.requiresApproval ?? false;

  const [toolCall] = await db
    .insert(schema.toolCalls)
    .values({
      executionId: params.executionId ?? null,
      agent: params.agent,
      tool: params.tool,
      input: params.input,
      requiresApproval,
    })
    .returning();

  if (!toolCall) {
    throw new Error('Failed to log tool call');
  }

  if (!entry || entry.access === 'none') {
    await db.insert(schema.toolResults).values({
      toolCallId: toolCall.id,
      status: 'denied',
      output: null,
      error: `Agent '${params.agent}' has no '${params.tool}' access in the permission matrix`,
    });
    return { status: 'denied', toolCallId: toolCall.id };
  }

  if (requiresApproval) {
    await notifyMastersOfPendingApproval(params.agent, params.tool, toolCall.id);
    return { status: 'pending_approval', toolCallId: toolCall.id };
  }

  return { status: 'approved', toolCallId: toolCall.id };
}

export async function recordToolResult(toolCallId: string, status: 'completed' | 'failed', output: Record<string, unknown> | null, error?: string): Promise<void> {
  await db.insert(schema.toolResults).values({ toolCallId, status, output, error: error ?? null });
}

async function notifyMastersOfPendingApproval(agent: AgentName, tool: string, toolCallId: string): Promise<void> {
  const masters = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.roles.name, 'master'));

  if (masters.length === 0) return;

  await db.insert(schema.notifications).values(
    masters.map((master) => ({
      userId: master.userId,
      type: 'tool_call_pending_approval',
      title: `Aprovação pendente: ${agent} quer usar ${tool}`,
      body: `Ação crítica aguardando aprovação (tool_call ${toolCallId}). Revise em GET /tool-calls?pending=true.`,
    })),
  );
}

export interface PendingToolCall {
  id: string;
  agent: AgentName;
  tool: string;
  input: Record<string, unknown>;
  createdAt: Date;
}

export async function listPendingToolCalls(): Promise<PendingToolCall[]> {
  const rows = await db
    .select()
    .from(schema.toolCalls)
    .where(and(eq(schema.toolCalls.requiresApproval, true), isNull(schema.toolCalls.approvedBy)));

  return rows.map((row) => ({ id: row.id, agent: row.agent, tool: row.tool, input: row.input, createdAt: row.createdAt }));
}

export interface ApprovedToolCall {
  id: string;
  agent: AgentName;
  tool: string;
  input: Record<string, unknown>;
}

/**
 * Aprova e devolve os dados da chamada pra quem pediu aprovação executar
 * a ação de verdade (o Gateway não sabe como executar cada tool, só
 * controla o acesso). Falha se já foi aprovada ou não precisa de aprovação.
 */
export async function approveToolCall(toolCallId: string, approvedByUserId: string): Promise<ApprovedToolCall> {
  const [toolCall] = await db.select().from(schema.toolCalls).where(eq(schema.toolCalls.id, toolCallId));
  if (!toolCall) {
    throw new Error(`Tool call '${toolCallId}' not found`);
  }
  if (!toolCall.requiresApproval) {
    throw new Error(`Tool call '${toolCallId}' does not require approval`);
  }
  if (toolCall.approvedAt) {
    throw new Error(`Tool call '${toolCallId}' was already approved`);
  }

  await db.update(schema.toolCalls).set({ approvedBy: approvedByUserId, approvedAt: new Date() }).where(eq(schema.toolCalls.id, toolCallId));

  return { id: toolCall.id, agent: toolCall.agent, tool: toolCall.tool, input: toolCall.input };
}
