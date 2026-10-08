import type { OperationalScope } from './resolve-scope';
import { zonedDayStart } from './resolve-temporal';
import { textoExternoSeguro } from './texto-externo';
import { APRESENTACAO_HUMANA } from './selection';
import { ehInterno } from './natureza-do-cliente';

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
  /**
   * As tasks EXATAMENTE como exibidas no bloco (ordem e recorte do teto por
   * cliente), com o nome do cliente já resolvido. É o que vira o snapshot de
   * seleção da conversa (ver selection.ts): sem isto, "a segunda" não tinha
   * como saber qual task era a segunda.
   */
  listedTasks: Array<OperationalTaskLike & { clientName: string | null }>;
  /**
   * As tarefas REALMENTE ABERTAS da consulta — o mesmo conjunto que sustenta os
   * números do bloco, já sem as de `statusType` `done`/`closed`.
   *
   * Existe porque quem monta o BRIEFING (apps/api/src/lib/operational-context.ts)
   * estava lendo a lista crua devolvida pelo ClickUp, que inclui as concluídas:
   * o bloco dizia "411 tarefa(s) aberta(s) ... 811 já concluídas ficaram FORA" e
   * o briefing, montado no MESMO turno, dizia "1222 tarefa(s)". Quem vence é o
   * briefing, então o usuário recebia o volume da operação 3x inflado — medido
   * ao vivo em 29/09/2026, com o Bento respondendo "sobrecarregado com 1222
   * tarefas ativas". Expor o conjunto filtrado é o que impede os dois caminhos
   * de divergirem de novo.
   */
  openTasks: OperationalTaskLike[];
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
  /**
   * POR QUE NÃO VEIO DADO — e as duas razões não podem ser a mesma coisa.
   *
   * 'falha'     a ferramenta quebrou: ClickUp fora, credencial inválida, timeout.
   *             É anormal, é temporário, e o agente TEM que reconhecer em voz alta,
   *             senão volta a inventar número quando a integração cai.
   *
   * 'sem_fonte' não há o que consultar: o cliente não acompanha tarefa no ClickUp.
   *             É normal, é permanente, e NÃO é um problema de ninguém.
   *
   * MEDIDO EM 01/10/2026, e é a razão desta separação existir: perguntei "Quem é o
   * decisor do Cliente Teste 7?" — um fato institucional que ACABARA de ser gravado
   * na memória, com embedding. O Bento respondeu "Não foi possível consultar o
   * ClickUp agora: o cliente citado não tem lista do ClickUp vinculada". A memória
   * tinha a resposta e nunca foi usada.
   *
   * A causa não foi o retrieval: foi esta classificação. "Sem lista" entrava como
   * `failure`, o formatador transformava qualquer `failure` num bloco "FALHA DE
   * FERRAMENTA (obrigatório reconhecer)" com a ordem "diga isso de forma curta e
   * direta", e o modelo obedeceu. A ausência numa fonte virou a resposta da
   * pergunta — que é a mesma família de defeito que este repositório já cataloga
   * como "ausência virando valor", agora no sentido inverso: o vazio gritando mais
   * alto que o fato.
   */
  failureKind: 'falha' | 'sem_fonte' | null;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function formatDueDate(ms: number | null, timeZone = 'America/Sao_Paulo', now?: Date): string {
  if (!ms) return 'sem prazo';
  // Ano explícito quando o prazo NÃO é deste ano: "12/04" solto, sem âncora de
  // ano, foi lido pelo agente como "próximas semanas" sobre uma task de abril
  // (medido em 24/09/2026). Com ano, a data fala por si.
  const comAno = now ? new Date(ms).getFullYear() !== now.getFullYear() : false;
  const opcoes: Intl.DateTimeFormatOptions = comAno
    ? { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }
    : { timeZone, day: '2-digit', month: '2-digit' };
  return new Intl.DateTimeFormat('pt-BR', opcoes).format(new Date(ms));
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
    return { block: null, listedTasks: [], openTasks: [], summary: null, failure: null, failureKind: null };
  }

  let clients: Array<{ id: string; name: string; clickupListId: string | null }>;
  try {
    clients = await deps.listAuthorizedClients();
  } catch (error) {
    return { block: null, listedTasks: [], openTasks: [], summary: null, failure: `não consegui carregar a lista de clientes (${(error as Error).message})`, failureKind: 'falha' };
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
      listedTasks: [],
      openTasks: [],
      summary: null,
      failure:
        scope.kind === 'GLOBAL'
          ? 'nenhum cliente com lista do ClickUp vinculada'
          : `o cliente citado não tem lista do ClickUp vinculada (${alvo.map((c) => c.name).join(', ') || 'desconhecido'})`,
      // Não é falha: é a resposta correta para um cliente que não acompanha
      // tarefa no ClickUp. Ver a nota em `failureKind`.
      failureKind: 'sem_fonte',
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
    return { block: null, listedTasks: [], openTasks: [], summary: null, failure: `a consulta ao ClickUp falhou (${(error as Error).message})`, failureKind: 'falha' };
  }

  /**
   * "ABERTAS" É ABERTAS DE VERDADE (24/09/2026). O ClickUp devolve status do
   * tipo `done` (ex: "pronto") mesmo com include_closed=false — são tasks
   * ENCERRADAS na prática, e listá-las como abertas misturou trabalho fechado
   * no meio de "tasks abertas" numa conversa real. Filtradas aqui, com a
   * contagem declarada no bloco pra o número bater com o ClickUp.
   */
  const encerradas = result.tasks.filter((t) => t.statusType === 'done' || t.statusType === 'closed');
  const tasksAbertas = result.tasks.filter((t) => t.statusType !== 'done' && t.statusType !== 'closed');
  result = { ...result, tasks: tasksAbertas };

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
      listedTasks: [],
      openTasks: result.tasks,
      summary,
      failure: null,
      failureKind: null,
    };
  }

  const linhas: string[] = [];
  linhas.push('DADOS AO VIVO DO CLICKUP (consultados agora, valem mais que qualquer memória sua):');
  // Âncora temporal explícita: sem a data de hoje no bloco, o agente estimava
  // "próximas semanas" sobre prazos de meses atrás (medido em 24/09/2026).
  linhas.push(
    `Hoje é ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now)}. Compare prazos com ESTA data.`,
  );
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
  const internosNoRecorte = byClient.filter((c) => ehInterno(c.clientName));
  const carteiraNoRecorte = byClient.length - internosNoRecorte.length;
  linhas.push(
    internosNoRecorte.length > 0
      ? `${result.tasks.length} tarefa(s) aberta(s)${janela}: ${carteiraNoRecorte} cliente(s) da carteira mais ${internosNoRecorte.length} frente(s) internas da agência, de ${listIds.length} lista(s) consultada(s).`
      : `${result.tasks.length} tarefa(s) aberta(s)${janela} em ${byClient.length} cliente(s), de ${listIds.length} cliente(s) consultado(s).`,
  );
  if (overdue > 0) linhas.push(`${overdue} já passou do prazo.`);
  if (unassigned > 0) linhas.push(`${unassigned} sem responsável definido.`);
  if (result.truncated) {
    linhas.push('Se for citar quantidade, diga que encontrou PELO MENOS esse número (a consulta corta no limite de páginas). Fale isso em linguagem normal, sem jargão técnico.');
  }
  if (encerradas.length > 0) {
    linhas.push(`(${encerradas.length} task(s) já concluídas/prontas ficaram FORA desta lista de abertas — não as apresente como pendentes.)`);
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
  /**
   * AUSÊNCIA DE DADO NÃO É ZERO — o defeito mais caro desta lista, porque o
   * resultado é um fato citável e errado.
   *
   * Medido duas vezes em 29/09/2026, nas personas da Tammy no navegador,
   * perguntando quanto a agência faturou com um cliente:
   *
   *   "Logo, R$ 0,00 faturado registrado no sistema."
   *   "zero. os dados consultados no ClickUp hoje mostram apenas o volume de
   *    tarefas... não há nenhum campo ou métrica financeira nesse retorno."
   *
   * Nas duas o raciocínio estava CERTO e a conclusão inverteu o sinal: a
   * segunda abre com a palavra "zero" e só depois explica que não existe o
   * campo. Quem lê rápido entende que o cliente faturou zero.
   *
   * Vale para qualquer coisa que a operação não guarda: receita, faturamento,
   * custo, verba, horas trabalhadas, contrato.
   */
  linhas.push(
    'AUSÊNCIA DE DADO NÃO É ZERO. Isto aqui é operação (tarefa, prazo, responsável, status) e não tem NENHUM dado financeiro: nem faturamento, nem receita, nem custo, nem verba, nem valor de contrato, nem horas. Se perguntarem qualquer um desses, a resposta começa dizendo que não é um dado que você tem. NUNCA responda 0, zero, R$ 0,00 ou "nenhum" para dizer "não sei" — e nunca abra a resposta com um número quando a resposta real é que o dado não existe.',
  );
  linhas.push('');
  linhas.push(...APRESENTACAO_HUMANA);
  linhas.push('');

  /**
   * TETO POR CLIENTE no panorama multi-cliente. Sem ele, o panorama GLOBAL da
   * carteira despejava TODAS as 1124 tasks abertas — 133KB, 1212 linhas — e o
   * bento-qa recusava o corpo (HTTP 413, limite de 128KB medido em produção
   * em 18/09/2026: "me atualiza aí" falhava em 65ms, sem resposta nenhuma).
   *
   * 12 por cliente já é mais do que um panorama precisa: o bloco serve pra
   * "o que tá pegando", não pra inventário. O total por cliente continua no
   * cabeçalho do grupo, então o número certo nunca se perde — só a listagem
   * é resumida, e o resumo é declarado.
   */
  const TETO_POR_CLIENTE = scope.kind === 'GLOBAL' || scope.kind === 'MULTI_CLIENT' ? 12 : Number.MAX_SAFE_INTEGER;

  const listedTasks: Array<OperationalTaskLike & { clientName: string | null }> = [];
  /**
   * A CASA NÃO É CLIENTE (29/09/2026).
   *
   * Medido numa resposta real: "Agência Desigual: 34 atrasadas" apareceu no
   * meio da carteira, entre Cosentino e D. Carvalho. São 170 tarefas de
   * trabalho REAL — operação interna, site, processo — e por isso elas não
   * saem daqui. Mas somar a casa à carteira faz o gestor ler "meus clientes
   * estão com 34 atrasadas" sobre trabalho que é dele mesmo.
   *
   * Então: rotuladas e no fim, nunca escondidas. Quem pergunta "como está a
   * carteira?" enxerga a separação; quem pergunta "o que está atrasado?"
   * continua vendo tudo, porque continua sendo tudo que precisa ser feito.
   */
  const ordenadosPorNatureza = [...byClient].sort((a, b) => {
    const ia = ehInterno(a.clientName) ? 1 : 0;
    const ib = ehInterno(b.clientName) ? 1 : 0;
    return ia !== ib ? ia - ib : 0;
  });
  const temInterno = ordenadosPorNatureza.some((c) => ehInterno(c.clientName));
  let jaSeparou = false;

  for (const { clientName } of ordenadosPorNatureza) {
    const tasks = [...porCliente.get(clientName)!].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2;
      const pb = PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER);
    });
    if (temInterno && !jaSeparou && ehInterno(clientName)) {
      jaSeparou = true;
      linhas.push(
        'TRABALHO INTERNO DA AGÊNCIA (daqui pra baixo NÃO é cliente: é a própria casa, produto interno ou projeto do dono — não chame de cliente e não some na carteira):',
      );
      linhas.push('');
    }
    const rotulo = ehInterno(clientName) ? `${clientName} [INTERNO]` : clientName;
    linhas.push(`${textoExternoSeguro(rotulo, 92) || 'cliente sem nome'} (${tasks.length}):`);
    const mostradas = tasks.slice(0, TETO_POR_CLIENTE);
    if (mostradas.length < tasks.length) {
      linhas.push(`(mostrando as ${mostradas.length} mais urgentes de ${tasks.length} — prioridade e prazo primeiro)`);
    }
    for (const t of mostradas) {
      // Tudo aqui é texto que veio do ClickUp, ou seja, de fora: sem
      // `textoExternoSeguro` uma quebra de linha no nome da tarefa forja uma
      // linha nova neste mesmo bloco, indistinguível de dado que nós
      // consultamos. Ver texto-externo.ts.
      const partes = [
        `- ${textoExternoSeguro(t.name) || 'sem nome'}`,
        `status: ${textoExternoSeguro(t.status) || 'sem status'}`,
        `prazo: ${formatDueDate(t.dueDate, 'America/Sao_Paulo', now)}`,
        t.assignees.length
          ? `resp: ${t.assignees.map((a) => textoExternoSeguro(a, 60)).filter(Boolean).join(', ') || 'ninguém'}`
          : 'resp: ninguém',
      ];
      if (t.priority) partes.push(`prioridade: ${t.priority}`);
      if (t.dueDate !== null && t.dueDate < inicioDeHoje && !concluida(t)) partes.push('ATRASADA');
      linhas.push(partes.join(' | '));
      // O snapshot de seleção replica ESTA ordem: é ela que o usuário viu, e é
      // contra ela que "a segunda" resolve depois.
      listedTasks.push({ ...t, clientName });
    }
    linhas.push('');
  }

  return { block: linhas.join('\n').trimEnd(), listedTasks, openTasks: result.tasks, summary, failure: null, failureKind: null };
}
