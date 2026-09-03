import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapStudioAsset, type StudioAssetWire } from '@/lib/api/contracts';

/** `client_id` is required for non-master callers (confirmed by the backend): a colaborador
 * without one gets 403, master can still omit it to see everything. Pass `enabled: false`
 * while a colaborador hasn't picked a client yet, rather than let that 403 surface. */
export function useStudioAssets(clientId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['studio', 'assets', clientId],
    queryFn: async () => {
      const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
      const wire = await apiFetch<{ assets: StudioAssetWire[] }>(`/studio/assets${query}`);
      return wire.assets.map(mapStudioAsset);
    },
    enabled,
  });
}
