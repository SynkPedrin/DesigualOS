import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gestaoApi, type Paginado } from './use-gestao-empresarial';

export type StatusDaProposta = 'rascunho' | 'enviada' | 'aprovada' | 'recusada' | 'expirada' | 'cancelada';
export type StatusDoContrato = 'rascunho' | 'vigente' | 'encerrado' | 'cancelado';
export type StatusDoPedido = 'aberto' | 'faturado' | 'cancelado';

/** As mesmas transições da API (dominio/comercial.ts): a tela só oferece o que o servidor aceitaria. */
export const TRANSICOES_PROPOSTA: Record<StatusDaProposta, StatusDaProposta[]> = {
  rascunho: ['enviada', 'cancelada'],
  enviada: ['aprovada', 'recusada', 'expirada', 'cancelada', 'rascunho'],
  aprovada: [],
  recusada: [],
  expirada: [],
  cancelada: [],
};
export const TRANSICOES_CONTRATO: Record<StatusDoContrato, StatusDoContrato[]> = { rascunho: ['vigente', 'cancelado'], vigente: ['encerrado', 'cancelado'], encerrado: [], cancelado: [] };

export interface PropostaWire {
  id: string;
  number: string;
  partyId: string | null;
  title: string;
  status: StatusDaProposta;
  validUntil: string | null;
  notes: string | null;
  totalCents: number;
  createdAt: string;
}
export interface ItemDePropostaWire {
  id?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  serviceId?: string | null;
}
export interface PropostaDetalheWire extends PropostaWire {
  items: ItemDePropostaWire[];
}
export interface ContratoWire {
  id: string;
  number: string;
  partyId: string | null;
  proposalId: string | null;
  title: string;
  status: StatusDoContrato;
  totalCents: number;
  startsOn: string | null;
  endsOn: string | null;
}
export interface PedidoDeVendaWire {
  id: string;
  number: string;
  partyId: string | null;
  proposalId: string | null;
  title: string;
  status: StatusDoPedido;
  totalCents: number;
}
export interface FaturamentoWire {
  pedido: PedidoDeVendaWire;
  lancamentos: Array<{ id: string; dueDate: string; amountCents: number; installmentNo: number | null; installmentTotal: number | null }>;
}
export interface PessoaResumoWire {
  id: string;
  name: string;
  document: string | null;
  roles: string[];
}

const K = ['gestao-empresarial'] as const;

export function usePropostas(f: { page: number; status?: string; q?: string }) {
  return useQuery({ queryKey: [...K, 'propostas', f], queryFn: () => gestaoApi.get<Paginado<PropostaWire>>('/comercial/propostas', { ...f, pageSize: 25 }), placeholderData: keepPreviousData });
}
export function useProposta(id: string) {
  return useQuery({ queryKey: [...K, 'proposta', id], queryFn: () => gestaoApi.get<PropostaDetalheWire>(`/comercial/propostas/${id}`) });
}
export function useContratos(f: { page: number; status?: string }) {
  return useQuery({ queryKey: [...K, 'contratos', f], queryFn: () => gestaoApi.get<Paginado<ContratoWire>>('/comercial/contratos', { ...f, pageSize: 25 }), placeholderData: keepPreviousData });
}
export function usePedidosDeVenda(f: { page: number; status?: string }) {
  return useQuery({ queryKey: [...K, 'pedidos-de-venda', f], queryFn: () => gestaoApi.get<Paginado<PedidoDeVendaWire>>('/comercial/pedidos', { ...f, pageSize: 25 }), placeholderData: keepPreviousData });
}

/** Busca cadastros por papel (cliente, fornecedor...) para os seletores. */
export function usePessoas(role: string, q: string) {
  return useQuery({ queryKey: [...K, 'pessoas-seletor', role, q], queryFn: () => gestaoApi.get<Paginado<PessoaResumoWire>>('/cadastros/pessoas', { role, q, status: 'ativo', pageSize: 20 }), staleTime: 30_000 });
}
export function usePessoasPorId(ids: Array<string | null>) {
  const unicos = [...new Set(ids.filter((i): i is string => !!i))].sort();
  return useQuery({
    queryKey: [...K, 'pessoas-por-id', unicos],
    enabled: unicos.length > 0,
    queryFn: async () => Object.fromEntries((await Promise.all(unicos.map((id) => gestaoApi.get<PessoaResumoWire>(`/cadastros/pessoas/${id}`).catch(() => null)))).filter((p): p is PessoaResumoWire => !!p).map((p) => [p.id, p.name])) as Record<string, string>,
    staleTime: 60_000,
  });
}

export function useComercialAcoes() {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: K });
  return {
    criarProposta: useMutation({ mutationFn: (c: { partyId?: string | null; title: string; validUntil?: string | null; notes?: string | null; items: ItemDePropostaWire[] }) => gestaoApi.post<PropostaWire>('/comercial/propostas', c), onSuccess: refrescar }),
    editarProposta: useMutation({ mutationFn: ({ id, ...c }: { id: string; partyId?: string | null; title?: string; validUntil?: string | null; notes?: string | null; items?: ItemDePropostaWire[] }) => gestaoApi.patch<PropostaDetalheWire>(`/comercial/propostas/${id}`, c), onSuccess: refrescar }),
    statusProposta: useMutation({ mutationFn: ({ id, status }: { id: string; status: StatusDaProposta }) => gestaoApi.post<PropostaWire>(`/comercial/propostas/${id}/status`, { status }), onSuccess: refrescar }),
    criarContrato: useMutation({ mutationFn: (c: { proposalId: string; startsOn?: string | null; endsOn?: string | null }) => gestaoApi.post<ContratoWire>('/comercial/contratos', c), onSuccess: refrescar }),
    statusContrato: useMutation({ mutationFn: ({ id, status }: { id: string; status: StatusDoContrato }) => gestaoApi.post<ContratoWire>(`/comercial/contratos/${id}/status`, { status }), onSuccess: refrescar }),
    criarPedido: useMutation({ mutationFn: (c: { proposalId: string }) => gestaoApi.post<PedidoDeVendaWire>('/comercial/pedidos', c), onSuccess: refrescar }),
    faturar: useMutation({ mutationFn: ({ id, ...c }: { id: string; parcelas: number; primeiroVencimento: string }) => gestaoApi.post<FaturamentoWire>(`/comercial/pedidos/${id}/faturar`, c), onSuccess: refrescar }),
    cancelarPedido: useMutation({ mutationFn: (id: string) => gestaoApi.post<PedidoDeVendaWire>(`/comercial/pedidos/${id}/cancelar`), onSuccess: refrescar }),
  };
}
