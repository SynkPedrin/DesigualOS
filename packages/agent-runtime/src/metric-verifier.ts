/**
 * metric-verifier.ts — aritmética de métrica em CÓDIGO, nunca no LLM (§4/§29).
 *
 * Puro e determinístico, igual grounding.ts: nada de LLM, nada de rede.
 * Existe pra checar uma alegação numérica do Jarbas ("CPL subiu 23%")
 * contra os números REAIS de origem, quando eles existem — hoje o serviço
 * externo do Jarbas não devolve número estruturado nenhum (ver
 * docs/coordination/JARBAS_SENIOR_HANDOFF.md), então nada aqui roda em
 * produção ainda. Construído agora pra existir, testado com fixture
 * sintética, pronto pro dia em que o serviço externo (ou uma camada local)
 * começar a mandar `MetricFact`s de verdade.
 */

const TOLERANCIA_PADRAO_PP = 0.5;

export interface VerificationResult {
  ok: boolean;
  expected: number | null;
  claimed: number;
  reason?: string;
}

/**
 * Variação percentual RELATIVA entre dois valores: (atual - anterior) / anterior * 100.
 * Denominador inválido (anterior <= 0, ou não-finito) nunca vira número — a
 * regra §5 é explícita: "não calcular variação percentual quando o
 * denominador é inválido sem tratamento apropriado". `null` É o tratamento.
 */
export function computeChangePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Checa uma alegação de variação percentual RELATIVA contra os dois valores de origem. */
export function verifyClaimedChangePercent(
  claimedPercent: number,
  current: number,
  previous: number,
  toleranceAbs = TOLERANCIA_PADRAO_PP,
): VerificationResult {
  const expected = computeChangePercent(current, previous);
  if (expected === null) {
    return { ok: false, expected: null, claimed: claimedPercent, reason: 'denominador inválido (valor anterior é zero ou não numérico) — variação percentual não é calculável' };
  }
  const ok = Math.abs(expected - claimedPercent) <= toleranceAbs;
  return ok
    ? { ok: true, expected, claimed: claimedPercent }
    : { ok: false, expected, claimed: claimedPercent, reason: `esperado ${expected.toFixed(2)}%, alegado ${claimedPercent}% — fora da tolerância de ${toleranceAbs}pp` };
}

/**
 * DELTA EM PONTOS PERCENTUAIS entre duas taxas já em percentual (ex.: CTR
 * 10% -> 12% = +2pp). Nunca confundir com verifyClaimedChangePercent, que é
 * a variação RELATIVA da mesma dupla (10% -> 12% = +20% relativo). São
 * respostas diferentes pra perguntas diferentes — a regra
 * "JARBAS — UNIT/CURRENCY" existe exatamente pra essa confusão.
 */
export function percentagePointsDelta(currentPercent: number, previousPercent: number): number | null {
  if (!Number.isFinite(currentPercent) || !Number.isFinite(previousPercent)) return null;
  return currentPercent - previousPercent;
}

/** Checa uma alegação de variação em PONTOS PERCENTUAIS (não confundir com % relativo). */
export function verifyClaimedPercentagePoints(
  claimedPp: number,
  currentPercent: number,
  previousPercent: number,
  toleranceAbs = TOLERANCIA_PADRAO_PP,
): VerificationResult {
  const expected = percentagePointsDelta(currentPercent, previousPercent);
  if (expected === null) {
    return { ok: false, expected: null, claimed: claimedPp, reason: 'valores não numéricos — delta em pontos percentuais não é calculável' };
  }
  const ok = Math.abs(expected - claimedPp) <= toleranceAbs;
  return ok
    ? { ok: true, expected, claimed: claimedPp }
    : { ok: false, expected, claimed: claimedPp, reason: `esperado ${expected.toFixed(2)}pp, alegado ${claimedPp}pp — fora da tolerância de ${toleranceAbs}pp` };
}

/**
 * Checa uma taxa alegada (CTR, taxa de conversão...) contra numerador e
 * denominador reais — ex.: "CTR de 10%" com clicks=100, impressions=1000.
 * Denominador <= 0 nunca produz uma taxa — motivo explícito no resultado,
 * nunca um número inventado.
 */
export function verifyClaimedRatio(
  claimedPercent: number,
  numerator: number,
  denominator: number,
  toleranceAbs = TOLERANCIA_PADRAO_PP,
): VerificationResult {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return { ok: false, expected: null, claimed: claimedPercent, reason: 'denominador inválido (zero, negativo ou não numérico) — taxa não é calculável' };
  }
  const expected = (numerator / denominator) * 100;
  const ok = Math.abs(expected - claimedPercent) <= toleranceAbs;
  return ok
    ? { ok: true, expected, claimed: claimedPercent }
    : { ok: false, expected, claimed: claimedPercent, reason: `esperado ${expected.toFixed(2)}%, alegado ${claimedPercent}% — fora da tolerância de ${toleranceAbs}pp` };
}

export type MetricAvailability = 'available' | 'null' | 'missing' | 'not_tracked' | 'not_applicable' | 'delayed';

/**
 * Classifica a disponibilidade de um valor bruto ANTES de qualquer cálculo
 * — regra §5: 0 (valor real), NULL (fonte devolveu nulo) e MISSING (campo
 * nem veio) são três coisas diferentes, e nenhuma delas pode virar 0
 * silenciosamente rio abaixo.
 */
export function classifyMetricAvailability(params: {
  raw: number | null | undefined;
  fieldPresent: boolean;
  tracked: boolean;
  delayed?: boolean;
}): MetricAvailability {
  if (!params.tracked) return 'not_tracked';
  if (params.delayed) return 'delayed';
  if (!params.fieldPresent) return 'missing';
  if (params.raw === null) return 'null';
  return 'available';
}

/**
 * Amostra insuficiente pra decisão de alta confiança (§13). Limiares
 * conservadores e HEURÍSTICOS — não calibrados contra dado real de
 * produção (nenhum existe localmente ainda); existem pra impedir "3 leads,
 * CPL disparou 200%" de virar recomendação confiante, não pra ser a
 * palavra final sobre estatística.
 */
export function isSampleTooSmall(params: { conversions?: number; spend?: number; impressions?: number }): boolean {
  if (params.conversions !== undefined && params.conversions < 10) return true;
  if (params.spend !== undefined && params.spend < 50) return true;
  if (params.impressions !== undefined && params.impressions < 1000) return true;
  return false;
}
