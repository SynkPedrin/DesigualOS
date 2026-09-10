'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ImageSearchProvider } from '@desigual-os/types';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { useImageSearch, useTrackImageDownload, type ImageSearchResult } from '@/hooks/use-image-search';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const PROVIDER_FILTERS: { key: ImageSearchProvider | 'all'; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'pexels', label: 'Pexels' },
  { key: 'unsplash', label: 'Unsplash' },
  { key: 'pixabay', label: 'Pixabay' },
];

const DEBOUNCE_MS = 400;

export function ImagesPanel({ editor }: { editor: UseCanvaEditorResult }) {
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ImageSearchProvider | 'all'>('all');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const trackDownload = useTrackImageDownload();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(inputValue.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { data, isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, isError } = useImageSearch(query, provider);

  const results = useMemo<ImageSearchResult[]>(() => data?.pages.flatMap((page) => page.results) ?? [], [data]);
  const failedProviders = data?.pages.at(-1)?.failedProviders ?? [];

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  async function handleAdd(image: ImageSearchResult) {
    await editor.addImageFromSrc(image.fullUrl, image.width, image.height);
    if (image.downloadTrackingUrl) trackDownload.mutate(image.downloadTrackingUrl);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-grafite-elevado p-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
          <input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Buscar fotos, pessoas, lugares, objetos..."
            aria-label="Buscar imagens"
            className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-8 pr-2 text-xs text-branco-cru placeholder:text-nevoa/70 focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setProvider(option.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                provider === option.key ? 'bg-roxo-eletrico text-branco-cru' : 'bg-carbono text-nevoa hover:text-branco-cru',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!query && <p className="py-8 text-center text-xs text-nevoa">Digite algo para buscar imagens.</p>}

        {query && isError && (
          <p className="py-8 text-center text-xs text-erro">Não foi possível carregar imagens agora. Tente de novo.</p>
        )}

        {query && failedProviders.length > 0 && failedProviders.length < PROVIDER_FILTERS.length - 1 && (
          <p className="mb-2 text-[10px] text-nevoa">
            {failedProviders.map((f) => f.provider).join(', ')} indisponível no momento - mostrando os demais.
          </p>
        )}

        {query && (
          <div className="columns-2 gap-2 [&>*]:mb-2">
            {results.map((image) => (
              <button
                key={`${image.provider}-${image.id}`}
                type="button"
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/uri-list', image.fullUrl)}
                onClick={() => void handleAdd(image)}
                title={`Foto de ${image.author}`}
                className="block w-full overflow-hidden rounded-md border border-grafite-elevado bg-carbono transition-opacity hover:opacity-80"
              >
                <img src={image.thumbnailUrl} alt="" loading="lazy" className="w-full" style={{ aspectRatio: `${image.width} / ${image.height}` }} />
              </button>
            ))}
          </div>
        )}

        {query && isFetching && !isFetchingNextPage && (
          <div className="columns-2 gap-2 [&>*]:mb-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-md" />
            ))}
          </div>
        )}

        {query && results.length === 0 && !isFetching && !isError && (
          <p className="py-8 text-center text-xs text-nevoa">Nenhuma imagem encontrada para &quot;{query}&quot;.</p>
        )}

        <div ref={sentinelRef} className="h-1" />
        {isFetchingNextPage && <p className="py-2 text-center text-[10px] text-nevoa">Carregando mais...</p>}
      </div>
    </div>
  );
}
