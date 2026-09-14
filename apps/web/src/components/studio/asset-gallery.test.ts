import { describe, expect, it } from 'vitest';
import { groupAssets } from './asset-gallery';
import type { StudioAsset } from '@/lib/api/contracts';

function makeAsset(overrides: Partial<StudioAsset> & Pick<StudioAsset, 'id'>): StudioAsset {
  return {
    clientId: 'client-1',
    projectId: null,
    type: 'image',
    filename: `${overrides.id}.png`,
    storageUrl: `https://cdn.exemplo/${overrides.id}.png`,
    thumbUrl: null,
    prompt: 'um gato astronauta',
    model: null,
    createdBy: null,
    nodeId: null,
    jobId: null,
    slideIndex: null,
    slidesTotal: null,
    variationIndex: null,
    variationsTotal: null,
    caption: null,
    qualityPreset: null,
    style: null,
    createdAt: '2026-09-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupAssets', () => {
  it('asset solto (sem jobId, ou grupo de tamanho 1) vira seu próprio grupo', () => {
    const groups = groupAssets([makeAsset({ id: 'a' }), makeAsset({ id: 'b' })]);
    expect(groups).toEqual([[expect.objectContaining({ id: 'a' })], [expect.objectContaining({ id: 'b' })]]);
  });

  it('carousel (slidesTotal>1) agrupa por jobId, ordenado por slideIndex', () => {
    const groups = groupAssets([
      makeAsset({ id: 'c2', jobId: 'job-1', slideIndex: 1, slidesTotal: 2 }),
      makeAsset({ id: 'c1', jobId: 'job-1', slideIndex: 0, slidesTotal: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((a) => a.id)).toEqual(['c1', 'c2']);
  });

  /**
   * Achado real (2026-09-11): `variationIndex`/`variationsTotal` nunca eram
   * lidos do wire (mapStudioAsset não os mapeava) - todo job de "N
   * variações" chegava aqui sempre com esses campos `null`, então a
   * condição `groupSize > 1` nunca era verdadeira pra eles e cada variação
   * virava um card solto, sem nenhuma relação visível com as outras.
   */
  it('job de variações (variationsTotal>1) TAMBÉM agrupa por jobId, ordenado por variationIndex', () => {
    const groups = groupAssets([
      makeAsset({ id: 'v3', jobId: 'job-2', variationIndex: 2, variationsTotal: 4 }),
      makeAsset({ id: 'v1', jobId: 'job-2', variationIndex: 0, variationsTotal: 4 }),
      makeAsset({ id: 'v2', jobId: 'job-2', variationIndex: 1, variationsTotal: 4 }),
      makeAsset({ id: 'v4', jobId: 'job-2', variationIndex: 3, variationsTotal: 4 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((a) => a.id)).toEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('jobId presente mas grupo de tamanho 1 (slidesTotal e variationsTotal ambos null/1) não agrupa', () => {
    const groups = groupAssets([makeAsset({ id: 'solo', jobId: 'job-3', slidesTotal: 1, variationsTotal: 1 })]);
    expect(groups).toEqual([[expect.objectContaining({ id: 'solo' })]]);
  });

  it('preserva a ordem relativa dos grupos conforme a posição do primeiro asset de cada um', () => {
    const groups = groupAssets([
      makeAsset({ id: 'first-solo' }),
      makeAsset({ id: 'g1a', jobId: 'job-4', slideIndex: 0, slidesTotal: 2 }),
      makeAsset({ id: 'g1b', jobId: 'job-4', slideIndex: 1, slidesTotal: 2 }),
      makeAsset({ id: 'last-solo' }),
    ]);
    expect(groups.map((g) => g[0]!.id)).toEqual(['first-solo', 'g1a', 'last-solo']);
  });
});
