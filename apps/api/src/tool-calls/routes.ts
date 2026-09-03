import type { FastifyInstance } from 'fastify';
import { approveToolCall, deleteTask, listPendingToolCalls, recordToolResult, type ClickUpConfig } from '@desigual-os/tool-gateway';
import { requireAuth, requirePermission } from '../auth/middleware';

const TOOL_EXECUTORS: Record<string, (config: ClickUpConfig, input: Record<string, unknown>) => Promise<void>> = {
  'clickup.delete_task': async (config, input) => {
    const taskId = input.task_id;
    if (typeof taskId !== 'string') {
      throw new Error("Missing 'task_id' in tool call input");
    }
    await deleteTask(config, taskId);
  },
};

function getClickUpConfig(): ClickUpConfig | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Fila de aprovação humana do Tool Gateway (seção 6.6): ações críticas
 * (hoje, só deletar tarefa do ClickUp) ficam pendentes aqui até um master
 * aprovar, só então a ação real é executada.
 */
export async function registerToolCallRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tool-calls', { preHandler: [requireAuth, requirePermission('tool_calls', 'read')] }, async () => {
    const pending = await listPendingToolCalls();
    return {
      tool_calls: pending.map((call) => ({
        id: call.id,
        agent: call.agent,
        tool: call.tool,
        input: call.input,
        created_at: call.createdAt.toISOString(),
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/tool-calls/:id/approve', { preHandler: [requireAuth, requirePermission('tool_calls', 'approve')] }, async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    let approved;
    try {
      approved = await approveToolCall(request.params.id, request.authUser.id);
    } catch (error) {
      reply.code(409);
      return { error: error instanceof Error ? error.message : String(error) };
    }

    // approveToolCall já marcou approvedAt: se a execução falhar daqui pra
    // frente sem gravar um tool_result, a chamada fica travada pra sempre
    // em "aprovada" (não aparece mais em GET /tool-calls, que só lista
    // pendentes, mas também nunca rodou e approveToolCall nunca deixa
    // aprovar de novo). Por isso os dois `return` abaixo agora gravam
    // 'failed' antes de responder, em vez de só devolver o erro.
    const executor = TOOL_EXECUTORS[approved.tool];
    if (!executor) {
      const message = `No executor registered for tool '${approved.tool}'`;
      await recordToolResult(approved.id, 'failed', null, message);
      reply.code(500);
      return { error: message };
    }

    const config = getClickUpConfig();
    if (!config) {
      const message = 'CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator';
      await recordToolResult(approved.id, 'failed', null, message);
      reply.code(500);
      return { error: message };
    }

    try {
      await executor(config, approved.input);
      await recordToolResult(approved.id, 'completed', { executed_by: request.authUser.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordToolResult(approved.id, 'failed', null, message);
      reply.code(502);
      return { error: `Tool execution failed: ${message}` };
    }

    return { id: approved.id, tool: approved.tool, status: 'completed' };
  });
}
