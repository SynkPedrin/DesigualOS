import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IMAGE_SEARCH_PROVIDERS, type ImageSearchProvider } from '@desigual-os/types';
import { requireAuth } from '../auth/middleware';
import { searchPexelsImages } from './image-providers/pexels';
import { searchUnsplashImages, triggerUnsplashDownload } from './image-providers/unsplash';
import { searchPixabayImages } from './image-providers/pixabay';
import { ImageProviderError, type NormalizedImageResult, type SearchImagesParams } from './image-providers/types';

const PROVIDER_SEARCH: Record<ImageSearchProvider, (params: SearchImagesParams) => Promise<{ results: NormalizedImageResult[]; hasMore: boolean }>> = {
  pexels: searchPexelsImages,
  unsplash: searchUnsplashImages,
  pixabay: searchPixabayImages,
};

const searchQuerySchema = z.object({
  query: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(3).max(40).default(20),
  orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
  provider: z.enum(['all', ...IMAGE_SEARCH_PROVIDERS]).default('all'),
});

function toWire(result: NormalizedImageResult) {
  return {
    id: result.id,
    provider: result.provider,
    thumbnail_url: result.thumbnailUrl,
    preview_url: result.previewUrl,
    full_url: result.fullUrl,
    width: result.width,
    height: result.height,
    author: result.author,
    author_url: result.authorUrl,
    source_url: result.sourceUrl,
    download_tracking_url: result.downloadTrackingUrl,
  };
}

/** Intercala resultados de N provedores (em vez de concatenar em blocos) pra
 * a grade masonry não ficar "primeiro tudo do Pexels, depois tudo do Unsplash". */
export function interleave(groups: NormalizedImageResult[][]): NormalizedImageResult[] {
  const merged: NormalizedImageResult[] = [];
  const maxLength = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < maxLength; i += 1) {
    for (const group of groups) {
      const item = group[i];
      if (item) merged.push(item);
    }
  }
  return merged;
}

export async function registerImageSearchRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Busca unificada (seção "Busca Unificada" do pedido): a UI nunca precisa
   * saber que são 3 APIs diferentes. provider=all roda as 3 em paralelo com
   * Promise.allSettled - um provedor fora do ar não derruba os outros dois
   * (seção "Fallback"). Cada provedor sem API key configurada é tratado como
   * "indisponível", não como erro fatal da rota inteira.
   */
  app.get('/studio/image-search', { preHandler: requireAuth }, async (request, reply) => {
    const query = searchQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: 'Parâmetros de busca inválidos', details: query.error.issues };
    }
    const { query: q, page, per_page: perPage, orientation, provider } = query.data;
    const params: SearchImagesParams = { query: q, page, perPage, orientation };

    const providersToQuery: ImageSearchProvider[] = provider === 'all' ? [...IMAGE_SEARCH_PROVIDERS] : [provider];

    const settled = await Promise.allSettled(providersToQuery.map((p) => PROVIDER_SEARCH[p](params)));

    const groups: NormalizedImageResult[][] = [];
    const failedProviders: { provider: ImageSearchProvider; reason: string }[] = [];
    let hasMore = false;

    settled.forEach((outcome, index) => {
      const providerName = providersToQuery[index]!;
      if (outcome.status === 'fulfilled') {
        groups.push(outcome.value.results);
        hasMore = hasMore || outcome.value.hasMore;
      } else {
        const reason = outcome.reason instanceof ImageProviderError ? outcome.reason.message : 'Falha desconhecida';
        failedProviders.push({ provider: providerName, reason });
        request.log.warn({ provider: providerName, error: outcome.reason }, 'image_search_provider_failed');
      }
    });

    if (groups.every((g) => g.length === 0) && failedProviders.length === providersToQuery.length) {
      reply.code(502);
      return { error: 'Nenhum provedor de imagens respondeu. Tente novamente.', failed_providers: failedProviders };
    }

    return {
      results: interleave(groups).map(toWire),
      has_more: hasMore,
      failed_providers: failedProviders,
    };
  });

  const trackDownloadSchema = z.object({ download_tracking_url: z.string().url() });

  /** Unsplash API Guidelines: chamar isto quando a imagem é DE FATO adicionada
   * ao design (POST vindo do onAdd do painel de Imagens), não a cada preview. */
  app.post('/studio/image-search/track-download', { preHandler: requireAuth }, async (request, reply) => {
    const body = trackDownloadSchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'download_tracking_url é obrigatório' };
    }
    await triggerUnsplashDownload(body.data.download_tracking_url);
    return { ok: true };
  });
}
