import { describe, expect, it } from 'vitest';
import { diagnoseCampaignSnapshot, generateRecommendation } from './jarbas-diagnosis';
import {
  FIXTURE_CPM_SPIKE,
  FIXTURE_CREATIVE_FATIGUE,
  FIXTURE_HEALTHY,
  FIXTURE_HIGH_FREQUENCY_BUT_CTR_STABLE,
  FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN,
  FIXTURE_POST_CLICK_ISSUE,
  FIXTURE_RECENT_CREATIVE_CHANGE_TOO_SOON,
  FIXTURE_TRACKING_FAILURE,
  FIXTURE_ZERO_LEADS_HEALTHY_TRAFFIC,
  FIXTURE_ZERO_SPEND,
} from './jarbas-fixtures';

/**
 * Cenários exigidos literalmente pela missão sênior (§67-69), mais os
 * outros fixtures do laboratório (§51 subconjunto). Toda saída aqui é
 * FATO/HIPÓTESE rastreável às métricas de entrada — nunca "o modelo achou".
 */

describe('diagnoseCampaignSnapshot — padrão 1 do §67: CTR caiu + CPM estável + conversão estável + frequência subiu', () => {
  it('gera HIPÓTESE de fadiga de criativo, nunca certeza causal', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_CREATIVE_FATIGUE);
    expect(r.class).toBe('creative_fatigue_hypothesis');
    expect(r.hypotheses[0]).toMatch(/pode estar contribuindo/);
    expect(r.hypotheses[0]).not.toMatch(/causou|é a causa/i);
    expect(r.recommendConfidentAction).toBe(false);
  });

  it('criativo trocado ONTEM não sustenta hipótese de fadiga (fadiga precisa de tempo de exposição)', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_RECENT_CREATIVE_CHANGE_TOO_SOON);
    expect(r.class).not.toBe('creative_fatigue_hypothesis');
  });
});

describe('diagnoseCampaignSnapshot — padrão 2 do §67: CTR/CPM/clicks estáveis, conversão colapsa', () => {
  it('NÃO culpa o criativo primeiro — hipótese vai pra pós-clique/tracking/vendas', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_POST_CLICK_ISSUE);
    expect(r.class).toBe('post_click_issue_hypothesis');
    expect(r.hypotheses[0]).toMatch(/depois do clique|landing|tracking|comercial/i);
    expect(r.hypotheses[0]).not.toMatch(/criativo é a causa/i);
  });
});

describe('diagnoseCampaignSnapshot — tracking quebrado (§68)', () => {
  it('métricas internamente inconsistentes viram TRACKING PROBLEM, sem diagnóstico de performance confiante', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_TRACKING_FAILURE);
    expect(r.class).toBe('tracking_problem');
    expect(r.confidence).toBe('insufficient_data');
    expect(r.recommendConfidentAction).toBe(false);
    expect(r.hypotheses).toEqual([]);
  });
});

describe('diagnoseCampaignSnapshot — amostra pequena (§69)', () => {
  it('campanha nova com 1 conversão e R$20 de gasto -> LOW CONFIDENCE, sem recomendação agressiva', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN);
    expect(r.class).toBe('insufficient_sample');
    expect(r.confidence).toBe('low');
    expect(r.recommendConfidentAction).toBe(false);
  });

  it('gasto zero também cai em amostra insuficiente, nunca é lido como "campanha ruim"', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_ZERO_SPEND);
    expect(r.class).toBe('insufficient_sample');
  });
});

describe('diagnoseCampaignSnapshot — saudável e outros fixtures do laboratório', () => {
  it('campanha saudável não gera hipótese nenhuma', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_HEALTHY);
    expect(r.class).toBe('healthy');
    expect(r.hypotheses).toEqual([]);
    expect(r.confidence).toBe('high');
  });

  it('CPM spike sozinho (sem queda de CTR/conversão) não dispara os padrões de queda — fica como observação', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_CPM_SPIKE);
    expect(['healthy']).toContain(r.class);
    expect(r.observations.length).toBeGreaterThan(0);
  });

  it('frequência alta com CTR estável não é lida como fadiga (CTR não caiu de verdade)', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_HIGH_FREQUENCY_BUT_CTR_STABLE);
    expect(r.class).not.toBe('creative_fatigue_hypothesis');
  });

  it('zero leads com tráfego saudável cai em amostra insuficiente (0 conversões < piso) — limitação conhecida, documentada', () => {
    const r = diagnoseCampaignSnapshot(FIXTURE_ZERO_LEADS_HEALTHY_TRAFFIC);
    expect(r.class).toBe('insufficient_sample');
  });
});

/**
 * §11/§41 — cada classe de diagnóstico gera uma recomendação ESPECÍFICA,
 * nunca o genérico "teste mais criativos" pra tudo.
 */
describe('generateRecommendation — nunca genérica, sempre rastreável (§11/§41)', () => {
  it('fadiga de criativo recomenda REVIEW_CREATIVE, nunca CHECK_TRACKING', () => {
    const diag = diagnoseCampaignSnapshot(FIXTURE_CREATIVE_FATIGUE);
    const rec = generateRecommendation(diag);
    expect(rec.type).toBe('review_creative');
    expect(rec.evidenceRefs).toEqual(diag.observations);
  });

  it('problema pós-clique recomenda CHECK_POST_CLICK, NÃO revisão de criativo (§42)', () => {
    const diag = diagnoseCampaignSnapshot(FIXTURE_POST_CLICK_ISSUE);
    const rec = generateRecommendation(diag);
    expect(rec.type).toBe('check_post_click');
    expect(rec.type).not.toBe('review_creative');
  });

  it('tracking quebrado recomenda CHECK_TRACKING com prioridade alta, nunca otimização', () => {
    const diag = diagnoseCampaignSnapshot(FIXTURE_TRACKING_FAILURE);
    const rec = generateRecommendation(diag);
    expect(rec.type).toBe('check_tracking');
    expect(rec.priority).toBe('high');
    expect(rec.requiresApproval).toBe(false); // é diagnóstico, não mutação
  });

  it('amostra pequena recomenda COLLECT_MORE_DATA, nunca uma recomendação agressiva', () => {
    const diag = diagnoseCampaignSnapshot(FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN);
    const rec = generateRecommendation(diag);
    expect(rec.type).toBe('collect_more_data');
  });

  it('campanha saudável recomenda OBSERVE', () => {
    const diag = diagnoseCampaignSnapshot(FIXTURE_HEALTHY);
    const rec = generateRecommendation(diag);
    expect(rec.type).toBe('observe');
  });

  it('nenhuma recomendação desta árvore jamais exige aprovação (diagnóstico não é mutação)', () => {
    for (const fixture of [FIXTURE_HEALTHY, FIXTURE_CREATIVE_FATIGUE, FIXTURE_POST_CLICK_ISSUE, FIXTURE_TRACKING_FAILURE, FIXTURE_LOW_SAMPLE_NEW_CAMPAIGN]) {
      expect(generateRecommendation(diagnoseCampaignSnapshot(fixture)).requiresApproval).toBe(false);
    }
  });
});
