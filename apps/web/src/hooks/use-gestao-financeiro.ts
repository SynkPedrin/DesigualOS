import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gestaoApi, type Paginado } from './use-gestao-empresarial';

export type Kind = 'receita' | 'despesa';
export type Situacao = 'aberto' | 'vencido' | 'quitado' | 'cancelado';

export interface LancamentoWire {
  id: string;
  kind: Kind;
  partyId: string | null;
  partyLabel: string | null;
  description: string;
  amountCents: number;
  competenceDate: string | null;
  dueDate: string;
  status: 'aberto' | 'quitado' | 'cancelado';
  paidAt: string | null;
  paidAtUnknown: boolean;
  paidAmountCents: number | null;
  accountId: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  installmentNo: number | null;
  installmentTotal: number | null;
  docNumber: string | null;
  cancelReason: string | null;
  situacao: Situacao;
}

export interface ListaDeLancamentos extends Paginado<LancamentoWire> {
  somaCentavos: number;
}

export interface ContaWire {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  openingBalanceCents: number | null;
  movementCents: number;
  balanceCents: number | null;
}
export interface CategoriaWire { id: string; name: string; kind: Kind; parentId: string | null; active: boolean }
export interface CentroWire { id: string; name: string; active: boolean }
export interface PessoaResumoWire { id: string; name: string; roles: string[] }

export interface RecorrenciaWire {
  id: string;
  kind: Kind;
  description: string;
  amountCents: number;
  frequency: string;
  startDate: string;
  endDate: string | null;
  dayOfMonth: number | null;
  generatedUntil: string | null;
  active: boolean;
}

export interface FluxoWire {
  meses: Array<{ mes: string; aReceber: number; aPagar: number; saldoDoMes: number; acumulado: number }>;
  vencidoACobrar: number;
  vencidoAPagar: number;
  contasSemSaldoInicial: number;
}

export interface LinhaExtratoWire { id: string; postedOn: string; description: string | null; amountCents: number; externalKey: string }
export interface SugestaoWire { linhaId: string; movimentoId: string | null; diasDeDiferenca: number | null; ambigua: boolean }

const RAIZ = ['gestao-empresarial'] as const;
const FIN = [...RAIZ, 'financeiro'] as const;

export interface FiltroLancamentos {
  kind: Kind;
  situacao?: Situacao | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
  page: number;
}
const TAMANHO = 25;

export const useLancamentos = (f: FiltroLancamentos) =>
  useQuery({
    queryKey: [...FIN, 'lancamentos', f],
    queryFn: () => gestaoApi.get<ListaDeLancamentos>('/financeiro/lancamentos', { ...f, pageSize: TAMANHO }),
    placeholderData: (anterior) => anterior,
  });

export const useContas = () => useQuery({ queryKey: [...FIN, 'contas'], queryFn: () => gestaoApi.get<{ items: ContaWire[] }>('/financeiro/contas') });
export const useCategorias = () => useQuery({ queryKey: [...FIN, 'categorias'], queryFn: () => gestaoApi.get<{ items: CategoriaWire[] }>('/financeiro/categorias') });
export const useCentros = () => useQuery({ queryKey: [...FIN, 'centros'], queryFn: () => gestaoApi.get<{ items: CentroWire[] }>('/financeiro/centros-de-custo') });
export const usePessoas = (q: string) =>
  useQuery({ queryKey: [...RAIZ, 'pessoas-busca', q], queryFn: () => gestaoApi.get<Paginado<PessoaResumoWire>>('/cadastros/pessoas', { q, status: 'ativo', pageSize: 20 }) });
export const useRecorrencias = () => useQuery({ queryKey: [...FIN, 'recorrencias'], queryFn: () => gestaoApi.get<{ items: RecorrenciaWire[] }>('/financeiro/recorrencias') });
export const useFluxo = () => useQuery({ queryKey: [...FIN, 'fluxo'], queryFn: () => gestaoApi.get<FluxoWire>('/financeiro/fluxo-de-caixa') });
export const useSugestoes = (contaId: string | null) =>
  useQuery({
    queryKey: [...FIN, 'sugestoes', contaId],
    enabled: !!contaId,
    queryFn: () => gestaoApi.get<{ linhas: LinhaExtratoWire[]; sugestoes: SugestaoWire[] }>(`/financeiro/extrato/${contaId}/sugestoes`),
  });

/** Qualquer escrita financeira muda totais, saldos e a visão geral: invalida tudo do módulo que depende disso. */
function useEscrita<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FIN });
      void qc.invalidateQueries({ queryKey: [...RAIZ, 'visao-geral'] });
    },
  });
}

export interface NovoLancamentoCorpo {
  kind: Kind;
  description: string;
  amountCents: number;
  dueDate: string;
  parcelas?: number | undefined;
  competenceDate?: string | null | undefined;
  partyId?: string | null | undefined;
  categoryId?: string | null | undefined;
  costCenterId?: string | null | undefined;
  accountId?: string | null | undefined;
  docNumber?: string | null | undefined;
}

export const useCriarLancamento = () => useEscrita((b: NovoLancamentoCorpo) => gestaoApi.post<{ items: LancamentoWire[] }>('/financeiro/lancamentos', b));
export const useEditarLancamento = () => useEscrita((v: { id: string; corpo: Partial<NovoLancamentoCorpo> }) => gestaoApi.patch<LancamentoWire>(`/financeiro/lancamentos/${v.id}`, v.corpo));
export const useBaixar = () => useEscrita((v: { id: string; accountId: string; paidOn: string; paidAmountCents?: number }) => gestaoApi.post<LancamentoWire>(`/financeiro/lancamentos/${v.id}/baixar`, { accountId: v.accountId, paidOn: v.paidOn, ...(v.paidAmountCents !== undefined && { paidAmountCents: v.paidAmountCents }) }));
export const useEstornar = () => useEscrita((v: { id: string; motivo: string }) => gestaoApi.post<LancamentoWire>(`/financeiro/lancamentos/${v.id}/estornar`, { motivo: v.motivo }));
export const useCancelar = () => useEscrita((v: { id: string; motivo: string }) => gestaoApi.post<LancamentoWire>(`/financeiro/lancamentos/${v.id}/cancelar`, { motivo: v.motivo }));
export const useCriarConta = () => useEscrita((b: { name: string; kind: string; openingBalanceCents: number | null; openingDate: string | null }) => gestaoApi.post<ContaWire>('/financeiro/contas', b));
export const useTransferir = () => useEscrita((b: { fromAccountId: string; toAccountId: string; amountCents: number; occurredOn: string; memo?: string }) => gestaoApi.post('/financeiro/transferencias', b));
export const useCriarRecorrencia = () =>
  useEscrita((b: { kind: Kind; description: string; amountCents: number; frequency: string; startDate: string; endDate?: string | null; dayOfMonth?: number | null; partyId?: string | null; categoryId?: string | null; accountId?: string | null }) => gestaoApi.post<RecorrenciaWire>('/financeiro/recorrencias', b));
export const useGerarRecorrencias = () => useEscrita((b: { ate: string; recorrenciaId?: string }) => gestaoApi.post<{ criados: number }>('/financeiro/recorrencias/gerar', b));
export const useImportarExtrato = () => useEscrita((v: { contaId: string; linhas: Array<{ postedOn: string; description?: string; amountCents: number; externalKey: string }> }) => gestaoApi.post<{ recebidas: number; novas: number; jaExistiam: number }>(`/financeiro/extrato/${v.contaId}/importar`, { linhas: v.linhas }));
export const useConciliar = () => useEscrita((v: { linhaId: string; ledgerId: string }) => gestaoApi.post('/financeiro/conciliacao', v));
export const useDesconciliar = () => useEscrita((linhaId: string) => gestaoApi.del(`/financeiro/conciliacao/${linhaId}`));
