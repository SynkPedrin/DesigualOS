/**
 * task-provider.ts — a interface genérica de conectores de tarefa.
 *
 * WHITE LABEL (01/10/2026): cada subconta vai conectar a PRÓPRIA plataforma de
 * gestão — ClickUp, Jira, Monday, Trello — em vez de viver na chave global da
 * Desigual (CLICKUP_API_KEY/CLICKUP_TEAM_ID). Esta interface é o contrato que
 * todos eles implementam; as credenciais de cada empresa moram em
 * `organization_connectors` e quem monta o adapter certo é
 * `resolveTaskProvider` (task-provider-resolver.ts).
 *
 * COMO ADICIONAR UM PROVIDER NOVO (Jira, Monday, Trello...):
 *
 *   1. crie `<provider>-task-provider-adapter.ts` neste pacote, implementando
 *      `TaskProvider` — o adapter do ClickUp (clickup-task-provider-adapter.ts)
 *      é o modelo: ele delega nas funções que já existiam, sem mudar
 *      comportamento;
 *   2. registre o provider em `buildProviderFromConfig` no resolver, com a
 *      validação das credenciais daquele provedor (o que é obrigatório no
 *      `credentials` jsonb dele);
 *   3. pronto. Nenhum consumidor muda: quem lê/escreve fala `TaskProvider` e
 *      recebe o adapter da org do turno.
 *
 * O QUE AINDA NÃO PASSA POR AQUI (follow-up explícito, não esquecimento):
 * os caminhos de ESCRITA — bento-action-guard, as rotas webhook/CRUD de
 * apps/api/src/clickup e o provider do MCP (apps/mcp/src/providers/
 * clickup-task-provider.ts) — continuam montando `ClickUpConfig` direto das
 * envs. Migrá-los é deliberadamente NÃO feito nesta etapa: são os caminhos
 * onde uma regressão cria/edita task na operação real do cliente, e o ganho
 * não paga o risco sem uma rodada de QA dedicada. A interface já tem
 * createTask/updateTask/addComment exatamente para essa migração futura.
 */

/**
 * Tarefa normalizada, igual em qualquer plataforma.
 *
 * Só tem campo que algum consumidor usa de verdade (o primeiro é
 * `buscarTasksDaLista` em apps/worker/src/processors/campaign-context.ts).
 * Campo que ninguém lê não entra aqui: quem precisar de um detalhe específico
 * do provedor o adiciona junto com o consumidor que o justifica.
 */
export interface ProviderTask {
  id: string;
  /** O nome da tarefa ("title" em Jira/Monday, "name" no ClickUp). */
  title: string;
  description: string | null;
  status: string | null;
  /**
   * O TIPO do status na plataforma ('open' | 'closed' | 'done' | ...). É ele —
   * e não o rótulo — que decide se a tarefa está encerrada, porque o rótulo é
   * livre em todo provedor ("pronto", "done", "concluído").
   */
  statusType: string | null;
  /** Nomes legíveis dos responsáveis (username ou e-mail). */
  assignees: string[];
  /** Vencimento em epoch ms, como o ClickUp devolve. `null` = sem prazo. */
  dueDate: number | null;
  /** Última atualização em epoch ms. `null` = a plataforma não informou. */
  updatedAt: number | null;
  url: string | null;
}

/** Escopo de uma LISTAGEM: em quais contêineres (listas/boards/projetos) ler. */
export interface TaskListScope {
  /**
   * Listas autorizadas. Vazio = sem filtro de lista — a decisão de quais listas
   * aquele usuário pode ver continua sendo de QUEM CHAMA (ver a nota de
   * autorização no topo de clickup-operation.ts: escopo aqui nunca é bypass).
   */
  listIds?: string[];
  includeClosed?: boolean;
  subtasks?: boolean;
}

/**
 * Criação. `listId` é o contêiner de destino — obrigatório porque todo
 * provedor cria tarefa DENTRO de algo (lista no ClickUp, projeto no Jira,
 * board no Monday).
 */
export interface CreateTaskInput {
  listId: string;
  title: string;
  description?: string;
  /** Id do responsável NA PLATAFORMA (número no ClickUp, accountId no Jira). */
  assigneeId?: number;
  /** Escala 1-4 do ClickUp (1=urgente ... 4=baixa); cada adapter traduz da sua escala. */
  priority?: 1 | 2 | 3 | 4;
  /** Epoch ms. */
  dueDate?: number;
  tags?: string[];
  /** Id da tarefa-mãe: é como se cria SUBTAREFA no ClickUp (28/09/2026). */
  parentId?: string;
  /** Epoch ms. */
  startDate?: number;
}

/** Edição parcial: campo ausente = não mexe; `null` em data = limpa. */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: 1 | 2 | 3 | 4;
  dueDate?: number | null;
  addAssignees?: number[];
  removeAssignees?: number[];
  startDate?: number | null;
  timeEstimate?: number | null;
}

/**
 * A cerca de escrita, do ponto de vista do provider.
 *
 * Espelha `ClickUpConfig.writeScope` (ver write-scope.ts): a validação real —
 * kill switch, lista cercada, task pertencente a cliente conhecido — continua
 * DENTRO do adapter, impossível de contornar. Isto é só a válvula de quem já
 * passou pelo portão de produção rio acima (o bento-action-guard, depois de
 * provar org + RBAC + identidade humana).
 */
export interface WriteScope {
  authorizedForProduction?: boolean;
}

/** O contrato que todo conector de tarefa implementa. */
export interface TaskProvider {
  /** 'clickup' | 'jira' | 'monday' | ... — o mesmo valor gravado em organization_connectors.provider. */
  readonly provider: string;
  listTasks(scope: TaskListScope): Promise<ProviderTask[]>;
  getTask(id: string): Promise<ProviderTask | null>;
  createTask(input: CreateTaskInput, scope: WriteScope): Promise<ProviderTask>;
  updateTask(id: string, input: UpdateTaskInput, scope: WriteScope): Promise<ProviderTask>;
  addComment(id: string, text: string, scope: WriteScope): Promise<void>;
}
