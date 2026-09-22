import type { FastifyInstance } from 'fastify';
import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import {
  approveToolCall,
  deleteTask,
  getTask,
  listPendingToolCalls,
  recordToolResult,
  updateTask,
  verifyTaskState,
  askAgent,
  AgentAskError,
  type ClickUpConfig,
  type ExpectedTaskState,
} from '@desigual-os/tool-gateway';
import { AGENT_TIMEOUT_MS, publishWsEvent, touchConversation } from '@desigual-os/orchestrator';
import { requireAuth, requirePermission } from '../auth/middleware';
import { tenantSharingScope } from '../lib/access';

/**
 * P1-06 (release readiness audit, 22/09/2026): delete/update aprovados
 * retornavam 'completed' só porque a chamada ao ClickUp não jogou erro —
 * nenhum read-back confirmava que a mudança REALMENTE aconteceu. Mesmo
 * princípio já aplicado no guard do Bento (readBackVerify): reler depois de
 * escrever, e um executor que não consegue confirmar lança erro em vez de
 * deixar o caller declarar sucesso não verificado.
 */
type ExecutorResult = { verified: boolean; detail?: string } | void;

const TOOL_EXECUTORS: Record<string, (input: Record<string, unknown>) => Promise<ExecutorResult>> = {
  'clickup.delete_task': async (input) => {
    const taskId = input.task_id;
    if (typeof taskId !== 'string') {
      throw new Error("Missing 'task_id' in tool call input");
    }
    const config = getClickUpConfig();
    if (!config) {
      throw new Error('CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator');
    }
    await deleteTask(config, taskId);
    const aindaExiste = await getTask(config, taskId).then(() => true).catch(() => false);
    if (aindaExiste) throw new Error(`Task ${taskId} ainda existe no ClickUp depois do delete — não confirmo sucesso sem read-back.`);
    return { verified: true, detail: 'read-back confirmou ausência' };
  },
  // BL-01: edição de task aprovada executa de fato o PUT no ClickUp. O
  // input carrega os campos validados pelo updateTaskSchema da rota PATCH.
  'clickup.update_task': async (input) => {
    const taskId = input.task_id;
    if (typeof taskId !== 'string') {
      throw new Error("Missing 'task_id' in tool call input");
    }
    const config = getClickUpConfig();
    if (!config) {
      throw new Error('CLICKUP_API_KEY/CLICKUP_TEAM_ID not configured on the Orchestrator');
    }
    const fields = (input.fields ?? {}) as Record<string, unknown>;
    const patch = {
      ...(typeof fields.name === 'string' ? { name: fields.name } : {}),
      ...(typeof fields.description === 'string' ? { description: fields.description } : {}),
      ...(typeof fields.status === 'string' ? { status: fields.status } : {}),
      ...(typeof fields.priority === 'number' ? { priority: fields.priority as 1 | 2 | 3 | 4 } : {}),
      ...(fields.due_date === null || typeof fields.due_date === 'number' ? { dueDate: fields.due_date } : {}),
    };
    await updateTask(config, taskId, patch);
    const expected: ExpectedTaskState = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate, dueDateGranularity: 'day' as const } : {}),
    };
    if (Object.keys(expected).length === 0) return { verified: true, detail: 'sem campo read-back-verificável no patch' };
    const relida = await getTask(config, taskId).catch(() => null);
    if (!relida) throw new Error(`Não consegui reler a task ${taskId} depois do update — não confirmo sucesso sem read-back.`);
    const verification = verifyTaskState(relida, expected);
    if (!verification.ok) throw new Error(`Update enviado, mas o read-back não confirma: ${verification.mismatches.join('; ')}`);
    return { verified: true, detail: 'read-back confirmou os campos alterados' };
  },
  // Executor da aprovação humana real de Jarbas (budget de Meta Ads) e Suzy
  // (publicação no Instagram) - ver o lado que INTERCEPTA a proposta em
  // apps/worker/src/processors/execute-job.ts (callAgentesDesigual). Até
  // 08/09/2026 não existia nada aqui: o "[AGUARDA_APROVACAO]" do prompt era
  // só texto, sem nenhum código que segurasse a ação até um master aprovar.
  //
  // Limite honesto: a ação REAL de Meta Ads/Instagram acontece dentro do
  // serviço externo agentes-desigual/susy-service (fora deste repo), que
  // este Orchestrator não controla nem pode chamar diretamente. O que este
  // executor garante é que o "pode ir" que o prompt do agente espera SÓ é
  // mandado de volta a ele depois de um master aprovar de verdade aqui -
  // nunca antes disso, e nunca por alguém digitando "pode ir" solto no chat
  // (que o agente externo não teria como diferenciar de uma aprovação real).
  // A segurança de que o agente externo REALMENTE espera esse sinal antes de
  // agir continua dependendo do comportamento do serviço externo.
  meta_ads: async (input) => sendApprovalConfirmation('jarbas', input),
  instagram: async (input) => sendApprovalConfirmation('suzy', input),
};

const AGENTES_ASK_DEFAULT_URL: Record<'jarbas' | 'suzy', string> = {
  jarbas: 'http://100.118.12.97:3102',
  suzy: 'http://100.86.237.73:3102',
};

async function sendApprovalConfirmation(
  agent: 'jarbas' | 'suzy',
  input: Record<string, unknown>,
): Promise<void> {
  const token = process.env.AGENTES_ASK_TOKEN;
  if (!token) {
    throw new Error('AGENTES_ASK_TOKEN not configured on the Orchestrator');
  }
  const url =
    process.env[agent === 'jarbas' ? 'JARBAS_ASK_URL' : 'SUZY_ASK_URL'] ??
    AGENTES_ASK_DEFAULT_URL[agent];
  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;
  const proposal =
    typeof input.proposal === 'string' ? input.proposal : '(proposta não registrada)';

  let confirmationAnswer: string;
  try {
    confirmationAnswer = await askAgent(
      { url, token, agent, timeoutMs: AGENT_TIMEOUT_MS[agent] },
      `Aprovação humana confirmada por um master da agência. Pode prosseguir com a ação que você propôs:\n\n${proposal}`,
      sessionId,
    );
  } catch (error) {
    const detail =
      error instanceof AgentAskError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`Falha ao mandar a confirmação de aprovação pro ${agent}: ${detail}`);
  }

  // sessionId é o conversationId quando a proposta veio de uma conversa real
  // do chat (ver callNode em execute-job.ts: sessionId = conversationId).
  // Grava a resposta do agente pós-aprovação como mensagem real, senão ela
  // fica presa só no serviço externo e ninguém no chat vê o desfecho.
  if (sessionId) {
    const [conversation] = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId));
    if (conversation) {
      await db
        .insert(schema.messages)
        .values({
          conversationId: sessionId,
          role: 'assistant',
          agent,
          content: confirmationAnswer,
        });
      await touchConversation(sessionId);
      await publishWsEvent({
        type: 'execution.completed',
        payload: { agent, status: 'completed', conversation_id: sessionId },
      }).catch(() => {});
    }
  }
}

function getClickUpConfig(): ClickUpConfig | null {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  return { apiKey, teamId };
}

/**
 * Fila de aprovação humana do Tool Gateway (seção 6.6): ações críticas
 * (deletar tarefa do ClickUp, budget de Meta Ads do Jarbas, publicação no
 * Instagram da Suzy) ficam pendentes aqui até um master aprovar, só então a
 * ação real é executada.
 */
export async function registerToolCallRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/tool-calls',
    { preHandler: [requireAuth, requirePermission('tool_calls', 'read')] },
    async (request, reply) => {
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }
      // P0-02 (22/09/2026): fila de aprovação era global entre organizações.
      const isMaster = user.roles.includes('master');
      const scope = isMaster ? null : { allowedClientIds: (await tenantSharingScope(user.id)).allowedClientIds };
      const pending = await listPendingToolCalls(scope);
      return {
        tool_calls: pending.map((call) => ({
          id: call.id,
          agent: call.agent,
          tool: call.tool,
          input: call.input,
          created_at: call.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/tool-calls/:id/approve',
    { preHandler: [requireAuth, requirePermission('tool_calls', 'approve')] },
    async (request, reply) => {
      if (!request.authUser) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      /**
       * P0-02 (22/09/2026): `approveToolCall` (tool-gateway) não valida
       * tenant — quem tivesse a permissão `tool_calls:approve` podia
       * aprovar (e disparar a execução de) uma chamada de QUALQUER
       * organização, só sabendo o id. Mesmo escopo de `GET /tool-calls`
       * acima: master aprova qualquer uma; os demais só aprovam chamada cuja
       * execução pertence a um cliente da própria organização. 404, não
       * 403, pra não revelar que a chamada existe fora do escopo.
       */
      if (!request.authUser.roles.includes('master')) {
        const [pendingRow] = await db
          .select({ clientId: schema.executions.clientId })
          .from(schema.toolCalls)
          .leftJoin(schema.executions, eq(schema.executions.id, schema.toolCalls.executionId))
          .where(eq(schema.toolCalls.id, request.params.id));
        const scope = await tenantSharingScope(request.authUser.id);
        const inScope = pendingRow?.clientId != null && scope.allowedClientIds.includes(pendingRow.clientId);
        if (!inScope) {
          reply.code(404);
          return { error: `Tool call '${request.params.id}' not found` };
        }
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

      try {
        const outcome = await executor(approved.input);
        await recordToolResult(approved.id, 'completed', { executed_by: request.authUser.id, ...(outcome ? { verified: outcome.verified, verification_detail: outcome.detail } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordToolResult(approved.id, 'failed', null, message);
        reply.code(502);
        return { error: `Tool execution failed: ${message}` };
      }

      return { id: approved.id, tool: approved.tool, status: 'completed' };
    },
  );
}
