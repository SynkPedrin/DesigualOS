import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPixabayImages } from './pixabay';
import { ImageProviderError } from './types';

describe('searchPixabayImages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('normaliza a resposta e monta a URL do perfil do autor', async () => {
    vi.stubEnv('PIXABAY_API_KEY', 'fake-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          total: 200,
          totalHits: 200,
          hits: [
            {
              id: 7,
              pageURL: 'https://pixabay.com/photos/business-7/',
              previewURL: 'preview.jpg',
              webformatURL: 'webformat.jpg',
              largeImageURL: 'large.jpg',
              imageWidth: 1280,
              imageHeight: 720,
              user: 'maria',
              user_id: 55,
            },
          ],
        }),
      }),
    );

    const result = await searchPixabayImages({ query: 'business', page: 1, perPage: 20 });

    expect(result.results[0]).toEqual({
      id: '7',
      provider: 'pixabay',
      thumbnailUrl: 'preview.jpg',
      previewUrl: 'webformat.jpg',
      fullUrl: 'large.jpg',
      width: 1280,
      height: 720,
      author: 'maria',
      authorUrl: 'https://pixabay.com/users/maria-55/',
      sourceUrl: 'https://pixabay.com/photos/business-7/',
      downloadTrackingUrl: null,
    });
  });

  it('nunca manda per_page abaixo de 3 (mínimo exigido pela API do Pixabay)', async () => {
    vi.stubEnv('PIXABAY_API_KEY', 'fake-key');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 0, totalHits: 0, hits: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchPixabayImages({ query: 'x', page: 1, perPage: 1 });

    const calledUrl = fetchMock.mock.calls[0]![0] as URL;
    expect(calledUrl.searchParams.get('per_page')).toBe('3');
  });

  it('lança ImageProviderError quando PIXABAY_API_KEY não está configurada', async () => {
    await expect(searchPixabayImages({ query: 'x', page: 1, perPage: 20 })).rejects.toBeInstanceOf(ImageProviderError);
  });
});
