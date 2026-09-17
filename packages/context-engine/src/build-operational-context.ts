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
    /** Recorte por responsável (escopo PERSON): ids de membro do ClickUp já
     * resolvidos pelo chamador, que é quem tem acesso à API. */
    assigneeIds?: number[];
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

  // Escopo de cliente(s): só as listas daqueles clientes. Escopo GLOBAL e
  // PERSON: todas as listas autorizadas — no PERSON o recorte é por
  // responsável (assigneeIds), nunca por cliente.
  const alvo =
    scope.kind === 'GLOBAL' || scope.kind === 'PERSON'
      ? clients
      : clients.filter((c) => scope.clients.some((s) => s.id === c.id));
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
      ...(scope.kind === 'PERSON' && scope.person?.memberIds?.length ? { assigneeIds: scope.person.memberIds } : {}),
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
  /**
   * ESCOPO DO NÚMERO, dito antes do número.
   *
   * O cabeçalho já trazia "em N cliente(s)", mas isso é uma consequência que o
   * modelo precisa inferir. Quando o turno é GLOBAL e a conversa está aberta em
   * um cliente, os dois chegam juntos e a inferência falha: medido no navegador
   * em 17/09/2026, o resumo de reunião saiu como "1106 tarefas abertas em
   * andamento no Cosentino" — o total da carteira inteira atribuído a uma conta,
   * num texto feito pra ser levado a uma reunião.
   *
   * Dizer o escopo custa uma linha; o erro custa a confiança em todo número que
   * o agente der depois.
   */
  const escopoDoNumero =
    scope.kind === 'GLOBAL'
      ? 'ESTES NÚMEROS SÃO DA OPERAÇÃO INTEIRA (todos os clientes somados). NUNCA atribua um total destes a um cliente específico: se for falar de um cliente, use só os itens listados sob o nome dele.'
      : scope.kind === 'CLIENT' && scope.clients.length === 1
        ? `ESTES NÚMEROS SÃO SOMENTE DE ${scope.clients[0]!.name.toUpperCase()}.`
        : scope.kind === 'PERSON' && scope.person
          ? `ESTES NÚMEROS SÃO SOMENTE DO QUE ESTÁ COM ${scope.person.name.toUpperCase()}, atravessando clientes.`
          : null;
  if (escopoDoNumero) linhas.push(escopoDoNumero);
  linhas.push(
    `${result.tasks.length} tarefa(s) aberta(s)${janela} em ${byClient.length} cliente(s), de ${listIds.length} cliente(s) consultado(s).`,
  );
  if (overdue > 0) linhas.push(`${overdue} já passou do prazo.`);
  if (unassigned > 0) linhas.push(`${unassigned} sem responsável definido.`);
  if (result.truncated) {
    linhas.push('ATENÇÃO: a consulta atingiu o teto de páginas — o número acima é um MÍNIMO, não o total. Diga isso se for citar quantidade.');
  }
  /**
   * PRAZO NÃO É DATA DE EVENTO.
   *
   * O `prazo:` de cada linha abaixo é a data de entrega da TAREFA no ClickUp —
   * quando a peça precisa estar pronta. Numa tarefa chamada "Elite Aniversário
   * 70 anos" essa data fica a um passo de virar "a data do aniversário", e é a
   * única data concreta que o turno tem em mãos. Pedido de "coloca a data exata
   * do evento" é exatamente o caso em que entregar sempre não pode virar
   * licença pra cravar fato: a resposta certa é pedir a data ou marcá-la a
   * confirmar.
   */
  linhas.push(
    'PRAZO é data de entrega da TAREFA, nunca data de evento, de veiculação ou de campanha. Se pedirem a data de um evento e ela não estiver escrita em outro lugar, ela NÃO é conhecida: peça ou marque [A CONFIRMAR], não deduza de um prazo.',
  );
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
