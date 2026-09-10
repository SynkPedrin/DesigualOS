import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapBrandKit, type BrandKitWire } from '@/lib/api/contracts';

/** GET /clients/:id/brand-kit — resumo do Brand Kit aplicado automaticamente
 * aos jobs do Studio. Campos vêm null/[] quando o cliente não tem kit. */
export function useBrandKit(clientId: string | null) {
  return useQuery({
    queryKey: ['clients', clientId, 'brand-kit'],
    queryFn: async () => mapBrandKit(await apiFetch<BrandKitWire>(`/clients/${clientId}/brand-kit`)),
    enabled: Boolean(clientId),
    staleTime: 5 * 60_000,
  });
}
