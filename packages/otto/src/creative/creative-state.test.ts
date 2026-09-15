import { describe, expect, it } from 'vitest';
import { assembleCreativeState, assessCreativeReadiness } from './creative-state';
describe('CreativeState + gap detection (§52, §54)', () => {
  it('sem marca/oferta/público/histórico acusa lacunas', () => {
    const r = assessCreativeReadiness(assembleCreativeState({ clientId: 'c1', objective: 'criar post' }));
    expect(r.gaps).toContain('brand_context'); expect(r.gaps).toContain('offer');
    expect(r.gaps).toContain('audience'); expect(r.gaps).toContain('creative_history');
  });
  it('com DNA/oferta/público/histórico não acusa essas lacunas', () => {
    const r = assessCreativeReadiness(assembleCreativeState({ clientId: 'c1', objective: 'post de vendas', offer: 'internet', audience: 'famílias',
      dna: { clientId: 'c1', palette: ['#000'], typography: ['Inter'], toneOfVoice: 'direto', approvedPatterns: ['clean'], rejectedPatterns: [], aestheticDirection: 'minimal', confidence: 0.8, feedbackCount: 10 },
      approvedCreatives: [{ id: 'a1', summary: 'post', verdict: 'approved' }] }));
    expect(r.gaps).not.toContain('brand_context'); expect(r.gaps).not.toContain('offer'); expect(r.gaps).not.toContain('creative_history');
  });
  it('objetivo que pede dado atual → requiresResearch', () => {
    expect(assessCreativeReadiness(assembleCreativeState({ clientId: 'c1', objective: 'campanha sobre tendências atuais de mercado' })).requiresResearch).toBe(true);
  });
  it('objetivo institucional → não pesquisa', () => {
    expect(assessCreativeReadiness(assembleCreativeState({ clientId: 'c1', objective: 'post institucional' })).requiresResearch).toBe(false);
  });
});
