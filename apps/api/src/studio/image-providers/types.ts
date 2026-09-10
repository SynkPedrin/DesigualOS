import type { ImageSearchProvider } from '@desigual-os/types';

/** Formato interno (camelCase) - convertido pra `ImageSearchResultWire`
 * (snake_case) só na borda da rota, mesmo padrão do resto da API. */
export interface NormalizedImageResult {
  id: string;
  provider: ImageSearchProvider;
  thumbnailUrl: string;
  previewUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  author: string;
  authorUrl: string | null;
  sourceUrl: string;
  downloadTrackingUrl: string | null;
}

export interface SearchImagesParams {
  query: string;
  page: number;
  perPage: number;
  orientation?: 'landscape' | 'portrait' | 'square' | undefined;
}

export interface SearchImagesResult {
  results: NormalizedImageResult[];
  hasMore: boolean;
}

export class ImageProviderError extends Error {
  constructor(
    public provider: ImageSearchProvider,
    message: string,
  ) {
    super(message);
    this.name = 'ImageProviderError';
  }
}
