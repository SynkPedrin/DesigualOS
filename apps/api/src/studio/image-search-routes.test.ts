import { describe, expect, it } from 'vitest';
import { interleave } from './image-search-routes';
import type { NormalizedImageResult } from './image-providers/types';

function stub(provider: NormalizedImageResult['provider'], count: number): NormalizedImageResult[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${provider}-${i}`,
    provider,
    thumbnailUrl: '',
    previewUrl: '',
    fullUrl: '',
    width: 100,
    height: 100,
    author: '',
    authorUrl: null,
    sourceUrl: '',
    downloadTrackingUrl: null,
  }));
}

describe('interleave', () => {
  it('alterna entre provedores em vez de concatenar em blocos', () => {
    const merged = interleave([stub('pexels', 2), stub('unsplash', 2)]);
    expect(merged.map((r) => r.id)).toEqual(['pexels-0', 'unsplash-0', 'pexels-1', 'unsplash-1']);
  });

  it('não perde itens quando um provedor tem mais resultados que os outros', () => {
    const merged = interleave([stub('pexels', 3), stub('unsplash', 1), stub('pixabay', 2)]);
    expect(merged).toHaveLength(6);
    expect(merged.map((r) => r.id)).toEqual([
      'pexels-0',
      'unsplash-0',
      'pixabay-0',
      'pexels-1',
      'pixabay-1',
      'pexels-2',
    ]);
  });

  it('devolve lista vazia quando todos os grupos estão vazios', () => {
    expect(interleave([[], []])).toEqual([]);
  });

  it('devolve lista vazia quando não há nenhum grupo (todos os provedores falharam)', () => {
    expect(interleave([])).toEqual([]);
  });
});
