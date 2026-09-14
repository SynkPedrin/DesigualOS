import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { mapStudioAsset, type StudioAsset, type StudioAssetsPageWire, type StudioJobType } from '@/lib/api/contracts';

interface StudioAssetsPage {
  assets: StudioAsset[];
  total: number;
}

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

/**
 * Asset avulso. O grupo inteiro (carousel/variações) sai por useDeleteStudioJob.
 *
 * Achado real (2026-09-11): antes disto, o card excluído continuava
 * aparecendo na galeria até o `invalidateQueries` completar um roundtrip
 * inteiro (buscar a página de novo do zero) - por alguns instantes, clicar
 * "Excluir" parecia não ter feito nada. `onMutate` remove o asset do cache
 * na hora (otimista, mesmo princípio já aplicado no autosave do Canva:
 * `setQueryData` em vez de só invalidar e esperar), com rollback em
 * `onError` se o delete de fato falhar no servidor.
 */
export function useDeleteStudioAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => apiFetch<void>(`/studio/assets/${assetId}`, { method: 'DELETE' }),
    onMutate: async (assetId) => {
      await queryClient.cancelQueries({ queryKey: ['studio', 'assets', 'page'] });
      const previous = queryClient.getQueriesData<StudioAssetsPage>({ queryKey: ['studio', 'assets', 'page'] });
      queryClient.setQueriesData<StudioAssetsPage>({ queryKey: ['studio', 'assets', 'page'] }, (data) =>
        data ? { assets: data.assets.filter((asset) => asset.id !== assetId), total: Math.max(0, data.total - 1) } : data,
      );
      return { previous };
    },
    onError: (_error, _assetId, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
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

/** Deleta o job e TODOS os assets do grupo (backend confirma o cascade).
 * Mesmo tratamento otimista de useDeleteStudioAsset acima - um grupo
 * inteiro (carousel/variações) some da tela na hora, não card por card
 * conforme cada requisição individual completaria. */
export function useDeleteStudioJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => apiFetch<void>(`/studio/jobs/${jobId}`, { method: 'DELETE' }),
    onMutate: async (jobId) => {
      await queryClient.cancelQueries({ queryKey: ['studio', 'assets', 'page'] });
      const previous = queryClient.getQueriesData<StudioAssetsPage>({ queryKey: ['studio', 'assets', 'page'] });
      queryClient.setQueriesData<StudioAssetsPage>({ queryKey: ['studio', 'assets', 'page'] }, (data) => {
        if (!data) return data;
        const remaining = data.assets.filter((asset) => asset.jobId !== jobId);
        // Grupo inteiro (carousel/variações) pode remover mais de 1 asset de
        // uma vez - decrementa `total` pela quantidade REAL removida, não
        // sempre 1 (diferente de useDeleteStudioAsset, que remove exatamente
        // um asset por chamada).
        return { assets: remaining, total: Math.max(0, data.total - (data.assets.length - remaining.length)) };
      });
      return { previous };
    },
    onError: (_error, _jobId, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
      queryClient.invalidateQueries({ queryKey: ['studio', 'jobs'] });
    },
  });
}
