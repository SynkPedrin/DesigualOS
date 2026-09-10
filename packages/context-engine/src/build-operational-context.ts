import type { OperationalScope } from './resolve-scope';
import { zonedDayStart } from './resolve-temporal';

/**
 * build-operational-context.ts — transforma o escopo resolvido em DADO REAL de operação,
 * já formatado pro agente, e nunca em texto genérico.
 *
 * Regra de precedência de dados que isto materializa: dado AO VIVO do ClickUp vence
 * memória consolidada. Se o ClickUp diz que a task vence amanhã e uma memória antiga diz
 * outra coisa, o que entra no prompt é o ClickUp — e o bloco é marcado como "ao vivo,
 * consultado agora" pra que o agente não trate como lembrança.
 *
 * As dependências entram por injeção (não `import` direto do tool-gateway) por dois
 * motivos: mantém o context-engine sem depender da camada de integração, e deixa isto
 * testável sem rede.
 */

export interface OperationalTaskLike {
  id: string;
  name: string;
  status: string | null;
  statusType: string | null;
  priority: string | null;
  dueDate: number | null;
  assignees: string[];
  listId: string | null;
  listName: string | null;
  url: string | null;
}

export interface OperationalContextDeps {
  /** Clientes que o usuário PODE ver, com o mapeamento pra lista do ClickUp. */
  listAuthorizedClients: () => Promise<Array<{ id: string; name: string; clickupListId: string | null }>>;
  /** Consulta ao vivo. `listIds` vazio = sem filtro (o chamador decide). */
  queryTasks: (query: {
    listIds?: string[];
    dueAfter?: number;
    dueBefore?: number;
    includeClosed?: boolean;
  }) => Promise<{ tasks: OperationalTaskLike[]; truncated: boolean }>;
}

export interface OperationalContext {
  /** Bloco de texto pronto pro prompt. `null` quando não havia o que buscar. */
  block: string | null;
  /** Números crus, pra quem quiser responder sem LLM (rota tool-only) ou pra log. */
  summary: {
    total: number;
    byClient: Array<{ clientName: string; count: number }>;
    overdue: number;
    unassigned: number;
    truncated: boolean;
    clientsConsidered: number;
  } | null;
  /** Erro honesto de ferramenta: quando isso vem preenchido, o agente TEM que dizer que
   * não conseguiu consultar, e nunca responder com número inventado. */
  failure: string | null;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function formatDueDate(ms: number | null, timeZone = 'America/Sao_Paulo'): string {
  if (!ms) return 'sem prazo';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(new Date(ms));
}

/**
 * Busca e formata. Nunca lança: falha de integração vira `failure` preenchido, porque a
 * resposta certa nesse caso é "não consegui consultar agora", não um número chutado.
 */
export async function buildOperationalContext(
  scope: OperationalScope,
  deps: OperationalContextDeps,
  now: Date = new Date(),
): Promise<OperationalContext> {
  if (!scope.operational || scope.kind === 'NONE' || scope.kind === 'AMBIGUOUS') {
    return { block: null, summary: null, failure: null };
  }

  let clients: Array<{ id: string; name: string; clickupListId: string | null }>;
  try {
    clients = await deps.listAuthorizedClients();
  } catch (error) {
    return { block: null, summary: null, failure: `não consegui carregar a lista de clientes (${(error as Error).message})` };
  }

  // Escopo de cliente(s): só as listas daqueles clientes. Escopo global: todas as listas
  // dos clientes AUTORIZADOS — nunca "sem filtro", pra que a consulta não alcance
  // nada fora da carteira que o usuário pode ver.
  const alvo = scope.kind === 'GLOBAL' ? clients : clients.filter((c) => scope.clients.some((s) => s.id === c.id));
  const listIds = alvo.map((c) => c.clickupListId).filter((id): id is string => Boolean(id));

  if (listIds.length === 0) {
    return {
      block: null,
      summary: null,
      failure:
        scope.kind === 'GLOBAL'
          ? 'nenhum cliente com lista do ClickUp vinculada'
          : `o cliente citado não tem lista do ClickUp vinculada (${alvo.map((c) => c.name).join(', ') || 'desconhecido'})`,
    };
  }

  let result: { tasks: OperationalTaskLike[]; truncated: boolean };
  try {
    result = await deps.queryTasks({
      listIds,
      ...(scope.temporal ? { dueAfter: scope.temporal.from, dueBefore: scope.temporal.to } : {}),
      includeClosed: false,
    });
  } catch (error) {
    return { block: null, summary: null, failure: `a consulta ao ClickUp falhou (${(error as Error).message})` };
  }

  const nomePorLista = new Map(alvo.filter((c) => c.clickupListId).map((c) => [c.clickupListId!, c.name]));
  // "Atrasada" = venceu num dia ANTERIOR, não "venceu antes deste instante". Bug pego em
  // teste com dado real (10/09/2026 01:51 local): 13 tarefas com vencimento HOJE às 00:00
  // apareciam todas como ATRASADA, e o agente teria dito "13 atrasadas" sobre tarefas que
  // simplesmente vencem hoje. Comparar contra o início do dia local corrige e casa com a
  // janela usada pela própria resolução temporal de "atrasadas".
  const inicioDeHoje = zonedDayStart(now, 0);

  const porCliente = new Map<string, OperationalTaskLike[]>();
  for (const task of result.tasks) {
    const nome = (task.listId ? nomePorLista.get(task.listId) : null) ?? task.listName ?? 'sem cliente vinculado';
    const lista = porCliente.get(nome) ?? [];
    lista.push(task);
    porCliente.set(nome, lista);
  }

  // Tarefa concluída com prazo passado NÃO é atrasada (ver mesma nota em briefing-engine).
  const concluida = (t: OperationalTaskLike): boolean => t.statusType === 'done' || t.statusType === 'closed';
  const overdue = result.tasks.filter((t) => t.dueDate !== null && t.dueDate < inicioDeHoje && !concluida(t)).length;
  const unassigned = result.tasks.filter((t) => t.assignees.length === 0).length;

  const byClient = [...porCliente.entries()]
    .map(([clientName, tasks]) => ({ clientName, count: tasks.length }))
    .sort((a, b) => b.count - a.count);

  const summary = {
    total: result.tasks.length,
    byClient,
    overdue,
    unassigned,
    truncated: result.truncated,
    clientsConsidered: listIds.length,
  };

  if (result.tasks.length === 0) {
    const janela = scope.temporal ? ` para ${scope.temporal.label.replace('-', ' ')}` : '';
    const onde = scope.kind === 'GLOBAL' ? `nos ${listIds.length} clientes da carteira` : alvo.map((c) => c.name).join(', ');
    return {
      block: [
        'DADOS AO VIVO DO CLICKUP (consultados agora):',
        `Nenhuma tarefa aberta${janela} em ${onde}.`,
        'Isto é resultado real de consulta, não ausência de acesso: pode afirmar que não há nada.',
      ].join('\n'),
      summary,
      failure: null,
    };
  }

  const linhas: string[] = [];
  linhas.push('DADOS AO VIVO DO CLICKUP (consultados agora, valem mais que qualquer memória sua):');
  const janela = scope.temporal ? ` (janela: ${scope.temporal.label.replace('-', ' ')})` : '';
  linhas.push(
    `${result.tasks.length} tarefa(s) aberta(s)${janela} em ${byClient.length} cliente(s), de ${listIds.length} cliente(s) consultado(s).`,
  );
  if (overdue > 0) linhas.push(`${overdue} já passou do prazo.`);
  if (unassigned > 0) linhas.push(`${unassigned} sem responsável definido.`);
  if (result.truncated) {
    linhas.push('ATENÇÃO: a consulta atingiu o teto de páginas — o número acima é um MÍNIMO, não o total. Diga isso se for citar quantidade.');
  }
  linhas.push('');

  for (const { clientName } of byClient) {
    const tasks = [...porCliente.get(clientName)!].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2;
      const pb = PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER);
    });
    linhas.push(`${clientName} (${tasks.length}):`);
    for (const t of tasks) {
      const partes = [
        `- ${t.name}`,
        `status: ${t.status ?? 'sem status'}`,
        `prazo: ${formatDueDate(t.dueDate)}`,
        t.assignees.length ? `resp: ${t.assignees.join(', ')}` : 'resp: ninguém',
      ];
      if (t.priority) partes.push(`prioridade: ${t.priority}`);
      if (t.dueDate !== null && t.dueDate < inicioDeHoje && !concluida(t)) partes.push('ATRASADA');
      linhas.push(partes.join(' | '));
    }
    linhas.push('');
  }

  return { block: linhas.join('\n').trimEnd(), summary, failure: null };
}
