import {
  createTask,
  createTaskComment,
  getTask,
  updateTask,
  type ClickUpConfig,
  type TaskDetail,
} from './clickup-client';
import { queryOperationTasks, type OperationTask } from './clickup-operation';
import type {
  CreateTaskInput,
  ProviderTask,
  TaskListScope,
  TaskProvider,
  UpdateTaskInput,
  WriteScope,
} from './task-provider';

/**
 * clickup-task-provider-adapter.ts — o ClickUp falando `TaskProvider`.
 *
 * Delegação pura nas funções de clickup-client.ts/clickup-operation.ts, que
 * já existem e estão cobertas de teste. NENHUMA regra sai daqui: timeout,
 * anti-SSRF, cerca de escrita (assertListInScope/assertTaskInScope) e kill
 * switch continuam dentro do cliente — é o que torna este adapter seguro por
 * construção em vez de por disciplina.
 *
 * Zero mudança de comportamento: quem já montava `ClickUpConfig` à mão e
 * chamava as funções direto pode continuar (e os caminhos de escrita continuam
 * assim de propósito — ver o follow-up no cabeçalho de task-provider.ts).
 */

function fromOperationTask(t: OperationTask): ProviderTask {
  return {
    id: t.id,
    title: t.name,
    description: t.description,
    status: t.status,
    statusType: t.statusType,
    assignees: t.assignees,
    dueDate: t.dueDate,
    updatedAt: t.updatedAt,
    url: t.url,
  };
}

function fromTaskDetail(t: TaskDetail, url: string | null): ProviderTask {
  return {
    id: t.id,
    title: t.name,
    description: t.description || null,
    status: t.status,
    /**
     * `GET /task/{id}` não devolve o TIPO do status (só o rótulo), então aqui
     * fica `null` de propósito: "encerrada" se decide na listagem
     * (listTasks), onde o ClickUp manda `status.type`.
     */
    statusType: null,
    assignees: t.assignees.map((a) => a.username ?? String(a.id)),
    dueDate: t.dueDate,
    updatedAt: null,
    url,
  };
}

export class ClickUpTaskProvider implements TaskProvider {
  readonly provider = 'clickup';

  constructor(private readonly config: ClickUpConfig) {}

  /** A válvula de produção só entra na config quando pedida — ver WriteScope. */
  private configDeEscrita(scope: WriteScope): ClickUpConfig {
    return scope.authorizedForProduction
      ? { ...this.config, writeScope: { authorizedForProduction: true } }
      : this.config;
  }

  async listTasks(scope: TaskListScope): Promise<ProviderTask[]> {
    const page = await queryOperationTasks(this.config, {
      ...(scope.listIds !== undefined ? { listIds: scope.listIds } : {}),
      ...(scope.includeClosed !== undefined ? { includeClosed: scope.includeClosed } : {}),
      ...(scope.subtasks !== undefined ? { subtasks: scope.subtasks } : {}),
    });
    return page.tasks.map(fromOperationTask);
  }

  async getTask(id: string): Promise<ProviderTask | null> {
    try {
      const detail = await getTask(this.config, id);
      return fromTaskDetail(detail, null);
    } catch (error) {
      // O cliente traduz todo não-2xx pra Error com o status no texto; 404 aqui
      // significa "não existe", que na interface é `null`, não exceção.
      if (error instanceof Error && error.message.includes('(404)')) return null;
      throw error;
    }
  }

  async createTask(input: CreateTaskInput, scope: WriteScope): Promise<ProviderTask> {
    const created = await createTask(this.configDeEscrita(scope), {
      listId: input.listId,
      name: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.parentId !== undefined ? { parent: input.parentId } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    });
    // Releitura: quem recebe o retorno confere o estado REAL, não o pedido que
    // mandou. Se a releitura falhar, a task já existe — devolve o mínimo com o
    // id/url confirmados, nunca erro depois de ter criado.
    const detail = await this.getTask(created.id).catch(() => null);
    if (detail) return { ...detail, url: created.url };
    return {
      id: created.id,
      title: input.title,
      description: input.description ?? null,
      status: null,
      statusType: null,
      assignees: [],
      dueDate: input.dueDate ?? null,
      updatedAt: null,
      url: created.url,
    };
  }

  async updateTask(id: string, input: UpdateTaskInput, scope: WriteScope): Promise<ProviderTask> {
    await updateTask(this.configDeEscrita(scope), id, {
      ...(input.title !== undefined ? { name: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.addAssignees !== undefined ? { addAssignees: input.addAssignees } : {}),
      ...(input.removeAssignees !== undefined ? { removeAssignees: input.removeAssignees } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.timeEstimate !== undefined ? { timeEstimate: input.timeEstimate } : {}),
    });
    const atual = await this.getTask(id);
    if (!atual) throw new Error(`ClickUp atualizou a task ${id}, mas a releitura não a encontrou`);
    return atual;
  }

  async addComment(id: string, text: string, scope: WriteScope): Promise<void> {
    await createTaskComment(this.configDeEscrita(scope), id, text);
  }
}

export function createClickUpTaskProvider(config: ClickUpConfig): TaskProvider {
  return new ClickUpTaskProvider(config);
}
