import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GET /signals — o que o sistema percebeu sozinho.
 *
 * Existe porque `proactive_signals` não tinha leitor de gente: só o Claude,
 * pelo MCP, enxergava. Quem abre o Desigual OS no navegador — que é onde a
 * operação vive — não sabia que o sistema tinha percebido nada.
 */

export interface Sinal {
  id: string;
  rule: string;
  agent: string;
  severity: 'low' | 'medium' | 'high' | 'critical' | string;
  title: string;
  body: string;
  recommended_action: string | null;
  client_id: string | null;
  client_name: string | null;
  entity: string | null;
  /** `null` = a regra não declarou confiança. Nunca 0, que seria "tenho certeza que não". */
  confidence: number | null;
  status: string;
  created_at: string | null;
}

export interface PaginaDeSinais {
  total: number;
  mostrando: number;
  signals: Sinal[];
}

export function useSignals(filtro: { status?: string; clientId?: string | null; limite?: number } = {}) {
  const params = new URLSearchParams();
  if (filtro.status) params.set('status', filtro.status);
  if (filtro.clientId) params.set('client_id', filtro.clientId);
  if (filtro.limite) params.set('limit', String(filtro.limite));
  const query = params.toString();

  return useQuery({
    queryKey: ['signals', filtro],
    queryFn: () => apiFetch<PaginaDeSinais>(`/signals${query ? `?${query}` : ''}`),
    // Sinal é sobre o agora: prazo estourando, criativo rejeitado. Meio minuto
    // é o intervalo em que ainda faz diferença aparecer.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** Marca o sinal como tratado. Sem isto a lista só cresce e vira ruído. */
export function useTratarSinal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'dismissed' | 'resolved' }) =>
      apiFetch<{ id: string; status: string }>(`/signals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
  });
}
