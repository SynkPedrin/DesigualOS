import { describe, expect, it } from 'vitest';
import { classifySourceQuality, synthesizeFindings, researchToEvidence, runResearch, type ResearchProvider } from './research';
describe('research: qualidade de fonte (§58)', () => {
  it('classifica gov/edu/reputable/community/unknown', () => {
    expect(classifySourceQuality('https://www.gov.br/algo')).toBe('official');
    expect(classifySourceQuality('https://mit.edu/x')).toBe('primary');
    expect(classifySourceQuality('https://g1.globo.com/n')).toBe('reputable');
    expect(classifySourceQuality('https://reddit.com/r/x')).toBe('community');
    expect(classifySourceQuality('https://sitequalquer123.net/a')).toBe('unknown');
  });
});
describe('research: síntese multi-fonte (§57)', () => {
  it('dedup por veículo, ordena por qualidade, não usa só a primeira', () => {
    const { findings, singleSource } = synthesizeFindings([
      { url: 'https://reddit.com/a', snippet: 'boato' },
      { url: 'https://g1.globo.com/b', snippet: 'dado' },
      { url: 'https://g1.globo.com/c', snippet: 'dup' },
      { url: 'https://gov.br/d', snippet: 'oficial' }]);
    expect(findings[0]!.quality).toBe('official');
    expect(findings.filter((f) => f.url.includes('g1.globo.com'))).toHaveLength(1);
    expect(singleSource).toBe(false);
  });
  it('achado factual vira evidence (§59)', () => {
    const ev = researchToEvidence([{ claim: 'x', url: 'https://gov.br/a', title: null, quality: 'official' }]);
    expect(ev[0]!.type).toBe('web'); expect(ev[0]!.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
describe('runResearch (§67)', () => {
  const provider: ResearchProvider = { search: async () => [{ url: 'https://g1.globo.com/x', snippet: 'tendência 2026' }] };
  it('não pesquisa quando shouldResearch=false', async () => { const r = await runResearch(provider, 'q', { shouldResearch: false }); expect(r.performed).toBe(false); });
  it('pesquisa quando true', async () => { const r = await runResearch(provider, 'q', { shouldResearch: true }); expect(r.performed).toBe(true); expect(r.evidence.length).toBeGreaterThan(0); });
  it('não lança se o provedor falhar', async () => { const bad: ResearchProvider = { search: async () => { throw new Error('x'); } }; expect((await runResearch(bad, 'q', { shouldResearch: true })).performed).toBe(false); });
});
