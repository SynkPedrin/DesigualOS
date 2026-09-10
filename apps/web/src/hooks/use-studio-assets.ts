import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapStudioAsset, type StudioAssetsPageWire, type StudioJobType } from '@/lib/api/contracts';

export interface StudioAssetsFilter {
  clientId: string | null;
  type?: StudioJobType | null;
  q?: string;
}

function buildAssetsQuery(filter: StudioAssetsFilter, limit: number, offset: number): string {
  const params = new URLSearchParams();
  if (filter.clientId) params.set('client_id', filter.clientId);
  if (filter.type) params.set('type', filter.type);
  if (filter.q) params.set('q', filter.q);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return `/studio/assets?${params.toString()}`;
}

async function fetchAssetsPage(filter: StudioAssetsFilter, limit: number, offset: number) {
  const wire = await apiFetch<StudioAssetsPageWire>(buildAssetsQuery(filter, limit, offset));
  return { assets: wire.assets.map(mapStudioAsset), total: wire.total };
}

/** `client_id` is required for non-master callers (confirmed by the backend): a colaborador
 * without one gets 403, master can still omit it to see everything. Pass `enabled: false`
 * while a colaborador hasn't picked a client yet, rather than let that 403 surface. */
export function useStudioAssets(filter: StudioAssetsFilter, enabled = true) {
  return useQuery({
    queryKey: ['studio', 'assets', 'page', filter.clientId, filter.type ?? null, filter.q ?? ''],
    queryFn: () => fetchAssetsPage(filter, 100, 0),
    enabled,
    // Rede de segurança (09/09/2026): a atualização normal vem da invalidação
    // via WS em studio.job.progress (use-realtime-events.ts), mas esse socket
    // é uma conexão só autenticada no handshake - se ela cair (rede, aba em
    // segundo plano, o próprio servidor da API reiniciando em dev) e não
    // reconectar a tempo, a galeria ficava travada pra sempre sem nenhum
    // polling por trás, ao contrário do que os outros hooks WS-conectados já
    // fazem. 20s: rápido o bastante pra não parecer travado, sem virar
    // polling agressivo numa tela que já teria atualização instantânea no
    // caminho feliz.
    refetchInterval: 20_000,
  });
}

/** Asset avulso. O grupo inteiro (carousel/variações) sai por useDeleteStudioJob. */
export function useDeleteStudioAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => apiFetch<void>(`/studio/assets/${assetId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
    },
  });
}

/** Gera a legenda de um asset sob demanda (botão manual "Gerar legenda com Otto") -
 * nunca automático. Otto analisa a imagem já gerada + o briefing original + o
 * BrandKit real do cliente (ver POST /studio/assets/:id/caption). */
export function useGenerateAssetCaption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch<{ caption: string; hashtags: string[] }>(`/studio/assets/${assetId}/caption`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
    },
  });
}

/** Deleta o job e TODOS os assets do grupo (backend confirma o cascade). */
export function useDeleteStudioJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => apiFetch<void>(`/studio/jobs/${jobId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
      queryClient.invalidateQueries({ queryKey: ['studio', 'jobs'] });
    },
  });
}
