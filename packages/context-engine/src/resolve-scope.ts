import { resolveClientsFromText, type ClientMatch } from './resolve-client';
import { resolveTemporalRange, type TemporalRange } from './resolve-temporal';

/**
 * resolve-scope.ts — decide se a pergunta é sobre UM cliente, VÁRIOS, ou a OPERAÇÃO
 * INTEIRA, antes de qualquer agente ser chamado.
 *
 * O bug que isso resolve: até aqui não existia nenhuma noção de escopo em lugar nenhum
 * do sistema (verificado: `RouterDecision` não tem o campo, o Context Engine não tem, o
 * classificador do router não pergunta). A única resolução de cliente existente
 * devolvia `null` tanto pra "nenhum cliente" quanto pra "vários", então "quantas tasks
 * vencem amanhã?" era indistinguível de "não entendi de quem você está falando" — e o
 * agente perguntava "de qual cliente?" porque literalmente não havia informação melhor
 * pra passar pra ele.
 *
 * ARQUITETURA EM DUAS CAMADAS, de propósito:
 *   camada 1 (aqui) — determinística, testável, sem custo e sem latência de LLM.
 *   camada 2 (planner com LLM) — só é acionada quando esta devolve `confidence` baixa.
 * Isso NÃO é `if (mensagem.includes('todos'))`: a saída é uma decisão TIPADA com
 * entidades já resolvidas do banco, janela temporal em epoch ms, e `confidence` pra
 * quem chama decidir escalar. Os nomes de cliente vêm sempre da camada de dados,
 * nunca de lista no código.
 */

export type ScopeKind =
  /** Operação inteira / todos os clientes autorizados. */
  | 'GLOBAL'
  /** Exatamente um cliente resolvido. */
  | 'CLIENT'
  /** Dois ou mais clientes explicitamente citados. */
  | 'MULTI_CLIENT'
  /** Um termo bateu em 2+ clientes: dá pra perguntar a pergunta CERTA, nomeando os candidatos. */
  | 'AMBIGUOUS'
  /** Pergunta sobre UMA PESSOA da equipe ("tasks da Jamile", "atribuídas ao Pedro",
   * "o que a Tammy precisa entregar"): atravessa TODOS os clientes filtrando por
   * responsável. É o caso que gerava "de qual cliente?" quando o usuário já tinha
   * dito o que queria (falha real medida em 14/09/2026). */
  | 'PERSON'
  /** Nenhum sinal de escopo: provavelmente não é pergunta operacional. */
  | 'NONE';

/** Pessoa detectada na mensagem (nome bruto; a resolução pro membro do ClickUp
 * acontece na camada que tem acesso à API, nunca por lista hardcoded aqui). */
export interface PersonMention {
  name: string;
  confidence: number;
  /** Ids de membro do ClickUp resolvidos downstream (operational-context.ts). */
  memberIds?: number[];
  /** Username real resolvido, pra exibição. */
  resolvedAs?: string;
}

export interface OperationalScope {
  kind: ScopeKind;
  clients: ClientMatch[];
  ambiguous: Array<{ term: string; candidates: ClientMatch[] }>;
  temporal: TemporalRange | null;
  /** Pessoa detectada (só quando kind === 'PERSON'). */
  person?: PersonMention | null;
  /** A pergunta é sobre estado operacional (task/prazo/entrega)? Decide se vale buscar
   * dado ao vivo no ClickUp antes de responder. */
  operational: boolean;
  /** Pergunta comparativa entre clientes ("qual cliente...", "melhor", "quem está pior"). */
  comparative: boolean;
  /** Pediu BRIEFING (não só uma contagem): a resposta deve ser estruturada, com
   * prioridades, riscos e lacunas, e não uma lista de tarefas. Ver briefing-engine.ts. */
  briefing: boolean;
  /** 0..1. Abaixo de ESCALATE_BELOW, quem chama deveria pedir ajuda a um planner com LLM
   * em vez de confiar nesta decisão. */
  confidence: number;
  /** Por que decidiu assim. Vai pra log/observabilidade, NUNCA pra resposta do usuário. */
  signals: string[];
}

export const ESCALATE_BELOW = 0.5;

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Marcadores de "a operação inteira". Só valem quando NENHUM cliente foi resolvido —
 * "todas as tasks da 3net" tem "todas" mas é escopo de cliente (ver precedência em
 * `resolveOperationalScope`).
 */
/**
 * Como a agência pede de verdade: "me atualiza", "o que tá pegando?".
 *
 * Lista PRÓPRIA, e não mais um item dentro de GLOBAL_MARKERS, porque estas
 * frases precisam decidir DUAS coisas ao mesmo tempo — o escopo é a operação
 * inteira E a intenção é operacional. Medido em 17/09/2026: com elas só no
 * escopo, "me atualiza" resolvia GLOBAL e mesmo assim voltava sem dado nenhum,
 * porque o `operational` abaixo continuava falso e a consulta ao ClickUp nunca
 * acontecia. O agente então respondia "não recebi a lista" — que é pior que não
 * entender a pergunta, porque parece problema de dado.
 *
 * São frases INTEIRAS, nunca palavras soltas: "me atualiza" só aparece quando
 * alguém quer o panorama. Palavra solta aqui é o erro que já custou 287
 * campanhas neste repositório.
 */
const PANORAMA_MARKERS = [
  'me atualiza',
  'me atualize',
  'me poe a par',
  'ta pegando',
  'esta pegando',
  'como estamos',
  'como que ta',
  'status geral',
  'panorama',
];

const GLOBAL_MARKERS = [
  'todos os clientes',
  'todos clientes',
  'toda a operacao',
  'operacao inteira',
  'da agencia',
  'na agencia',
  'geral da agencia',
  'visao geral',
  'de todos',
  'em geral',
  'no total',
  'da carteira',
  'carteira inteira',
  ...PANORAMA_MARKERS,
];


/**
 * Pergunta que compara ENTIDADES entre si. Implica cross-client mesmo sem a palavra
 * "todos": "qual cliente tem a melhor campanha?" é ranking, não pergunta sobre um
 * cliente específico.
 */
const COMPARATIVE_MARKERS = [
  'qual cliente',
  'quais clientes',
  'que cliente',
  'melhor cliente',
  'pior cliente',
  'melhor campanha',
  'pior campanha',
  'quem esta',
  'quem ta',
  'ranking',
  'mais demandas',
  'mais tasks',
  'mais atrasad',
  'sobrecarregad',
  'gargalo',
  'top 3',
  'top 5',
  'compare',
  'comparar',
  'versus',
];

/**
 * Vocabulário de estado operacional. Presença aqui é o que autoriza o chamador a gastar
 * uma consulta ao vivo no ClickUp antes de responder.
 */
const OPERATIONAL_MARKERS = [
  'task',
  'tasks',
  'tarefa',
  'tarefas',
  'vence',
  'vencem',
  'vencendo',
  'prazo',
  'prazos',
  'atrasad',
  'pendente',
  'pendencia',
  'entrega',
  'entregas',
  'briefing',
  'producao',
  'bloquead',
  'aprovacao',
  'aguardando',
  'adiantar',
  'backlog',
  'demanda',
  'demandas',
  'status',
  'checklist',
  'agenda do dia',
  'o que temos',
  'o que tem',
  'o que rolou',
  'o que mudou',
];

/**
 * Perguntas agregadas sem cliente nomeado ("quantas tasks...", "o que vence..."). São o
 * caso mais comum de escopo global e o que mais gerava "de qual cliente?".
 */
/** Pedido de BRIEFING/plano, que exige resposta estruturada em vez de lista. */
const BRIEFING_MARKERS = [
  'briefing',
  'brief',
  'panorama',
  'me monte',
  'monta um',
  'monte um',
  'organiza',
  'organize',
  'plano de',
  'monta o plano',
  'resumo operacional',
  'me atualiza sobre',
  'situacao do',
  'situacao da',
  // Prioridade e análise de operação (§113, §137): pedidos de "o que priorizar"
  // e "analise a operação" exigem a resposta ESTRUTURADA (ranking + risco + próxima
  // ação), não uma lista crua de tarefas. Ver rankPriorities/computeNextBestActions.
  'prioriz',
  'o que priorizar',
  'o que devo priorizar',
  'o que atacar',
  'o que focar',
  'o que resolver primeiro',
  'o que fazer primeiro',
  'analise a operacao',
  'analisa a operacao',
  'analise da operacao',
  'como esta a operacao',
  'como ta a operacao',
];

const AGGREGATE_MARKERS = [
  'quantas',
  'quantos',
  'quanto',
  'resumo',
  'panorama',
  'como esta a agencia',
  'como ta a agencia',
  'o que vence',
  'o que temos',
  'o que posso adiantar',
  'o que consigo adiantar',
  'o que esta atrasad',
  'o que ta atrasad',
];

function matched(haystack: string, needles: string[]): string[] {
  return needles.filter((n) => haystack.includes(n));
}

/**
 * Detecção de PERGUNTA SOBRE PESSOA (escopo PERSON). Só roda quando nenhum
 * cliente foi resolvido: "tasks da 3net" já saiu como CLIENT antes. Os
 * padrões cobrem português operacional real:
 *   "tasks atribuídas à Jamile", "o que o Pedro precisa entregar",
 *   "tarefas do Gabriel", "me mostra o que a Tammy tem hoje".
 * O nome capturado é bruto por desenho: quem resolve pro membro real do
 * ClickUp é a camada com acesso à API (operational-context.ts).
 */
function detectPersonMention(flat: string, opcoes: { comSinalOperacional: boolean }): PersonMention | null {
  /**
   * Padrões que se sustentam SOZINHOS: a frase já é, em si, pergunta sobre
   * pessoa, não precisa de palavra operacional junto. Sem separá-los, "quem é
   * Esther?" nunca chegava aqui (a detecção só rodava com sinal operacional) e
   * a mesma pessoa recebia resposta diferente conforme a frase.
   */
  const autoSuficientes: RegExp[] = [
    /\bquem\s+(?:e|eh|seria)\s+(?:a|o)?\s*([a-z][a-z]*(?:\s+[a-z]+)?)\s*\??$/,
    /\b(?:a|o)\s+([a-z][a-z]+)\s+(?:trabalha|atende|responde|cuida)\b/,
    /**
     * Follow-up nu: "e a Tammy?". É como se pergunta numa conversa que já está
     * acontecendo, e era o buraco visível na simulação de uso real — resolvia
     * NONE, o agente não recebia dado nenhum e respondia que não encontrou.
     *
     * Seguro por dois motivos: cliente conhecido é resolvido ANTES (precedência
     * 2), então "e a Cosentino?" não chega aqui; e o nome que chega ainda é
     * conferido contra os membros REAIS do ClickUp na camada que tem a API. Não
     * achou ninguém com esse nome? A resposta honesta é dizer isso — que é
     * melhor que o silêncio de antes.
     */
    /^e\s+(?:a|o)\s+([a-z][a-z]+)\s*\??$/,
  ];

  const dependentesDeOperacional: RegExp[] = [
    // atribuída(s) à/ao/para + nome
    /atribuid[ao]s?\s+(?:a|à|ao|pro|pra|para)\s+([a-z][a-z ]{1,29})/,
    // tasks/tarefas do/da/de + nome
    /(?:tasks?|tarefas?|demandas?|entregas?)\s+(?:do|da|de)\s+([a-z][a-z ]{1,24})/,
    // <nome> precisa/tem que (entregar|fazer|produzir)
    /\b([a-z][a-z]+)\s+(?:precisa|tem que|vai)\s+(?:entregar|fazer|produzir|criar)/,
    // o que (a|o) <nome> tem/faz/entrega hoje
    /(?:o que|oque)\s+(?:a|o)\s+([a-z][a-z]+)\s+(?:tem|faz|entrega|produz)/,
  ];
  // Palavras que não são pessoa mesmo casando no padrão.
  const notPerson = new Set([
    'hoje', 'amanha', 'ontem', 'agora', 'semana', 'mes', 'ano', 'task', 'tasks', 'tarefa', 'tarefas',
    'clickup', 'cliente', 'clientes', 'operacao', 'agencia', 'todos', 'todas', 'tudo', 'isso', 'essa',
    'ele', 'ela', 'eles', 'elas', 'voce', 'você', 'eu', 'nos', 'mim', 'alguem', 'ninguem',
    'quem', 'responsavel', 'squad', 'time', 'equipe', 'pessoa', 'gente', 'aqui', 'esse', 'este',
    // Coisas, não gente: entram por causa do follow-up nu ("e a campanha?").
    'campanha', 'campanhas', 'peca', 'peça', 'legenda', 'legendas', 'copy', 'briefing', 'proposta',
    'reuniao', 'reunião', 'conta', 'contas', 'verba', 'midia', 'mídia', 'lista', 'listas',
  ]);
  const patterns = opcoes.comSinalOperacional
    ? [...autoSuficientes, ...dependentesDeOperacional]
    : autoSuficientes;

  for (const pattern of patterns) {
    const match = flat.match(pattern);
    const name = match?.[1]?.trim().replace(/\s+/g, ' ');
    if (name && name.length >= 2 && !notPerson.has(name)) {
      return { name, confidence: 0.75 };
    }
  }
  return null;
}

/**
 * @param message texto livre do usuário
 * @param now injetável pra teste; usado pela resolução temporal (§ relógio real, nunca
 *   data "sabida" pelo modelo)
 */
export async function resolveOperationalScope(
  message: string,
  now: Date = new Date(),
): Promise<OperationalScope> {
  const flat = stripAccents(message);
  const signals: string[] = [];

  const { matches, ambiguous, tier } = await resolveClientsFromText(message);
  if (tier !== 'none') signals.push(`entidade:${tier}`);

  const temporal = resolveTemporalRange(message, now);
  if (temporal) signals.push(`tempo:${temporal.label}`);

  const globalHits = matched(flat, GLOBAL_MARKERS);
  const comparativeHits = matched(flat, COMPARATIVE_MARKERS);
  const operationalHits = matched(flat, OPERATIONAL_MARKERS);
  const aggregateHits = matched(flat, AGGREGATE_MARKERS);

  if (globalHits.length) signals.push(`global:${globalHits[0]}`);
  if (comparativeHits.length) signals.push(`comparativo:${comparativeHits[0]}`);
  if (operationalHits.length) signals.push(`operacional:${operationalHits[0]}`);
  if (aggregateHits.length) signals.push(`agregado:${aggregateHits[0]}`);

  const briefingHits = matched(flat, BRIEFING_MARKERS);
  if (briefingHits.length) signals.push(`briefing:${briefingHits[0]}`);

  // Pedido de briefing é operacional por si: "me monte um briefing da 3net" não cita
  // task nem prazo, mas precisa de dado de operação pra ser respondido.
  const panoramaHits = matched(flat, PANORAMA_MARKERS);
  if (panoramaHits.length) signals.push(`panorama:${panoramaHits[0]}`);

  const operational =
    operationalHits.length > 0 ||
    aggregateHits.length > 0 ||
    briefingHits.length > 0 ||
    // Pedir o panorama É pedir o estado da operação, mesmo sem dizer "tarefa".
    panoramaHits.length > 0 ||
    temporal !== null;
  const comparative = comparativeHits.length > 0;
  const briefing = briefingHits.length > 0;

  // PRECEDÊNCIA 1 — ambiguidade real primeiro: é a única situação em que perguntar de
  // volta é a atitude CORRETA, e agora dá pra perguntar nomeando os candidatos em vez do
  // genérico "de qual cliente?".
  if (ambiguous.length > 0 && matches.length === 0) {
    return {
      kind: 'AMBIGUOUS',
      clients: [],
      ambiguous,
      temporal,
      operational,
      comparative,
      briefing,
      confidence: 0.9,
      signals,
    };
  }

  // PRECEDÊNCIA 2 — cliente citado explicitamente ganha de marcador global. "todas as
  // tasks da 3net" é escopo de CLIENTE com intenção de completude, não escopo global;
  // tratar como global aqui vazaria dado de outro cliente na resposta.
  if (matches.length >= 2) {
    return {
      kind: 'MULTI_CLIENT',
      clients: matches,
      ambiguous,
      temporal,
      operational,
      comparative,
      briefing,
      confidence: 0.85,
      signals,
    };
  }
  if (matches.length === 1) {
    return {
      kind: 'CLIENT',
      clients: matches,
      ambiguous,
      temporal,
      operational,
      comparative,
      briefing,
      // Match exato/curto é evidência forte; fuzzy é palpite calculado e merece
      // confiança menor pra que o planner possa revisar.
      confidence: tier === 'fuzzy' ? 0.6 : 0.9,
      signals,
    };
  }

  // PRECEDÊNCIA 2b — pergunta sobre PESSOA da equipe: atravessa todos os
  // clientes filtrando por responsável. "quantas tasks estão atribuídas à
  // Jamile?" não é pergunta de cliente nenhum.
  const person = detectPersonMention(flat, { comSinalOperacional: operational });
  if (person) {
    signals.push(`pessoa:${person.name}`);
    return {
      kind: 'PERSON',
      clients: [],
      ambiguous,
      temporal,
      operational: true,
      comparative,
      briefing,
      confidence: person.confidence,
      signals,
      person,
    };
  }

  // PRECEDÊNCIA 3 — nenhum cliente resolvido: aí sim marcadores decidem.
  if (comparativeHits.length > 0) {
    return {
      kind: 'GLOBAL',
      clients: [],
      ambiguous,
      temporal,
      operational,
      comparative: true,
      briefing,
      confidence: 0.85,
      signals,
    };
  }
  if (globalHits.length > 0) {
    return {
      kind: 'GLOBAL',
      clients: [],
      ambiguous,
      temporal,
      operational,
      comparative,
      briefing,
      confidence: 0.8,
      signals,
    };
  }
  // Pergunta agregada/temporal sobre operação, sem cliente e sem marcador explícito:
  // "quantas tasks vencem amanhã?" -> a leitura útil é a operação inteira. Confiança
  // menor de propósito: é inferência, não citação literal.
  // Pergunta OPERACIONAL sem cliente, sem pessoa e sem marcador de tempo
  // ("quais entregas estão mais próximas de atrasar?", "o que depende de
  // aprovação?"): a leitura útil continua sendo a operação inteira.
  //
  // Antes isto caía em NONE, a API não buscava dado nenhum, e o agente pedia
  // "de qual cliente?" — que é exatamente o comportamento que o produto existe
  // para eliminar: quem pergunta sobre a operação não deveria ter que nomear
  // um cliente para receber resposta. Medido no navegador em 16/09/2026.
  if (operational && (aggregateHits.length > 0 || temporal !== null || operationalHits.length > 0 || panoramaHits.length > 0)) {
    return {
      kind: 'GLOBAL',
      clients: [],
      ambiguous,
      temporal,
      operational: true,
      comparative,
      briefing,
      confidence: 0.7,
      signals,
    };
  }

  return {
    kind: 'NONE',
    clients: [],
    ambiguous,
    temporal,
    operational,
    comparative,
    briefing,
    confidence: operational ? 0.4 : 0.9,
    signals,
  };
}
