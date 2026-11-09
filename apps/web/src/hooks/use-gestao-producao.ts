import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gestaoApi, type Paginado } from './use-gestao-empresarial';

export type StatusDaSolicitacao = 'aberta' | 'cotando' | 'aprovada' | 'cancelada';
export type StatusDoPedidoDeProducao = 'aberta' | 'em_producao' | 'entregue' | 'cancelada';

export const TRANSICOES_PEDIDO_DE_PRODUCAO: Record<StatusDoPedidoDeProducao, StatusDoPedidoDeProducao[]> = { aberta: ['em_producao', 'cancelada'], em_producao: ['entregue', 'cancelada'], entregue: [], cancelada: [] };

export interface SolicitacaoWire {
  id: string;
  number: string;
  partyId: string | null;
  title: string;
  description: string | null;
  status: StatusDaSolicitacao;
  dueOn: string | null;
}
export interface CotacaoWire {
  id: string;
  supplierId: string | null;
  fornecedor: string | null;
  totalCents: number;
  leadTimeDays: number | null;
  status: 'recebida' | 'escolhida' | 'descartada';
  notes: string | null;
  diferencaParaMenorCents: number | null;
}
export interface PedidoDeProducaoWire {
  id: string;
  number: string;
  requestId: string | null;
  supplierId: string | null;
  partyId: string | null;
  title: string;
  status: StatusDoPedidoDeProducao;
  saleCents: number | null;
  custoCents?: number;
  margemCents?: number;
  percentual?: number | null;
}
export interface CustoWire {
  id: string;
  description: string;
  amountCents: number;
  incurredOn: string | null;
  entryId: string | null;
}
export interface ResumoDoPedidoDeProducaoWire {
  pedido: PedidoDeProducaoWire;
  custos: CustoWire[];
  custoCents: number;
  margemCents: number;
  percentual: number | null;
}

const K = ['gestao-empresarial'] as const;

export function useSolicitacoes(f: { page: number; status?: string }) {
  return useQuery({ queryKey: [...K, 'solicitacoes', f], queryFn: () => gestaoApi.get<Paginado<SolicitacaoWire>>('/producao/solicitacoes', { ...f, pageSize: 25 }), placeholderData: keepPreviousData });
}
export function useCotacoes(id: string) {
  return useQuery({ queryKey: [...K, 'cotacoes', id], queryFn: () => gestaoApi.get<{ solicitacao: SolicitacaoWire; cotacoes: CotacaoWire[] }>(`/producao/solicitacoes/${id}/cotacoes`) });
}
export function usePedidosDeProducao(f: { page: number; status?: string }) {
  return useQuery({ queryKey: [...K, 'pedidos-de-producao', f], queryFn: () => gestaoApi.get<Paginado<PedidoDeProducaoWire>>('/producao/pedidos', { ...f, pageSize: 25 }), placeholderData: keepPreviousData });
}
export function usePedidoDeProducao(id: string) {
  return useQuery({ queryKey: [...K, 'pedido-de-producao', id], queryFn: () => gestaoApi.get<ResumoDoPedidoDeProducaoWire>(`/producao/pedidos/${id}`) });
}

export function useProducaoAcoes() {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: K });
  return {
    criarSolicitacao: useMutation({ mutationFn: (c: { partyId?: string | null; title: string; description?: string | null; dueOn?: string | null }) => gestaoApi.post<SolicitacaoWire>('/producao/solicitacoes', c), onSuccess: refrescar }),
    cancelarSolicitacao: useMutation({ mutationFn: (id: string) => gestaoApi.post<SolicitacaoWire>(`/producao/solicitacoes/${id}/cancelar`), onSuccess: refrescar }),
    registrarCotacao: useMutation({ mutationFn: ({ id, ...c }: { id: string; supplierId: string; totalCents: number; leadTimeDays?: number | null; notes?: string | null }) => gestaoApi.post<CotacaoWire>(`/producao/solicitacoes/${id}/cotacoes`, c), onSuccess: refrescar }),
    escolherCotacao: useMutation({ mutationFn: ({ id, quoteId }: { id: string; quoteId: string }) => gestaoApi.post<CotacaoWire>(`/producao/solicitacoes/${id}/cotacoes/${quoteId}/escolher`), onSuccess: refrescar }),
    criarPedido: useMutation({ mutationFn: (c: { requestId: string; title?: string; saleCents?: number | null }) => gestaoApi.post<PedidoDeProducaoWire>('/producao/pedidos', c), onSuccess: refrescar }),
    statusPedido: useMutation({ mutationFn: ({ id, status }: { id: string; status: StatusDoPedidoDeProducao }) => gestaoApi.post<PedidoDeProducaoWire>(`/producao/pedidos/${id}/status`, { status }), onSuccess: refrescar }),
    adicionarCusto: useMutation({ mutationFn: ({ id, ...c }: { id: string; description: string; amountCents: number; incurredOn?: string | null }) => gestaoApi.post<CustoWire>(`/producao/pedidos/${id}/custos`, c), onSuccess: refrescar }),
    gerarDespesa: useMutation({ mutationFn: ({ custoId, dueDate }: { custoId: string; dueDate: string }) => gestaoApi.post<{ id: string }>(`/producao/custos/${custoId}/gerar-despesa`, { dueDate }), onSuccess: refrescar }),
  };
}
