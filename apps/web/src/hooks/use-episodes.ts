import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GET /episodes — o que a operação DECIDIU, preferiu e corrigiu.
 *
 * Criado em 30/09/2026 junto com a rota, corrigindo um erro meu: a tela de
 * Decisões lia `memories` com `kind = 'decision'`, um kind que não existe. A
 * consulta voltava vazia sempre e a tela anunciava "nenhuma decisão registrada
 * ainda" — sobre um banco com 9 decisões, 2 preferências, 2 feedbacks e 1
 * mudança operacional, todos em `agent_episodes`.
 *
 * "Não achei" e "não procurei no lugar certo" parecem iguais pra quem lê, e
 * pedem reações opostas.
 */

export interface Episodio {
  id: string;
  event_type: string;
  summary: string;
  /** O que ficou acordado. Separado dos fatos de propósito: regra não é contexto. */
  decisions: string[];
  facts: string[];
  feedback: string[];
  client_id: string | null;
  client_name: string | null;
  author_name: string | null;
  agent: string | null;
  conversation_id: string | null;
  occurred_at: string | null;
}

/** Janela e total: a tela precisa dos dois pra não chamar de total o que coube. */
export interface PaginaDeEpisodios {
  total: number;
  mostrando: number;
  episodes: Episodio[];
}

export function useEpisodes(filtro: { type?: string | null | undefined; clientId?: string | null | undefined; limite?: number } = {}) {
  const params = new URLSearchParams();
  if (filtro.type) params.set('type', filtro.type);
  if (filtro.clientId) params.set('client_id', filtro.clientId);
  if (filtro.limite) params.set('limit', String(filtro.limite));
  const query = params.toString();

  return useQuery({
    queryKey: ['episodes', filtro],
    queryFn: () => apiFetch<PaginaDeEpisodios>(`/episodes${query ? `?${query}` : ''}`),
    staleTime: 30_000,
  });
}

export function useEpisodeTypes() {
  return useQuery({
    queryKey: ['episodes', 'types'],
    queryFn: async () => (await apiFetch<{ types: Array<{ type: string; total: number }> }>('/episodes/types')).types,
    staleTime: 60_000,
  });
}
