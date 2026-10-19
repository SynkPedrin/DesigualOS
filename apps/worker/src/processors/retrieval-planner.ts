/**
 * retrieval-planner.ts — o Bento decide POR PERGUNTA quais fontes consultar.
 *
 * Até aqui a recuperação do turno era fixa e estrutural: memórias por escopo,
 * episódios por janela, dossiê, campanha — os mesmos gathers para "bom dia" e
 * para "o que mudou na Cosentino essa semana?". Duas fontes ficavam de fora
 * sempre: o EVENT STORE (operational_events, lido pelo MCP mas nunca pelo
 * worker no turno) e a consulta AO VIVO à lista do cliente fora da autocura
 * de campanha.
 *
 * O planner é DETERMINÍSTICO de propósito (sem LLM): uma decisão de retrieval
 * não pode custar uma chamada de modelo nem um RTT a mais no caminho crítico.
 * E ele só ADICIONA fontes — nunca remove o que o turno já fazia. Plano nulo
 * (tudo falso) = comportamento idêntico ao de antes da feature, que é o caso
 * dos jobs antigos sem `intent` e das perguntas sem sinal nenhum.
 *
 * A execução do plano mora em planner-sources.ts; aqui só a decisão pura e os
 * formatadores puros, testáveis sem banco nem rede.
 *
 * PONTO DE INTEGRAÇÃO FUTURO — TypeSafe/Jev (docs: https://docs.typesafe.ai/llms.txt):
 * a skill adotada pelo projeto prega "regras conhecidas ficam em código,
 * julgamento semântico vira primitiva tipada". As três regras abaixo são o
 * caso conhecido e ficam em regex determinística. O que um Jev responderia
 * aqui, quando houver TYPESAFE_API_KEY, é o JULGAMENTO que a regex não cobre:
 * classificar o tipo da pergunta ("mudança" vs "estado" vs "factual" vs
 * "conversa") quando a forma é ambígua — ex.: "me atualiza da Cosentino"
 * (mudança? estado?) ou "vale a pena manter essa linha?" (factual? criativo?).
 * A assinatura de `planejarRecuperacao` já é o contrato tipado que esse
 * julgamento preencheria; até lá, pergunta ambígua cai no PLANO_NULO, que é o
 * comportamento seguro de sempre.
 */

export interface PlanoDeRecuperacao {
  /** "O que mudou/aconteceu na X?" → ler operational_events do cliente/org. */
  incluirEventosRecentes: boolean;
  /**
   * "Status da tarefa Y agora?" → consultar a lista AO VIVO. O planner SUGERE;
   * quem VETA é o guard de frescor existente (janela de 5min de
   * `precisaResincronizar`) — ver planner-sources.ts.
   */
  consultarTarefasLive: boolean;
  /** Pergunta factual/conceitual → top-k do recall semântico sobe (5 → 8). */
  reforcarMemoriaSemantica: boolean;
}

/** O plano de quem não pediu nada: nenhuma fonte a mais, nenhuma query a mais. */
export const PLANO_NULO: PlanoDeRecuperacao = {
  incluirEventosRecentes: false,
  consultarTarefasLive: false,
  reforcarMemoriaSemantica: false,
};

/** Top-k do recall semântico quando a pergunta é factual (default é SEMANTIC_TOP_K = 5). */
export const SEMANTIC_TOP_K_REFORCADO = 8;

/**
 * Pergunta de MUDANÇA/RECÊNCIA: a resposta está na trajetória, não no estado.
 * São as formas que o próprio get_recent_events do MCP diz responder ("o que
 * aconteceu hoje?", "o que mudou desde ontem?").
 *
 * Borda de palavra por lookaround Unicode, NÃO \b: o \b do JS é ASCII e não
 * dispara antes de "ú" ("as últimas movimentações" passava batido).
 */
const PEDE_MUDANCA =
  /(?<![\p{L}\p{N}])(o que (mudou|aconteceu|houve|rolou)|mudan[çc]as?|novidades?|recentemente|recentes?|ess[ae] semana|este m[êe]s|hoje|ontem|anteontem|[úu]ltim[ao]s?|desde (ontem|anteontem|segunda))(?![\p{L}\p{N}])/iu;

/**
 * Pergunta de ESTADO ATUAL operacional: a resposta está na lista do ClickUp
 * AGORA. Só dispara live quando há cliente com lista (ver a assinatura) —
 * sem cliente resolvido, "status" é respondido pelo panorama que a API já manda.
 */
const PEDE_ESTADO_OPERACIONAL =
  /(?<![\p{L}\p{N}])(status|andamento|tarefas?|tasks?|entregas?|prazos?|vence|vencimento|atrasad[ao]s?|em aberto|pend[êe]ncias?)(?![\p{L}\p{N}])/iu;

/**
 * Pergunta FACTUAL/CONCEITUAL: começa com pronome interrogativo. É o caso em
 * que o fato pode estar em qualquer kind de memória, então o recall por
 * semelhança ganha top-k maior em vez de cortar no 5.
 */
const PERGUNTA_FACTUAL =
  /^\s*(quem|qual|quais|quanto|quantos|quantas|onde|quando|como|por\s*que|porqu[êe])(?![\p{L}\p{N}])/iu;

export function planejarRecuperacao(args: {
  intent?: string | undefined;
  mensagem: string;
  citouCliente: boolean;
  clienteTemListaClickup: boolean;
}): PlanoDeRecuperacao {
  // A mensagem pode chegar com blocos anexados pela API ("---\nContexto:...");
  // a decisão é sobre o que a PESSOA escreveu, não sobre o encanamento.
  const texto = (args.mensagem.split('\n\n---\n')[0] ?? args.mensagem).trim();
  if (texto.length === 0) return PLANO_NULO;

  return {
    incluirEventosRecentes: PEDE_MUDANCA.test(texto),
    consultarTarefasLive:
      args.citouCliente && args.clienteTemListaClickup && PEDE_ESTADO_OPERACIONAL.test(texto),
    reforcarMemoriaSemantica: args.intent === 'knowledge_query' || PERGUNTA_FACTUAL.test(texto),
  };
}

/** Resumo mínimo de uma tarefa lida ao vivo — o retorno de buscarTasksDaLista. */
export interface TarefaLive {
  id: string;
  name: string;
  status: string | null;
  closed: boolean;
  updatedAt: Date | null;
}

/**
 * Bloco do estado AO VIVO da lista. Lista vazia NÃO vira "0 tarefas": o
 * coletor devolve [] tanto para lista vazia quanto para falha de provedor, e
 * afirmar zero a partir de uma falha seria o pior dos dois mundos — sem
 * bloco, o turno segue com o registro de campanha que já tinha.
 */
export function formatLiveTasksBlock(tarefas: TarefaLive[]): string {
  if (tarefas.length === 0) return '';
  const abertas = tarefas.filter((t) => !t.closed);
  const recentes = [...tarefas]
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
    .slice(0, 12);
  const linhas = [
    `ESTADO AO VIVO DA LISTA (ClickUp, consultado neste turno): ${tarefas.length} tarefa(s) no total, ${abertas.length} em aberto.`,
    'Movimentadas mais recentemente:',
  ];
  for (const t of recentes) {
    const data = t.updatedAt ? ` (atualizada em ${t.updatedAt.toISOString().slice(0, 10)})` : '';
    linhas.push(`- ${t.name}${t.status ? ` [${t.status}]` : ''}${data}`);
  }
  linhas.push(
    '',
    'Este bloco é o dado MAIS FRESCO do turno: em divergência com o registro de campanha, vale este.',
  );
  return linhas.join('\n');
}
