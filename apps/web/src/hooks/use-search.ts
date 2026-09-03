import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapSearchResults, type SearchResultsWire } from '@/lib/api/contracts';

export function useSearch(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: async () => mapSearchResults(await apiFetch<SearchResultsWire>(`/search?q=${encodeURIComponent(trimmed)}`)),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
  });
}
