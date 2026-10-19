import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  createTaskComment, deleteTask as gatewayDeleteTask, getTask as gatewayGetTask,
  getTaskComments, queryOperationTasks, resolveMemberByName, updateTask as gatewayUpdateTask,
  createVerifiedSeniorTask, type ClickUpConfig, type OperationTask, type SeniorToolContext,
} from '@desigual-os/tool-gateway';
import type {
  CreateTaskInput, TaskComment, TaskPage, TaskProvider, TaskQuery, TaskRef, UpdateTaskInput,
} from '@desigual-os/mcp-domain';

/**
 * clickup-task-provider.ts — a ÚNICA peça do MCP que sabe o que é ClickUp.
 *
 * É esse o ponto do §16: acima daqui, o domínio fala `TaskRef` e `TaskProvider`;
 * daqui para baixo, fala `OperationTask` e `list_id`. Trocar o ClickUp por outra
 * ferramenta é escrever outro arquivo deste tamanho, não reescrever o sistema.
 *
 * Duas responsabilidades que não são óbvias e moram aqui de propósito:
 *
 *  1. **Traduzir cliente em lista.** O ClickUp não conhece "cliente"; conhece
 *     lista. O mapa `clients.clickup_list_id` é detalhe de integração, e o
 *     domínio não deveria saber que ele existe.
 *
 *  2. **Recortar por organização.** Toda consulta sai já limitada aos clientes
 *     da organização do principal. Fazer esse recorte aqui, e não em cada tool,
 *     é o que impede uma tool nova de nascer vazando dado de outro tenant.
 */

export interface ClickUpProviderDeps {
  config: ClickUpConfig;
  organizationId: string;
  seniorContext: SeniorToolContext;
}

const PRIORIDADE_TEXTO: Record<number, string> = { 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };
const PRIORIDADE_NUMERO: Record<string, 1 | 2 | 3 | 4> = { urgent: 1, high: 2, normal: 3, low: 4 };

export class ClickUpTaskProvider implements TaskProvider {
  readonly nome = 'clickup';

  constructor(private readonly deps: ClickUpProviderDeps) {}

  /**
   * Clientes da organização, com a lista do ClickUp. É a fronteira de tenant
   * materializada: nada fora deste conjunto é alcançável por este provider.
   */
  private async clientesDaOrganizacao(): Promise<Array<{ id: string; name: string; listId: string }>> {
    const linhas = await db
      .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
      .from(schema.clients)
      .where(and(eq(schema.clients.organizationId, this.deps.organizationId), isNull(schema.clients.deletedAt)));
    return linhas
      .filter((c): c is { id: string; name: string; listId: string } => Boolean(c.listId))
      .map((c) => ({ id: c.id, name: c.name, listId: c.listId }));
  }

  private paraTaskRef(t: OperationTask, nomePorLista: Map<string, { id: string; name: string }>): TaskRef {
    const cliente = t.listId ? nomePorLista.get(t.listId) : undefined;
    return {
      id: t.id,
      title: t.name,
      status: t.status,
      statusType: t.statusType,
      priority: t.priority,
      dueDate: t.dueDate,
      assignees: t.assignees,
      clientId: cliente?.id ?? null,
      clientName: cliente?.name ?? t.listName ?? null,
      url: t.url,
      updatedAt: t.updatedAt,
    };
  }

  /**
   * Busca dirigida para decidir SE JÁ EXISTE — não para listar.
   *
   * Separada de `searchTasks` porque o uso é outro: isto roda antes de todo
   * create (reconcile-first) e precisa enxergar inclusive o que já foi fechado.
   * Uma task concluída ontem com o mesmo nome quase sempre significa que quem
   * pediu não sabia que ela existia, e criar outra em silêncio é o defeito que
   * a §13 manda impedir.
   */
  async findTask(clientId: string, title: string): Promise<TaskRef[]> {
    const clientes = await this.clientesDaOrganizacao();
    const alvo = clientes.find((c) => c.id === clientId);
    if (!alvo) return [];
    const mapa = new Map(clientes.map((c) => [c.listId, { id: c.id, name: c.name }]));
    const r = await queryOperationTasks(this.deps.config, { listIds: [alvo.listId], includeClosed: true });
    const alvoNormalizado = title.toLowerCase();
    return r.tasks
      .filter((t) => t.name.toLowerCase().includes(alvoNormalizado.slice(0, 24)) || alvoNormalizado.includes(t.name.toLowerCase().slice(0, 24)))
      .map((t) => this.paraTaskRef(t, mapa));
  }

  async getTask(taskId: string): Promise<TaskRef | null> {
    const detalhe = await gatewayGetTask(this.deps.config, taskId).catch(() => null);
    if (!detalhe) return null;
    const clientes = await this.clientesDaOrganizacao();
    const mapa = new Map(clientes.map((c) => [c.listId, { id: c.id, name: c.name }]));
    /**
     * FRONTEIRA: task de lista que não pertence a esta organização não existe
     * para este principal. Devolver `null` em vez de lançar é deliberado —
     * "não encontrei" não confirma a existência de nada.
     */
    const listId = (detalhe as { listId?: string | null }).listId ?? null;
    if (listId && !mapa.has(listId)) return null;
    return this.paraTaskRef(detalhe as unknown as OperationTask, mapa);
  }

  async searchTasks(query: TaskQuery): Promise<TaskPage> {
    const clientes = await this.clientesDaOrganizacao();
    const permitidos = query.clientIds?.length
      ? clientes.filter((c) => query.clientIds!.includes(c.id))
      : clientes;
    if (permitidos.length === 0) return { tasks: [], nextCursor: null, truncated: false };

    const mapa = new Map(permitidos.map((c) => [c.listId, { id: c.id, name: c.name }]));
    const r = await queryOperationTasks(this.deps.config, {
      listIds: permitidos.map((c) => c.listId),
      ...(query.dueAfter !== undefined ? { dueAfter: query.dueAfter } : {}),
      ...(query.dueBefore !== undefined ? { dueBefore: query.dueBefore } : {}),
      includeClosed: query.includeClosed ?? false,
      ...(query.assigneeIds?.length ? { assigneeIds: query.assigneeIds.map(Number) } : {}),
    });

    let tasks = r.tasks.map((t) => this.paraTaskRef(t, mapa));
    if (query.text) {
      const alvo = query.text.toLowerCase();
      tasks = tasks.filter((t) => t.title.toLowerCase().includes(alvo));
    }
    /**
     * §19: nunca devolver despejo. O corte é declarado em `truncated` para que
     * quem responde diga "pelo menos N" em vez de afirmar um total que não viu.
     */
    const limite = Math.min(query.limit ?? 25, 100);
    const inicio = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const fatia = tasks.slice(inicio, inicio + limite);
    const proximo = inicio + limite < tasks.length ? String(inicio + limite) : null;
    return { tasks: fatia, nextCursor: proximo, truncated: r.truncated || proximo !== null };
  }

  async createTask(input: CreateTaskInput): Promise<TaskRef> {
    const clientes = await this.clientesDaOrganizacao();
    const alvo = clientes.find((c) => c.id === input.clientId);
    if (!alvo) throw new Error('Cliente não encontrado nesta organização, ou sem lista do ClickUp vinculada.');

    const resultado = await createVerifiedSeniorTask(this.deps.config, this.deps.seniorContext, {
      listId: alvo.listId,
      name: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.assigneeName ? { assigneeName: input.assigneeName } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.parentTaskId ? { parent: input.parentTaskId } : {}),
    } as never);

    if (!resultado.success) {
      throw new Error(`${resultado.errorCode}: ${resultado.message}`);
    }
    const criada = await this.getTask((resultado as { taskId?: string }).taskId ?? '');
    if (!criada) throw new Error('A task foi criada mas não consegui relê-la para confirmar.');
    return criada;
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<TaskRef> {
    const antes = await this.getTask(taskId);
    if (!antes) throw new Error('Não encontrei essa task.');

    const params: Record<string, unknown> = {};
    if (input.title) params.name = input.title;
    if (input.description) params.description = input.description;
    if (input.status) params.status = input.status;
    if (input.priority && PRIORIDADE_NUMERO[input.priority]) params.priority = PRIORIDADE_NUMERO[input.priority];
    if (input.dueDate) {
      const ms = Date.parse(input.dueDate);
      if (Number.isNaN(ms)) throw new Error(`Data inválida: ${input.dueDate}. Use AAAA-MM-DD.`);
      params.dueDate = ms;
    }
    if (input.assigneeName) {
      const resolucao = await resolveMemberByName(this.deps.config, input.assigneeName);
      if (resolucao.status !== 'resolved') {
        /**
         * AMBIGUIDADE NUNCA VIRA ESCOLHA SILENCIOSA (§14).
         *
         * Quando dois "Gabriel" atendem pelo mesmo primeiro nome, escolher um
         * deles significa atribuir o trabalho de um cliente à pessoa errada.
         * Os candidatos vão na mensagem: quem pediu decide, o sistema não
         * adivinha.
         */
        if (resolucao.status === 'ambiguous') {
          const nomes = resolucao.candidates.map((c) => c.username).join(', ');
          throw new Error(`Mais de uma pessoa atende por "${input.assigneeName}": ${nomes}. Me diga qual.`);
        }
        throw new Error(`Não achei ninguém chamado "${input.assigneeName}" no ClickUp.`);
      }
      const id = resolucao.member.id;
      if (input.assigneeOperation === 'remove') params.removeAssignees = [id];
      else params.addAssignees = [id];
    }

    await gatewayUpdateTask(this.deps.config, taskId, params as never);
    // READ-BACK obrigatório: "sucesso" só depois de reler. É invariante da casa
    // (INV-003 da auditoria forense) e não tem exceção neste provider.
    const depois = await this.getTask(taskId);
    if (!depois) throw new Error('Atualizei mas não consegui reler a task para confirmar.');
    return depois;
  }

  async deleteTask(taskId: string): Promise<void> {
    await gatewayDeleteTask(this.deps.config, taskId);
  }

  async setStatus(taskId: string, status: string): Promise<TaskRef> {
    return this.updateTask(taskId, { status });
  }

  async assignUser(taskId: string, assigneeName: string, operation: 'add' | 'remove' | 'replace'): Promise<TaskRef> {
    return this.updateTask(taskId, { assigneeName, assigneeOperation: operation });
  }

  async addComment(taskId: string, text: string): Promise<TaskComment> {
    const criado = await createTaskComment(this.deps.config, taskId, text);
    return { id: String((criado as { id?: string }).id ?? ''), author: null, text, createdAt: Date.now() };
  }

  async getComments(taskId: string): Promise<TaskComment[]> {
    const lista = await getTaskComments(this.deps.config, taskId).catch(() => []);
    return lista.map((c) => ({
      id: String((c as { id?: string }).id ?? ''),
      author: (c as { user?: { username?: string } }).user?.username ?? null,
      text: (c as { text?: string }).text ?? '',
      createdAt: Number((c as { date?: string }).date ?? 0) || null,
    }));
  }

  /** Utilitário do MCP: resolve nome de pessoa em id do ClickUp, sem adivinhar. */
  static async resolverPessoa(
    config: ClickUpConfig,
    nome: string,
  ): Promise<
    | { status: 'resolved'; id: number; username: string }
    | { status: 'ambiguous'; candidatos: string[] }
    | { status: 'not_found' }
  > {
    const r = await resolveMemberByName(config, nome);
    if (r.status === 'resolved') return { status: 'resolved', id: r.member.id, username: r.member.username };
    if (r.status === 'ambiguous') return { status: 'ambiguous', candidatos: r.candidates.map((c) => c.username) };
    return { status: 'not_found' };
  }
}

/** Ids de cliente da organização — usado pelas tools que filtram por cliente. */
export async function clientesDaOrganizacao(organizationId: string): Promise<Array<{ id: string; name: string; listId: string | null }>> {
  return db
    .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)));
}

/** Confere que todos os ids pedidos pertencem à organização. Vazio = nenhum. */
export async function filtrarClientesDaOrganizacao(organizationId: string, clientIds: string[]): Promise<string[]> {
  if (clientIds.length === 0) return [];
  const linhas = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.organizationId, organizationId),
        inArray(schema.clients.id, clientIds),
        isNull(schema.clients.deletedAt),
      ),
    );
  return linhas.map((l) => l.id);
}
