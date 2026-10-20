import { describe, expect, it } from 'vitest';
import { googleEffectiveStatus, normalizeGoogleAd, normalizeGoogleAdGroup, normalizeGoogleCampaign, normalizeGoogleInsight } from './google-media-graph';

describe('Google Ads → formato do Media Command Center', () => {
  it('campanha: orçamento em micros vira unidade e status vira vocabulário comum', () => {
    const c = normalizeGoogleCampaign({ campaign: { id: '11', name: 'Pesquisa', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '50000000' } });
    expect(c).toMatchObject({ level: 'campaign', id: '11', dailyBudget: 50, effectiveStatus: 'ACTIVE', objective: 'SEARCH', parentId: null });
  });
  it('grupo de anúncios aponta para a campanha pelo resource name', () => {
    expect(normalizeGoogleAdGroup({ adGroup: { id: '22', name: 'G1', status: 'PAUSED', campaign: 'customers/9/campaigns/11' } })).toMatchObject({ level: 'adset', parentId: '11', effectiveStatus: 'PAUSED' });
  });
  it('anúncio de pesquisa: o criativo é o texto, sem miniatura inventada', () => {
    const a = normalizeGoogleAd({ adGroupAd: { status: 'ENABLED', adGroup: 'customers/9/adGroups/22', policySummary: { approvalStatus: 'APPROVED' }, ad: { id: '33', finalUrls: ['https://x.com'], responsiveSearchAd: { headlines: [{ text: 'H1' }, { text: 'H2' }], descriptions: [{ text: 'D1' }] } } } });
    expect(a.creative).toMatchObject({ title: 'H1 | H2', body: 'D1', linkUrl: 'https://x.com', thumbnailUrl: null, imageUrl: null });
    expect(a.parentId).toBe('22');
    expect(a.effectiveStatus).toBe('ACTIVE');
  });
  it('anúncio reprovado aparece como reprovado, mesmo habilitado', () => {
    expect(googleEffectiveStatus('ENABLED', 'DISAPPROVED')).toBe('DISAPPROVED');
    expect(googleEffectiveStatus('ENABLED', 'APPROVED_LIMITED')).toBe('WITH_ISSUES');
  });
  it('insight: custo em micros, sem alcance nem frequência, resultado = conversões', () => {
    const i = normalizeGoogleInsight('campaign', { segments: { date: '2026-10-01' }, campaign: { id: '11' }, metrics: { costMicros: '12340000', impressions: '1000', clicks: '50', conversions: 2.5, conversionsValue: 300 } });
    expect(i).toMatchObject({ entityId: '11', day: '2026-10-01', spend: 12.34, impressions: 1000, clicks: 50, results: 2.5, resultsKind: 'google_conversions', reach: null, frequency: null, conversionValue: 300 });
  });
  it('linha sem data ou id é descartada', () => {
    expect(normalizeGoogleInsight('campaign', { campaign: { id: '1' }, metrics: {} })).toBeNull();
  });
});
