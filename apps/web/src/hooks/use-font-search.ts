import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapFontCatalogEntry, type FontCatalogEntry, type FontCatalogEntryWire } from '@/lib/api/contracts';

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

export function useFontSearch(query: string, category: FontCategory | null) {
  return useQuery({
    queryKey: ['studio', 'fonts', query, category],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (category) params.set('category', category);
      const wire = await apiFetch<{ fonts: FontCatalogEntryWire[] }>(`/studio/fonts?${params.toString()}`);
      return wire.fonts.map(mapFontCatalogEntry);
    },
    staleTime: 30 * 60_000,
  });
}

export type { FontCatalogEntry };
