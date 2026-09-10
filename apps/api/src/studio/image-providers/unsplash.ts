import { ImageProviderError, type NormalizedImageResult, type SearchImagesParams, type SearchImagesResult } from './types';

const UNSPLASH_API_BASE = 'https://api.unsplash.com';

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

interface UnsplashSearchResponse {
  total: number;
  total_pages: number;
  results: UnsplashPhoto[];
}

/**
 * Integração oficial Unsplash (https://unsplash.com/documentation).
 * UNSPLASH_ACCESS_KEY nunca chega ao browser. Regras da API que isto respeita:
 * - hotlink direto nas URLs devolvidas por `urls` (nunca baixamos e
 *   re-hospedamos o arquivo em nosso próprio storage);
 * - `download_location` é chamado (ver triggerUnsplashDownload) só quando a
 *   imagem é DE FATO usada no design, não em toda visualização de busca;
 * - autor e link do perfil sempre preservados (NormalizedImageResult.author/authorUrl).
 */
export async function searchUnsplashImages(params: SearchImagesParams): Promise<SearchImagesResult> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    throw new ImageProviderError('unsplash', 'UNSPLASH_ACCESS_KEY não configurada no Orchestrator');
  }

  const url = new URL(`${UNSPLASH_API_BASE}/search/photos`);
  url.searchParams.set('query', params.query);
  url.searchParams.set('page', String(params.page));
  url.searchParams.set('per_page', String(params.perPage));
  if (params.orientation) {
    // Unsplash usa "squarish", não "square".
    url.searchParams.set('orientation', params.orientation === 'square' ? 'squarish' : params.orientation);
  }

  const response = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
  if (!response.ok) {
    throw new ImageProviderError('unsplash', `Unsplash respondeu ${response.status}`);
  }

  const data = (await response.json()) as UnsplashSearchResponse;
  return {
    results: data.results.map(
      (photo): NormalizedImageResult => ({
        id: photo.id,
        provider: 'unsplash',
        thumbnailUrl: photo.urls.small,
        previewUrl: photo.urls.regular,
        fullUrl: photo.urls.full,
        width: photo.width,
        height: photo.height,
        author: photo.user.name,
        authorUrl: photo.user.links.html,
        sourceUrl: photo.links.html,
        downloadTrackingUrl: photo.links.download_location,
      }),
    ),
    hasMore: params.page < data.total_pages,
  };
}

/** Chamado no momento em que uma imagem do Unsplash é efetivamente adicionada
 * ao design (não na busca) - dispara o tracking de download exigido pelas
 * Unsplash API Guidelines. Falha aqui não deve derrubar a ação do usuário: o
 * import da imagem já aconteceu, isto é telemetria pro provedor, não uma
 * dependência funcional do editor. */
export async function triggerUnsplashDownload(downloadLocationUrl: string): Promise<void> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return;
  try {
    await fetch(downloadLocationUrl, { headers: { Authorization: `Client-ID ${accessKey}` } });
  } catch {
    // Best-effort: ver comentário acima.
  }
}
