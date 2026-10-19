import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { EventoBruto } from '@/lib/apresentacao/atividade';

/**
 * A LINHA DO TEMPO DA OPERAÇÃO — `operational_events`, não execuções de agente.
 *
 * A tela de Atividade lia `/executions`, que são os turnos do Bento ("o agente
 * respondeu"). O que a operação fez de verdade — tarefa criada no ClickUp,
 * conhecimento registrado pelo Claude — vive noutra tabela, e em 02/10/2026
 * ela tinha 902 linhas sem nenhuma rota que as lesse.
 *
 * A rota já devolve o NOME do cliente resolvido. Sem isso a tela faria uma
 * consulta por evento para descobrir de quem é — o N+1 clássico.
 */

export interface EventoDaAtividade extends EventoBruto {
  id: string;
  client_id?: string | null;
}

export interface RespostaDaAtividade {
  /**
   * Os clientes mais ativos da operação, agregados no SERVIDOR sobre a tabela
   * inteira. Calcular isso no cliente, sobre os eventos já baixados, daria o
   * ranking da última página — que muda a cada rolagem e aponta o cliente
   * errado com a mesma confiança.
   */
  clientes: Array<{ client_id: string | null; client_name: string | null; total: number }>;
  events: Array<{
    id: string;
    source: string | null;
    type: string | null;
    summary: string | null;
    actor: string | null;
    client_id: string | null;
    client_name: string | null;
    payload: unknown;
    occurred_at: string | null;
  }>;
  sources: Array<{ source: string | null; total: number }>;
  organizacao: { id: string; name: string };
}

export function useActivity(opcoes: { limite?: number; clientId?: string; source?: string } = {}) {
  const params = new URLSearchParams();
  if (opcoes.limite) params.set('limit', String(opcoes.limite));
  if (opcoes.clientId) params.set('client_id', opcoes.clientId);
  if (opcoes.source) params.set('source', opcoes.source);
  const qs = params.toString();

  return useQuery({
    queryKey: ['activity', opcoes.limite ?? null, opcoes.clientId ?? null, opcoes.source ?? null],
    queryFn: () => apiFetch<RespostaDaAtividade>(`/activity${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  });
}
