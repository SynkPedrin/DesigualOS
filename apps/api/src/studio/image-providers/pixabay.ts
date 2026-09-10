import { ImageProviderError, type NormalizedImageResult, type SearchImagesParams, type SearchImagesResult } from './types';

const PIXABAY_API_BASE = 'https://pixabay.com/api/';

interface PixabayHit {
  id: number;
  pageURL: string;
  previewURL: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  user_id: number;
}

interface PixabaySearchResponse {
  total: number;
  totalHits: number;
  hits: PixabayHit[];
}

/**
 * Integração oficial Pixabay (https://pixabay.com/api/docs/). PIXABAY_API_KEY
 * nunca chega ao browser - vai só na query string desta chamada server-side
 * (é assim que a API do Pixabay exige a chave, não tem opção de header).
 * Pixabay exige per_page mínimo 3.
 */
export async function searchPixabayImages(params: SearchImagesParams): Promise<SearchImagesResult> {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    throw new ImageProviderError('pixabay', 'PIXABAY_API_KEY não configurada no Orchestrator');
  }

  const url = new URL(PIXABAY_API_BASE);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', params.query);
  url.searchParams.set('page', String(params.page));
  url.searchParams.set('per_page', String(Math.max(3, params.perPage)));
  url.searchParams.set('image_type', 'photo');
  if (params.orientation === 'landscape') url.searchParams.set('orientation', 'horizontal');
  else if (params.orientation === 'portrait') url.searchParams.set('orientation', 'vertical');

  const response = await fetch(url);
  if (!response.ok) {
    throw new ImageProviderError('pixabay', `Pixabay respondeu ${response.status}`);
  }

  const data = (await response.json()) as PixabaySearchResponse;
  const totalPages = Math.ceil(data.totalHits / Math.max(3, params.perPage));
  return {
    results: data.hits.map(
      (hit): NormalizedImageResult => ({
        id: String(hit.id),
        provider: 'pixabay',
        thumbnailUrl: hit.previewURL,
        previewUrl: hit.webformatURL,
        fullUrl: hit.largeImageURL,
        width: hit.imageWidth,
        height: hit.imageHeight,
        author: hit.user,
        authorUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
        sourceUrl: hit.pageURL,
        downloadTrackingUrl: null,
      }),
    ),
    hasMore: params.page < totalPages,
  };
}
