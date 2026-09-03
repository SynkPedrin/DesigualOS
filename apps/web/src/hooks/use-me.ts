import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { MeResponse } from '@/lib/api/contracts';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<MeResponse>('/me'),
    staleTime: 5 * 60_000,
  });
}
