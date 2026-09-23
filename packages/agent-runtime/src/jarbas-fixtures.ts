import type { CampaignMetricSnapshot } from './jarbas-diagnosis';

/**
 * jarbas-fixtures.ts — laboratório de dados sintéticos offline (§51).
 *
 * Subconjunto deliberado dos ~28 cenários listados na missão: os 10 aqui
 * cobrem cada RAMO distinto da árvore de diagnóstico atual
 * (jarbas-diagnosis.ts) e os casos de disponibilidade/amostra do
 * metric-verifier. Os cenários que a missão pede e NÃO estão aqui (ROAS
 * drop, múltiplas contas/moedas, campanha arquivada/renomeada, nomes
 * duplicados...) dependem de resolução de entidade contra dado real
 * (Meta Ads) que este repositório não tem — ver
 * docs/coordination/JARBAS_SENIOR_HANDOFF.md §4. Nenhum dado aqui é de
 * cliente real; tudo é sintético/anonimizado por construção (números
 * redondos, nomes genéricos).
 */

export const FIXTURE_HEALTHY: CampaignMetricSnapshot = {
  ctrCurrent: 1.2, ctrPrevious: 1.25,
  cpmCurrent: 32, cpmPrevious: 31,
  conversionRateCurrent: 4.1, conversionRatePrevious: 4.0,
  frequencyCurrent: 1.8, frequencyPrevious: 1.7,
  clicksCurrent: 1200, impressionsCurrent: 100_000,
  conversions: 49, spend: 3200,
  daysSinceCreativeChange: 10,
  internallyInconsistent: false,
};

/** CTR collapse + fadiga de criativo (padrão 1 do §67). */
export const FIXTURE_CREATIVE_FATIGUE: CampaignMetricSnapshot = {
  ctrCurrent: 0.8, ctrPrevious: 1.3,
  cpmCurrent: 30, cpmPrevious: 29.5,
  conversionRateCurrent: 3.9, conversionRatePrevious: 4.0,
  frequencyCurrent: 3.4, frequencyPrevious: 2.1,
  clicksCurrent: 640, impressionsCurrent: 80_000,
  conversions: 25, spend: 2400,
  daysSinceCreativeChange: 21,
  internallyInconsistent: false,
};

/** Conversão colapsa com tráfego saudável — problema pós-clique (padrão 2 do §67). */
export const FIXTURE_POST_CLICK_ISSUE: CampaignMetricSnapshot = {
  ctrCurrent: 1.3, ctrPrevious: 1.28,
  cpmCurrent: 31, cpmPrevious: 30.5,
  conversionRateCurrent: 1.1, conversionRatePrevious: 4.2,
  frequencyCurrent: 1.9, frequencyPrevious: 1.85,
  clicksCurrent: 1100, impressionsCurrent: 85_000,
  conversions: 12, spend: 2600,
  daysSinceCreativeChange: 2,
  internallyInconsistent: false,
};

/** Métricas logicamente impossíveis — tracking quebrado (§68). */
export const FIXTURE_TRACKING_FAILURE: CampaignMetricSnapshot = {
  ctrCurrent: 1.1, ctrPrevious: 1.2,
  cpmCurrent: 30, cpmPrevious: 29,
  conversionRateCurrent: 2.0, conversionRatePrevious: 2.1,
  frequencyCurrent: 2.0, frequencyPrevious: 1.9,
  clicksCurrent: 5000, impressionsCurrent: 1000, // clicks > impressions: impossível
  conversions: 5, spend: 400,
  daysSinceCreativeChange: 5,
  internallyInconsistent: true,
};

/** Campanha nova, amostra pequena (§69: "1 lead", pouco gasto, poucas impressões). */
export const FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN: CampaignMetricSnapshot = {
  ctrCurrent: 0.9, ctrPrevious: null,
  cpmCurrent: 40, cpmPrevious: null,
  conversionRateCurrent: 2.0, conversionRatePrevious: null,
  frequencyCurrent: 1.1, frequencyPrevious: null,
  clicksCurrent: 40, impressionsCurrent: 800,
  conversions: 1, spend: 20,
  daysSinceCreativeChange: 1,
  internallyInconsistent: false,
};

export const FIXTURE_ZERO_SPEND: CampaignMetricSnapshot = {
  ctrCurrent: null, ctrPrevious: 1.2,
  cpmCurrent: null, cpmPrevious: 30,
  conversionRateCurrent: null, conversionRatePrevious: 4.0,
  frequencyCurrent: null, frequencyPrevious: 1.8,
  clicksCurrent: 0, impressionsCurrent: 0,
  conversions: 0, spend: 0,
  daysSinceCreativeChange: null,
  internallyInconsistent: false,
};

export const FIXTURE_ZERO_LEADS_HEALTHY_TRAFFIC: CampaignMetricSnapshot = {
  ctrCurrent: 1.3, ctrPrevious: 1.28,
  cpmCurrent: 30, cpmPrevious: 29.8,
  conversionRateCurrent: 0, conversionRatePrevious: 3.8,
  frequencyCurrent: 1.9, frequencyPrevious: 1.85,
  clicksCurrent: 1000, impressionsCurrent: 80_000,
  conversions: 0, spend: 2500,
  daysSinceCreativeChange: 4,
  internallyInconsistent: false,
};

export const FIXTURE_CPM_SPIKE: CampaignMetricSnapshot = {
  ctrCurrent: 1.25, ctrPrevious: 1.22,
  cpmCurrent: 58, cpmPrevious: 30,
  conversionRateCurrent: 3.9, conversionRatePrevious: 4.0,
  frequencyCurrent: 1.9, frequencyPrevious: 1.85,
  clicksCurrent: 1150, impressionsCurrent: 90_000,
  conversions: 44, spend: 5220,
  daysSinceCreativeChange: 8,
  internallyInconsistent: false,
};

export const FIXTURE_RECENT_CREATIVE_CHANGE_TOO_SOON: CampaignMetricSnapshot = {
  ...FIXTURE_CREATIVE_FATIGUE,
  daysSinceCreativeChange: 1, // trocou ontem: não dá pra culpar "fadiga" de um criativo de 1 dia
};

export const FIXTURE_HIGH_FREQUENCY_BUT_CTR_STABLE: CampaignMetricSnapshot = {
  ctrCurrent: 1.24, ctrPrevious: 1.22,
  cpmCurrent: 31, cpmPrevious: 30.5,
  conversionRateCurrent: 4.0, conversionRatePrevious: 4.1,
  frequencyCurrent: 4.8, frequencyPrevious: 2.0,
  clicksCurrent: 1180, impressionsCurrent: 95_000,
  conversions: 47, spend: 3400,
  daysSinceCreativeChange: 15,
  internallyInconsistent: false,
};

export const ALL_FIXTURES: Record<string, CampaignMetricSnapshot> = {
  healthy: FIXTURE_HEALTHY,
  creativeFatigue: FIXTURE_CREATIVE_FATIGUE,
  postClickIssue: FIXTURE_POST_CLICK_ISSUE,
  trackingFailure: FIXTURE_TRACKING_FAILURE,
  lowSampleNewCampaign: FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN,
  zeroSpend: FIXTURE_ZERO_SPEND,
  zeroLeadsHealthyTraffic: FIXTURE_ZERO_LEADS_HEALTHY_TRAFFIC,
  cpmSpike: FIXTURE_CPM_SPIKE,
  recentCreativeChangeTooSoon: FIXTURE_RECENT_CREATIVE_CHANGE_TOO_SOON,
  highFrequencyButCtrStable: FIXTURE_HIGH_FREQUENCY_BUT_CTR_STABLE,
};
