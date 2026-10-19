import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { MediaOverviewWire } from '@/lib/api/contracts';

/**
 * GET /media/overview — a mídia da carteira inteira numa resposta.
 *
 * `staleTime` de 2 minutos: por trás disto há uma chamada à Graph API por
 * cliente conectado. Reconsultar a cada navegação queimaria rate limit do Meta
 * para mostrar o mesmo número — investimento de 30 dias não muda em segundos.
 */
export function useMediaOverview() {
  return useQuery({
    queryKey: ['media', 'overview'],
    queryFn: () => apiFetch<MediaOverviewWire>('/media/overview'),
    staleTime: 2 * 60_000,
  });
}
