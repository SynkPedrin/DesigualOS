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
  /**
   * O escopo do MCP, quando a memória veio por lá: AGENCY, CLIENT, EMPLOYEE,
   * DELIVERY_TYPE, CAMPAIGN, PROCESS, USER_PRIVATE. `null` = não veio pelo MCP.
   *
   * A tela mostra isso porque "quem mais vê isto?" é a primeira pergunta de
   * quem lê memória institucional. Sem o rótulo, uma anotação sobre um cliente
   * e uma regra que vale pra agência inteira parecem a mesma coisa — e o
   * tamanho do estrago de uma memória errada depende exatamente disso.
   */
  mcp_scope: string | null;
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

/**
 * A resposta traz a JANELA e o TOTAL, e os dois importam.
 *
 * A tela pedia 150, recebia 150 e se intitulava "150 registro(s)" — com 396
 * visíveis. Devolver só o array condena qualquer tela a contar o que tem na mão
 * e chamar de total; é preciso que o número de fora exista pra ela poder ser
 * honesta.
 */
export interface PaginaDeMemoria {
  total: number;
  mostrando: number;
  memories: MemoriaWire[];
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
    queryFn: () => apiFetch<PaginaDeMemoria>(`/memories${query ? `?${query}` : ''}`),
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
