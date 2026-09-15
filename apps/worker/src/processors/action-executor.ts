import {
  createTaskComment,
  getTaskComments,
  getTask,
  updateTask,
  verifyTaskState,
  WriteScopeError,
  type ClickUpConfig,
} from '@desigual-os/tool-gateway';
import type { AgentAction } from './agent-actions';
import { MARCADOR_ATRASO } from './agent-actions';

/**
 * action-executor.ts — EXECUÇÃO + VERIFICAÇÃO de uma ação autorizada.
 *
 * Regra que não se negocia (seções 32-33): nenhuma ação é "feita" sem
 * read-back. A escrita acontece, a leitura confirma, e só então o status vira
 * 'executed'. Escrita que o ClickUp aceitou mas cuja releitura não bate volta
 * como falha — é o que impede o relatório final de dizer "resolvi" sobre algo
 * que não mudou.
 *
 * O WriteScopeError é tratado à parte de propósito: ele não é falha de
 * execução, é a cerca de segurança fazendo o trabalho dela.
 */

export interface ExecutionDeps {
  addComment: (config: ClickUpConfig, taskId: string, text: string) => Promise<{ id: string }>;
  readComments: (config: ClickUpConfig, taskId: string) => Promise<Array<{ id: string; text: string }>>;
  readTask: typeof getTask;
  editTask: typeof updateTask;
}

export const defaultExecutionDeps: ExecutionDeps = {
  addComment: async (config, taskId, text) => createTaskComment(config, taskId, text),
  readComments: async (config, taskId) => getTaskComments(config, taskId),
  readTask: getTask,
  editTask: updateTask,
};

export interface ExecutedAction {
  action: AgentAction;
  ok: boolean;
  /** Texto pro trace/observação do passo. */
  observation: string;
  /** Houve read-back e ele bateu? */
  verified: boolean;
  toolCall: { tool: string; ok: boolean; error?: string };
}

export async function executeAction(
  config: ClickUpConfig,
  action: AgentAction,
  deps: ExecutionDeps = defaultExecutionDeps,
): Promise<ExecutedAction> {
  const tool = action.tool ?? 'none';
  const falha = (motivo: string, bloqueada = false): ExecutedAction => {
    action.status = bloqueada ? 'blocked' : 'failed';
    action.observation = motivo;
    action.verified = false;
    return { action, ok: false, observation: motivo, verified: false, toolCall: { tool, ok: false, error: motivo } };
  };

  try {
    if (action.type === 'add_comment') {
      const taskId = String(action.arguments.taskId ?? '');
      const texto = String(action.arguments.text ?? '');
      if (!taskId || !texto) return falha('ação sem taskId ou texto');

      await deps.addComment(config, taskId, texto);

      // READ-BACK: relê os comentários e confirma que o nosso está lá.
      const comentarios = await deps.readComments(config, taskId);
      const achou = comentarios.some((c) => c.text.includes(MARCADOR_ATRASO));
      if (!achou) {
        return falha('comentário enviado mas NÃO encontrado na releitura da task');
      }
      action.status = 'executed';
      action.verified = true;
      action.observation = `comentário registrado e confirmado por leitura na task ${taskId}`;
      return {
        action,
        ok: true,
        observation: action.observation,
        verified: true,
        toolCall: { tool, ok: true },
      };
    }

    if (action.type === 'assign_task' || action.type === 'update_due_date' || action.type === 'update_status') {
      const taskId = String(action.arguments.taskId ?? '');
      if (!taskId) return falha('ação sem taskId');
      const patch: Parameters<typeof updateTask>[2] = {};
      if (action.type === 'assign_task') patch.addAssignees = [Number(action.arguments.assigneeId)];
      if (action.type === 'update_due_date') patch.dueDate = Number(action.arguments.dueDate);
      if (action.type === 'update_status') patch.status = String(action.arguments.status);

      await deps.editTask(config, taskId, patch);

      const relida = await deps.readTask(config, taskId);
      const verif = verifyTaskState(relida, {
        ...(action.type === 'assign_task' ? { assigneeIds: [Number(action.arguments.assigneeId)] } : {}),
        ...(action.type === 'update_due_date'
          ? { dueDate: Number(action.arguments.dueDate), dueDateGranularity: 'day' as const }
          : {}),
        ...(action.type === 'update_status' ? { status: String(action.arguments.status) } : {}),
      });
      if (!verif.ok) return falha(`read-back não bateu: ${verif.mismatches.join('; ')}`);

      action.status = 'executed';
      action.verified = true;
      action.observation = `${action.type} aplicado e confirmado por leitura na task ${taskId}`;
      return { action, ok: true, observation: action.observation, verified: true, toolCall: { tool, ok: true } };
    }

    return falha(`tipo de ação não executável pelo runtime: ${action.type}`);
  } catch (error) {
    if (error instanceof WriteScopeError) {
      // A cerca funcionando não é bug: é bloqueio, e o relatório precisa dizer isso.
      return falha(`BLOQUEADA pela cerca de escopo: ${error.message}`, true);
    }
    return falha(error instanceof Error ? error.message : String(error));
  }
}
