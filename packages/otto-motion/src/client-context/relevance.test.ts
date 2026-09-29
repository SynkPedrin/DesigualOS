import { describe, expect, it } from 'vitest';
import { buildRelevanceTerms, rankAssets, scoreAsset, tokenize } from './relevance.js';
import { selectAssets } from './asset-index.js';
import type { MotionAsset } from './types.js';

/**
 * Os prompts abaixo são os REAIS do acervo de produção do cliente
 * "John Deere" (lidos do banco em 24/09/2026). Dos 25 assets, 13 são da marca
 * e 10 são geração de teste de outro briefing gravada sob esse cliente.
 *
 * Este é o teste que existe por causa de um defeito medido: a seleção por
 * recência trazia 6 fotos erradas em 8.
 */
function asset(prompt: string, filename = `STU-${Math.random().toString(36).slice(2, 10)}.png`): MotionAsset {
  return {
    kind: 'image',
    sourceUrl: `https://storage/${filename}`,
    filename,
    contentType: 'image/png',
    origin: 'studio_assets',
    prompt,
  };
}

const ACERVO_REAL: MotionAsset[] = [
  asset('Cria uma imagem de um trator e,m uma plantação ao lado de uma colhedeira usando as imagens'),
  asset('An ultra high end professional executive portrait photograph of the referenced man, wearing a suit'),
  asset('An ultra high end professional executive portrait photograph of the referenced man, wearing a suit'),
  asset('A real photograph of a family of three, father, mother and a young child walking'),
  asset('A real photograph of a family of three, father, mother and a young child walking'),
  asset('A farmer and a John Deere dealership technician shaking hands in front of a real tractor'),
  asset('A real John Deere 7M tractor driving past the entrance of a residential condominium'),
  asset('A real John Deere tractor driving down a dusty rural road in Brazil at sunset'),
  asset('A father and his young son standing together beside a real John Deere 7M tractor'),
  asset('A real John Deere sugarcane harvester parked inside an industrial workshop'),
  asset('A real John Deere tractor plowing a farm field during golden hour, editorial documentary'),
];

const TERMOS = buildRelevanceTerms({
  clientName: 'John Deere',
  briefText: 'Campanha de setembro, maquinário agrícola, feirão de seminovos',
});

describe('relevância no acervo real do John Deere (§8)', () => {
  it('foto da marca pontua; retrato executivo não pontua nada', () => {
    expect(scoreAsset(ACERVO_REAL[7]!, TERMOS)).toBeGreaterThan(0);
    expect(scoreAsset(ACERVO_REAL[1]!, TERMOS)).toBe(0);
  });

  it('o topo do ranking é todo da marca', () => {
    const { ranked, hasSignal } = rankAssets(ACERVO_REAL, TERMOS);
    expect(hasSignal).toBe(true);
    for (const item of ranked.slice(0, 5)) {
      expect(item.asset.prompt?.toLowerCase()).toContain('john deere');
    }
  });

  it('a seleção final NÃO leva o Mercedes nem a família — o defeito que motivou isto', () => {
    const { selected, skipped } = selectAssets(ACERVO_REAL, { logos: 2, images: 8, videos: 3, references: 6 }, TERMOS);
    for (const item of selected) {
      expect(item.prompt).not.toMatch(/executive portrait|family of three/i);
    }
    expect(skipped.some((s) => s.reason.includes('não casa'))).toBe(true);
  });

  it('sem termos, volta ao comportamento antigo: nada é descartado por relevância', () => {
    const { selected, usedRelevance } = selectAssets(ACERVO_REAL);
    expect(usedRelevance).toBe(false);
    expect(selected.length).toBe(8);
  });

  it('acervo que pontua zero inteiro não vira peça sem foto', () => {
    const neutro = [asset('imagem qualquer'), asset('outra imagem')];
    const { selected, usedRelevance } = selectAssets(neutro, undefined, buildRelevanceTerms({ clientName: 'Zzz Ltda' }));
    expect(usedRelevance).toBe(false);
    expect(selected).toHaveLength(2);
  });

  it('a referência que a pessoa anexou passa por cima da relevância (§8, prioridade 1)', () => {
    const anexo: MotionAsset = {
      kind: 'reference',
      sourceUrl: 'https://storage/quero-assim.png',
      filename: 'quero-assim.png',
      contentType: 'image/png',
      origin: 'anexo do turno',
      prompt: null,
    };
    const { selected } = selectAssets([...ACERVO_REAL, anexo], undefined, TERMOS);
    expect(selected[0]?.filename).toBe('quero-assim.png');
  });
});

describe('tokenize', () => {
  it('tira acento, caixa e palavra vazia', () => {
    expect(tokenize('Maquinário Agrícola de Ponta')).toEqual(['maquinario', 'agricola', 'ponta']);
  });

  it('marca de duas palavras vira dois termos', () => {
    expect(buildRelevanceTerms({ clientName: 'John Deere' }).brand).toEqual(['john', 'deere']);
  });
});
