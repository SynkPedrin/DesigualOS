import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapSearchResults, type SearchResultsWire } from '@/lib/api/contracts';

export function useSearch(query: string) {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);

  // Sem isto cada tecla vira um request: digitar "agencia" mandava 7 buscas ao
  // Postgres remoto (~500ms cada) num pool de 3 conexões. 180ms cabe dentro da
  // digitação normal, então o resultado continua parecendo imediato.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), 180);
    return () => clearTimeout(timer);
  }, [trimmed]);

  return useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => mapSearchResults(await apiFetch<SearchResultsWire>(`/search?q=${encodeURIComponent(debounced)}`)),
    enabled: debounced.length > 0,
    staleTime: 30_000,
    // Mantém a lista anterior enquanto o novo termo carrega: sem isso a paleta
    // pisca "Nenhum resultado encontrado" entre uma letra e outra.
    placeholderData: keepPreviousData,
  });
}
