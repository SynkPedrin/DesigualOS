import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type {
  PipelineBoardWire,
  PipelineCardWire,
  PipelineStageWire,
  PipelinesResponseWire,
} from '@/lib/api/contracts';

const CHAVE = ['pipelines'] as const;

/**
 * Os quadros que esta pessoa vê: os da AGÊNCIA mais os DELA. O recorte é
 * feito no servidor — a tela nunca recebe quadro pessoal de outra pessoa pra
 * filtrar depois, porque filtro de visibilidade no cliente é filtro que já
 * entregou o dado.
 */
export function usePipelines() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () => apiFetch<PipelinesResponseWire>('/pipelines'),
  });
}

export function useCriarPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entrada: {
      nome: string;
      tipo: PipelineBoardWire['tipo'];
      escopo: PipelineBoardWire['escopo'];
      stages: PipelineStageWire[];
    }) => apiFetch<PipelineBoardWire>('/pipelines', { method: 'POST', body: JSON.stringify(entrada) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useAtualizarPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, ...corpo }: { boardId: string; nome?: string; stages?: PipelineStageWire[]; posicao?: number }) =>
      apiFetch<PipelineBoardWire>(`/pipelines/${boardId}`, { method: 'PATCH', body: JSON.stringify(corpo) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useApagarPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (boardId: string) => apiFetch<null>(`/pipelines/${boardId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useCriarCartao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, ...corpo }: {
      boardId: string;
      stage_id: string;
      name: string;
      client_id?: string | null;
      responsavel?: string | null;
      valor?: string | null;
      nota?: string;
    }) => apiFetch<PipelineCardWire>(`/pipelines/${boardId}/cards`, { method: 'POST', body: JSON.stringify(corpo) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

/**
 * MOVER CARTÃO É OTIMISTA, e precisa ser.
 *
 * Arrastar um cartão e ele voltar pra coluna de origem até o servidor
 * responder é a diferença entre um quadro que parece seu e um que parece de
 * outra pessoa. A ida e volta até a API é curta, mas não é zero.
 *
 * Em caso de erro o estado anterior é restaurado — o cartão volta sozinho pra
 * onde estava, que é a única coisa honesta a fazer quando o servidor recusou.
 */
export function useMoverCartao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, cardId, stage_id }: { boardId: string; cardId: string; stage_id: string }) =>
      apiFetch<PipelineCardWire>(`/pipelines/${boardId}/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage_id }),
      }),
    onMutate: async ({ cardId, stage_id }) => {
      await qc.cancelQueries({ queryKey: CHAVE });
      const anterior = qc.getQueryData<PipelinesResponseWire>(CHAVE);
      qc.setQueryData<PipelinesResponseWire>(CHAVE, (atual) =>
        atual
          ? {
              boards: atual.boards.map((b) => ({
                ...b,
                cards: b.cards.map((c) => (c.id === cardId ? { ...c, stage_id } : c)),
              })),
            }
          : atual,
      );
      return { anterior };
    },
    onError: (_erro, _entrada, contexto) => {
      if (contexto?.anterior) qc.setQueryData(CHAVE, contexto.anterior);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useApagarCartao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, cardId }: { boardId: string; cardId: string }) =>
      apiFetch<null>(`/pipelines/${boardId}/cards/${cardId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
