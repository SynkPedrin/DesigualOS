import { useQuery } from '@tanstack/react-query';
import { apiBlob } from '@/lib/api/client';
import { GESTAO, gestaoApi, qs } from './use-gestao-empresarial';

export type FaixaDeAtraso = 'a_vencer' | '1_30' | '31_60' | '61_90' | 'mais_de_90';
export const ROTULO_DA_FAIXA: Record<FaixaDeAtraso, string> = { a_vencer: 'A vencer', '1_30': '1 a 30 dias', '31_60': '31 a 60 dias', '61_90': '61 a 90 dias', mais_de_90: 'Mais de 90 dias' };
export const ORDEM_DAS_FAIXAS: FaixaDeAtraso[] = ['a_vencer', '1_30', '31_60', '61_90', 'mais_de_90'];

export interface AtrasoWire {
  faixas: Record<FaixaDeAtraso, { quantidade: number; totalCents: number }>;
  totalCents: number;
  maiores: Array<{ nome: string; quantidade: number; totalCents: number; vencidoCents: number }>;
}
export interface LinhaDeCategoria {
  categoria: string;
  quantidade: number;
  totalCents: number;
}
export interface ResultadoWire {
  periodo: { de: string; ate: string };
  receitas: LinhaDeCategoria[];
  despesas: LinhaDeCategoria[];
  receitaTotalCents: number;
  despesaTotalCents: number;
  resultadoCents: number;
  lancamentosPorVencimento: number;
  historicoParcial: boolean;
  aviso: string | null;
}
export interface RentabilidadeWire {
  items: Array<{ numero: string; titulo: string; status: string; cliente: string | null; vendaCents: number | null; custoCents: number; margemCents: number; percentual: number | null }>;
}
export type FunilWire = Record<string, { quantidade: number; totalCents: number }>;

const K = ['gestao-empresarial', 'relatorios'] as const;

export const useAtraso = (kind: 'receita' | 'despesa') => useQuery({ queryKey: [...K, 'atraso', kind], queryFn: () => gestaoApi.get<AtrasoWire>('/relatorios/atraso', { kind }) });
export const useResultado = (de: string, ate: string) => useQuery({ queryKey: [...K, 'resultado', de, ate], queryFn: () => gestaoApi.get<ResultadoWire>('/relatorios/resultado', { de, ate }) });
export const useRentabilidade = () => useQuery({ queryKey: [...K, 'rentabilidade'], queryFn: () => gestaoApi.get<RentabilidadeWire>('/relatorios/rentabilidade-da-producao') });
export const useFunil = () => useQuery({ queryKey: [...K, 'funil'], queryFn: () => gestaoApi.get<FunilWire>('/relatorios/funil-comercial') });

/** Baixa o CSV de lançamentos como arquivo. Autenticado (por isso apiBlob, e não um link). */
export async function baixarCsvDeLancamentos(filtro: { kind?: string; situacao?: string; from?: string; to?: string }): Promise<void> {
  const blob = await apiBlob(`${GESTAO}/relatorios/lancamentos.csv${qs(filtro)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lancamentos.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
