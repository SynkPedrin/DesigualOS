import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapBrandKit, type BrandKit, type BrandKitWire } from '@/lib/api/contracts';

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

/** Campos aceitos pelo PUT /clients/:id/brand-kit. Omitir um campo mantém o
 * valor atual no backend (merge); pra limpar, mande null/[]. */
export interface SaveBrandKitInput {
  logoUrl?: string | null;
  colors?: string[];
  fonts?: string[];
  toneOfVoice?: string | null;
  referenceImages?: string[];
}

/** PUT /clients/:id/brand-kit — write path do Brand Kit (até 11/09/2026 a
 * tabela só era populada por SQL manual, e o loop de DNA do Otto ficava
 * inerte pra cliente sem kit). */
export function useSaveBrandKit(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveBrandKitInput) =>
      mapBrandKit(
        await apiFetch<BrandKitWire>(`/clients/${clientId}/brand-kit`, {
          method: 'PUT',
          body: JSON.stringify({
            logo_url: input.logoUrl,
            colors: input.colors,
            fonts: input.fonts,
            tone_of_voice: input.toneOfVoice,
            reference_images: input.referenceImages,
          }),
        }),
      ),
    onSuccess: (data: BrandKit) => {
      queryClient.setQueryData(['clients', clientId, 'brand-kit'], data);
    },
  });
}
