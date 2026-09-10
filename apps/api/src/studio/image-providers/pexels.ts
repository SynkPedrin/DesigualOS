import { ImageProviderError, type NormalizedImageResult, type SearchImagesParams, type SearchImagesResult } from './types';

const PEXELS_API_BASE = 'https://api.pexels.com/v1';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    tiny: string;
  };
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  page: number;
  per_page: number;
  total_results: number;
  next_page?: string;
}

/**
 * Integração oficial Pexels (https://www.pexels.com/api/documentation/).
 * PEXELS_API_KEY nunca chega ao browser - só esta função server-side a lê.
 */
export async function searchPexelsImages(params: SearchImagesParams): Promise<SearchImagesResult> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new ImageProviderError('pexels', 'PEXELS_API_KEY não configurada no Orchestrator');
  }

  const url = new URL(`${PEXELS_API_BASE}/search`);
  url.searchParams.set('query', params.query);
  url.searchParams.set('page', String(params.page));
  url.searchParams.set('per_page', String(params.perPage));
  if (params.orientation) url.searchParams.set('orientation', params.orientation);

  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    throw new ImageProviderError('pexels', `Pexels respondeu ${response.status}`);
  }

  const data = (await response.json()) as PexelsSearchResponse;
  return {
    results: data.photos.map(
      (photo): NormalizedImageResult => ({
        id: String(photo.id),
        provider: 'pexels',
        thumbnailUrl: photo.src.small,
        previewUrl: photo.src.medium,
        fullUrl: photo.src.large2x,
        width: photo.width,
        height: photo.height,
        author: photo.photographer,
        authorUrl: photo.photographer_url,
        sourceUrl: photo.url,
        // Pexels não exige um endpoint de tracking à parte (diferente do Unsplash) -
        // atribuição no próprio uso já satisfaz os termos.
        downloadTrackingUrl: null,
      }),
    ),
    hasMore: Boolean(data.next_page),
  };
}
