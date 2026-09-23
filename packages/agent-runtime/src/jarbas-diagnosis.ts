import { isSampleTooSmall } from './metric-verifier';

/**
 * jarbas-diagnosis.ts — árvore de diagnóstico determinística (§18/§67-69).
 *
 * Regra de ouro do mission brief: "JARBAS MUST NEVER BE THE SOURCE OF TRUTH
 * FOR NUMBERS... code verifies." Este arquivo é código, não LLM — recebe um
 * snapshot de métricas já calculado (via metric-verifier) e devolve
 * observações/hipóteses/recomendações RASTREÁVEIS a essas métricas, nunca
 * texto livre inventado. O LLM externo (Jarbas de verdade) pode narrar isto
 * em linguagem natural depois; a CLASSIFICAÇÃO fato-vs-hipótese e a
 * SELEÇÃO de qual hipótese é plausível vêm daqui, determinística.
 *
 * Cobre um SUBCONJUNTO deliberado dos cenários do §51/§67-69 — os mais
 * distintos em causa raiz, não os 28 listados inteiros (ver
 * docs/coordination/JARBAS_SENIOR_HANDOFF.md pela lista completa e o
 * porquê do corte).
 */

export interface CampaignMetricSnapshot {
  ctrCurrent: number | null;
  ctrPrevious: number | null;
  cpmCurrent: number | null;
  cpmPrevious: number | null;
  conversionRateCurrent: number | null;
  conversionRatePrevious: number | null;
  frequencyCurrent: number | null;
  frequencyPrevious: number | null;
  clicksCurrent: number | null;
  impressionsCurrent: number | null;
  conversions: number;
  spend: number;
  daysSinceCreativeChange: number | null;
  /** Impossibilidade lógica nos números crus (clicks > impressions etc.) — sinal de tracking quebrado. */
  internallyInconsistent: boolean;
}

export type DiagnosisClass =
  | 'healthy'
  | 'creative_fatigue_hypothesis'
  | 'post_click_issue_hypothesis'
  | 'tracking_problem'
  | 'insufficient_sample';

export interface DiagnosisResult {
  class: DiagnosisClass;
  observations: string[];
  hypotheses: string[];
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  recommendConfidentAction: boolean;
}

/**
 * Limiares por escala de métrica — CTR/conversão vivem na casa de 0-5%,
 * CPM vive em dezenas de moeda, frequência em unidades. Um único limiar em
 * pontos percentuais pra tudo (primeira versão deste arquivo) marcava uma
 * queda real de CTR de 1.3%->0.8% como "estável", porque 0.5pp parecia
 * pequeno na escala de CPM. Cada métrica compara contra o limiar certo pra
 * ela.
 */
function caiu(current: number | null, previous: number | null, limiarAbs: number): boolean {
  if (current === null || previous === null) return false;
  return previous - current >= limiarAbs;
}

function estavelAbs(current: number | null, previous: number | null, limiarAbs: number): boolean {
  if (current === null || previous === null) return false;
  return Math.abs(current - previous) < limiarAbs;
}

/** CPM compara por variação RELATIVA (%), porque o valor absoluto varia demais entre contas/moedas. */
function estavelRelativo(current: number | null, previous: number | null, limiarRelativo: number): boolean {
  if (current === null || previous === null || previous === 0) return false;
  return Math.abs(current - previous) / previous < limiarRelativo;
}

function subiu(current: number | null, previous: number | null, limiarAbs: number): boolean {
  if (current === null || previous === null) return false;
  return current - previous >= limiarAbs;
}

const LIMIAR_CTR_PP = 0.3;
const LIMIAR_CONVERSAO_PP = 1;
const LIMIAR_FREQUENCIA = 0.5;
const LIMIAR_CPM_RELATIVO = 0.15;

/**
 * Diagnostica um snapshot. Ordem de checagem é a prioridade de causa:
 * tracking quebrado invalida qualquer conclusão de performance (§68);
 * amostra pequena invalida qualquer recomendação confiante (§69/§19);
 * só depois disso os dois padrões de queda (§67) são avaliados.
 */
export function diagnoseCampaignSnapshot(m: CampaignMetricSnapshot): DiagnosisResult {
  if (m.internallyInconsistent) {
    return {
      class: 'tracking_problem',
      observations: ['os números da campanha são internamente inconsistentes (ex.: cliques acima de impressões, ou valor negativo onde não deveria existir)'],
      hypotheses: [],
      confidence: 'insufficient_data',
      recommendConfidentAction: false,
    };
  }

  if (isSampleTooSmall({ conversions: m.conversions, spend: m.spend, impressions: m.impressionsCurrent ?? undefined })) {
    return {
      class: 'insufficient_sample',
      observations: [`amostra pequena: ${m.conversions} conversão(ões), R$${m.spend} de gasto no período`],
      hypotheses: [],
      confidence: 'low',
      recommendConfidentAction: false,
    };
  }

  const ctrCaiu = caiu(m.ctrCurrent, m.ctrPrevious, LIMIAR_CTR_PP);
  const cpmEstavel = estavelRelativo(m.cpmCurrent, m.cpmPrevious, LIMIAR_CPM_RELATIVO);
  const conversaoEstavel = estavelAbs(m.conversionRateCurrent, m.conversionRatePrevious, LIMIAR_CONVERSAO_PP);
  const conversaoCaiu = caiu(m.conversionRateCurrent, m.conversionRatePrevious, LIMIAR_CONVERSAO_PP);
  const frequenciaSubiu = subiu(m.frequencyCurrent, m.frequencyPrevious, LIMIAR_FREQUENCIA);
  const clicksEstavel = m.clicksCurrent !== null; // sem "previous" de clicks no snapshot mínimo — checagem qualitativa só.

  // Só entram como OBSERVAÇÃO os sinais que pedem atenção (queda/subida
  // relevante); estabilidade de CPM/conversão só aparece como contexto
  // dentro do texto da hipótese, não como ruído solto numa campanha
  // saudável (uma CPM parada não é notícia por si só).
  const observations: string[] = [];
  if (ctrCaiu) observations.push(`CTR caiu (${m.ctrPrevious}% -> ${m.ctrCurrent}%)`);
  if (frequenciaSubiu) observations.push(`frequência subiu (${m.frequencyPrevious} -> ${m.frequencyCurrent})`);
  if (conversaoCaiu) observations.push(`conversão pós-clique caiu (${m.conversionRatePrevious}% -> ${m.conversionRateCurrent}%)`);

  // Padrão 1 (§67, primeiro caso): CTR caiu + CPM estável + conversão estável
  // + frequência subiu + criativo sem troca recente -> hipótese de fadiga,
  // NUNCA certeza causal.
  if (ctrCaiu && cpmEstavel && conversaoEstavel && frequenciaSubiu && (m.daysSinceCreativeChange ?? 999) > 3) {
    return {
      class: 'creative_fatigue_hypothesis',
      observations,
      hypotheses: ['fadiga de criativo (ou perda de fit com a audiência) pode estar contribuindo — frequência subindo e CTR caindo sem mudança de custo de mídia é consistente com isso, mas não é prova de causa'],
      confidence: 'medium',
      recommendConfidentAction: false,
    };
  }

  // Padrão 2 (§67, segundo caso): CTR/CPM/clicks estáveis, conversão colapsa
  // -> NÃO culpar criativo primeiro; investigar pós-clique/tracking/vendas.
  if (!ctrCaiu && cpmEstavel && clicksEstavel && conversaoCaiu) {
    return {
      class: 'post_click_issue_hypothesis',
      observations,
      hypotheses: ['tráfego e custo de mídia continuam saudáveis (CTR e CPM estáveis) enquanto a conversão pós-clique caiu — a causa mais provável está DEPOIS do clique (landing page, formulário, tracking ou processo comercial), não no criativo'],
      confidence: 'medium',
      recommendConfidentAction: false,
    };
  }

  if (observations.length === 0) {
    return {
      class: 'healthy',
      observations: ['métricas dentro da faixa recente, sem variação relevante'],
      hypotheses: [],
      confidence: 'high',
      recommendConfidentAction: false,
    };
  }

  return {
    class: 'healthy',
    observations,
    hypotheses: [],
    confidence: 'medium',
    recommendConfidentAction: false,
  };
}
