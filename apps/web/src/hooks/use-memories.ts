import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GET /memories — a memória institucional, exposta pra ser vista.
 *
 * Criada em 29/09/2026 junto com a rota. Até então a tabela `memories` era
 * escrita e lida só pelos agentes: não existia jeito de alguém abrir o sistema
 * e ver o que ele acha que sabe. Memória que só o agente enxerga é caixa-preta,
 * e quando ela erra ninguém descobre pela memória — descobre pelo briefing
 * errado três dias depois.
 */

export interface MemoriaWire {
  id: string;
  kind: string;
  content: string;
  client_id: string | null;
  client_name: string | null;
  author_name: string | null;
  source_type: string | null;
  status: string;
  superseded_by: string | null;
  superseded_at: string | null;
  confidence: string | null;
  importance: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
}

export interface FiltroDeMemoria {
  clientId?: string | null | undefined;
  kind?: string | null | undefined;
  /** 'active' (padrão) ou 'all' pra incluir o que já foi aposentado. */
  status?: string | undefined;
  busca?: string | undefined;
  limite?: number | undefined;
}

export function useMemories(filtro: FiltroDeMemoria = {}) {
  const params = new URLSearchParams();
  if (filtro.clientId) params.set('client_id', filtro.clientId);
  if (filtro.kind) params.set('kind', filtro.kind);
  if (filtro.status) params.set('status', filtro.status);
  if (filtro.busca) params.set('q', filtro.busca);
  if (filtro.limite) params.set('limit', String(filtro.limite));
  const query = params.toString();

  return useQuery({
    queryKey: ['memories', filtro],
    queryFn: async () => (await apiFetch<{ memories: MemoriaWire[] }>(`/memories${query ? `?${query}` : ''}`)).memories,
    staleTime: 30_000,
  });
}

export function useMemoryKinds() {
  return useQuery({
    queryKey: ['memories', 'kinds'],
    queryFn: async () => (await apiFetch<{ kinds: Array<{ kind: string; total: number }> }>('/memories/kinds')).kinds,
    staleTime: 60_000,
  });
}
