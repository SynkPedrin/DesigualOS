import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchUnsplashImages, triggerUnsplashDownload } from './unsplash';
import { ImageProviderError } from './types';

describe('searchUnsplashImages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('normaliza a resposta e preserva o link de download-tracking (obrigatório pelas Unsplash API Guidelines)', async () => {
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'fake-key');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 500,
        total_pages: 25,
        results: [
          {
            id: 'abc123',
            width: 4000,
            height: 3000,
            urls: { raw: 'raw.jpg', full: 'full.jpg', regular: 'regular.jpg', small: 'small.jpg', thumb: 'thumb.jpg' },
            links: { html: 'https://unsplash.com/photos/abc123', download_location: 'https://api.unsplash.com/photos/abc123/download' },
            user: { name: 'John Smith', links: { html: 'https://unsplash.com/@john' } },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchUnsplashImages({ query: 'office', page: 1, perPage: 20 });

    expect(result.results[0]).toEqual({
      id: 'abc123',
      provider: 'unsplash',
      thumbnailUrl: 'small.jpg',
      previewUrl: 'regular.jpg',
      fullUrl: 'full.jpg',
      width: 4000,
      height: 3000,
      author: 'John Smith',
      authorUrl: 'https://unsplash.com/@john',
      sourceUrl: 'https://unsplash.com/photos/abc123',
      downloadTrackingUrl: 'https://api.unsplash.com/photos/abc123/download',
    });
    expect(result.hasMore).toBe(true);
  });

  it('traduz orientation "square" pro vocabulário da Unsplash ("squarish")', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 0, total_pages: 0, results: [] }) });
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'fake-key');
    vi.stubGlobal('fetch', fetchMock);

    await searchUnsplashImages({ query: 'x', page: 1, perPage: 20, orientation: 'square' });

    const calledUrl = fetchMock.mock.calls[0]![0] as URL;
    expect(calledUrl.searchParams.get('orientation')).toBe('squarish');
  });

  it('lança ImageProviderError quando UNSPLASH_ACCESS_KEY não está configurada', async () => {
    await expect(searchUnsplashImages({ query: 'x', page: 1, perPage: 20 })).rejects.toBeInstanceOf(ImageProviderError);
  });
});

describe('triggerUnsplashDownload', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('chama a download_location com o Client-ID correto', async () => {
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'fake-key');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await triggerUnsplashDownload('https://api.unsplash.com/photos/abc123/download');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.unsplash.com/photos/abc123/download',
      expect.objectContaining({ headers: { Authorization: 'Client-ID fake-key' } }),
    );
  });

  it('nunca lança (best-effort): uma falha de rede não deve derrubar quem chamou', async () => {
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'fake-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(triggerUnsplashDownload('https://api.unsplash.com/photos/x/download')).resolves.toBeUndefined();
  });
});
