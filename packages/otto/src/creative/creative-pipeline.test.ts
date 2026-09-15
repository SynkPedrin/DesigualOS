import { describe, expect, it } from 'vitest';
import { runCreativePipeline, type CreativeGenerator } from './creative-pipeline';
import type { ResearchProvider } from '../research/research';
const provider: ResearchProvider = { search: async () => [{ url: 'https://g1.globo.com/x', snippet: 'tendência atual' }] };
const noResearch: ResearchProvider = { search: async () => { throw new Error('não deveria'); } };
describe('runCreativePipeline (§60, §66)', () => {
  it('copy específica passa sem revisão', async () => {
    const gen: CreativeGenerator = { generate: async () => ({ copy: 'A 3Net entrega 850MB por R$89,99 em Araçatuba' }) };
    const r = await runCreativePipeline({ generator: gen, researchProvider: noResearch }, { clientId: '3net', objective: 'post', offer: 'x', audience: 'y' }, { brandTerms: ['3Net'] });
    expect(r.qualityPassed).toBe(true); expect(r.revisions).toBe(0);
  });
  it('copy genérica dispara auto-revisão (§66)', async () => {
    let call = 0;
    const gen: CreativeGenerator = { generate: async ({ revisionNote }) => { call += 1; if (call === 1) { expect(revisionNote).toBeUndefined(); return { copy: 'Transforme seu negócio e leve ao próximo nível' }; } expect(revisionNote).toBeDefined(); return { copy: 'A 3Net entrega 850MB por R$89,99 em Araçatuba' }; } };
    const r = await runCreativePipeline({ generator: gen, researchProvider: noResearch }, { clientId: '3net', objective: 'post', offer: 'x', audience: 'y' }, { brandTerms: ['3Net'] });
    expect(r.qualityPassed).toBe(true); expect(r.revisions).toBeGreaterThanOrEqual(1); expect(call).toBe(2);
  });
  it('genérica persistente NÃO entrega como aprovada', async () => {
    const gen: CreativeGenerator = { generate: async () => ({ copy: 'Transforme seu negócio, solução completa, próximo nível' }) };
    const r = await runCreativePipeline({ generator: gen, researchProvider: noResearch }, { clientId: 'c', objective: 'post', offer: 'x', audience: 'y' }, { maxRevisions: 2 });
    expect(r.qualityPassed).toBe(false); expect(r.revisions).toBe(2);
  });
  it('objetivo de dado atual dispara pesquisa no pipeline', async () => {
    const gen: CreativeGenerator = { generate: async ({ research }) => ({ copy: `A 3Net e as ${research.findings.length} tendências atuais de 2026 em Araçatuba` }) };
    const r = await runCreativePipeline({ generator: gen, researchProvider: provider }, { clientId: '3net', objective: 'campanha sobre tendências atuais de mercado', offer: 'x', audience: 'y' }, { brandTerms: ['3Net'] });
    expect(r.research.performed).toBe(true);
  });
});
