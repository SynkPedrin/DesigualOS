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
  /** Nenhum sinal de escopo: provavelmente não é pergunta operacional. */
  | 'NONE';

export interface OperationalScope {
  kind: ScopeKind;
  clients: ClientMatch[];
  ambiguous: Array<{ term: string; candidates: ClientMatch[] }>;
  temporal: TemporalRange | null;
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
  const operational = operationalHits.length > 0 || aggregateHits.length > 0 || briefingHits.length > 0 || temporal !== null;
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
  if (operational && (aggregateHits.length > 0 || temporal !== null)) {
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
