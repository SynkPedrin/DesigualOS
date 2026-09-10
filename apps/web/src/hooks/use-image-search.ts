import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import type { ImageSearchProvider } from '@desigual-os/types';
import { apiFetch } from '@/lib/api/client';
import { mapImageSearchResult, type ImageSearchResult } from '@/lib/api/contracts';
import type { ImageSearchResultWire } from '@desigual-os/types';

interface ImageSearchPageWire {
  results: ImageSearchResultWire[];
  has_more: boolean;
  failed_providers: { provider: ImageSearchProvider; reason: string }[];
}

const PER_PAGE = 24;

/**
 * Busca com cache real: o queryKey inclui query+provider, então trocar de
 * painel e voltar (ou repetir a mesma busca) reaproveita o cache do React
 * Query em vez de bater nas 3 APIs de novo (pedido "Image Provider Cache").
 * Debounce fica por conta de quem chama (ver panel-images.tsx) - aqui só o
 * `enabled` decide quando disparar.
 */
export function useImageSearch(query: string, provider: ImageSearchProvider | 'all') {
  return useInfiniteQuery({
    queryKey: ['studio', 'image-search', query, provider],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        query,
        page: String(pageParam),
        per_page: String(PER_PAGE),
        provider,
      });
      const wire = await apiFetch<ImageSearchPageWire>(`/studio/image-search?${params.toString()}`);
      return {
        results: wire.results.map(mapImageSearchResult),
        hasMore: wire.has_more,
        failedProviders: wire.failed_providers,
      };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    enabled: query.trim().length > 0,
    staleTime: 5 * 60_000,
  });
}

/** Chamado quando uma imagem é de fato adicionada ao design - dispara o
 * tracking de download do Unsplash quando aplicável (no-op pros outros dois). */
export function useTrackImageDownload() {
  return useMutation({
    mutationFn: (downloadTrackingUrl: string) =>
      apiFetch<{ ok: true }>('/studio/image-search/track-download', {
        method: 'POST',
        body: JSON.stringify({ download_tracking_url: downloadTrackingUrl }),
      }),
  });
}

export type { ImageSearchResult };
