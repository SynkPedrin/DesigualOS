import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPexelsImages } from './pexels';
import { ImageProviderError } from './types';

describe('searchPexelsImages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('normaliza a resposta da Pexels pro formato comum, preservando autor/origem', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          page: 1,
          per_page: 20,
          total_results: 100,
          next_page: 'https://api.pexels.com/v1/search?page=2',
          photos: [
            {
              id: 42,
              width: 1920,
              height: 1080,
              url: 'https://www.pexels.com/photo/42',
              photographer: 'Jane Doe',
              photographer_url: 'https://www.pexels.com/@jane',
              src: { original: 'o.jpg', large2x: 'l2x.jpg', large: 'l.jpg', medium: 'm.jpg', small: 's.jpg', tiny: 't.jpg' },
            },
          ],
        }),
      }),
    );

    const result = await searchPexelsImages({ query: 'technology', page: 1, perPage: 20 });

    expect(result.hasMore).toBe(true);
    expect(result.results).toEqual([
      {
        id: '42',
        provider: 'pexels',
        thumbnailUrl: 's.jpg',
        previewUrl: 'm.jpg',
        fullUrl: 'l2x.jpg',
        width: 1920,
        height: 1080,
        author: 'Jane Doe',
        authorUrl: 'https://www.pexels.com/@jane',
        sourceUrl: 'https://www.pexels.com/photo/42',
        downloadTrackingUrl: null,
      },
    ]);
  });

  it('marca hasMore=false quando a Pexels não devolve next_page (última página)', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ page: 3, per_page: 20, total_results: 50, photos: [] }) }),
    );

    const result = await searchPexelsImages({ query: 'technology', page: 3, perPage: 20 });
    expect(result.hasMore).toBe(false);
    expect(result.results).toEqual([]);
  });

  it('lança ImageProviderError sem chamar a rede quando PEXELS_API_KEY não está configurada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchPexelsImages({ query: 'x', page: 1, perPage: 20 })).rejects.toBeInstanceOf(ImageProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lança ImageProviderError quando a Pexels responde com erro HTTP', async () => {
    vi.stubEnv('PEXELS_API_KEY', 'fake-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await expect(searchPexelsImages({ query: 'x', page: 1, perPage: 20 })).rejects.toThrow('429');
  });
});
