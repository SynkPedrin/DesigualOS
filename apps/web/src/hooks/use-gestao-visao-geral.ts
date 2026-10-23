import { useQuery } from '@tanstack/react-query';
import { gestaoApi } from './use-gestao-empresarial';

export interface ValorEQuantidade {
  quantidade: number;
  totalCents: number;
}

export interface VisaoGeralWire {
  receita: { recebida: number; aberta: number };
  despesa: { paga: number; aberta: number };
  cancelado: { receita: number; despesa: number };
  vencidos: { receita: ValorEQuantidade; despesa: ValorEQuantidade };
  proximos7Dias: { receita: ValorEQuantidade; despesa: ValorEQuantidade };
  saldo: { totalCents: number; contasComSaldo: number; contasSemSaldoInicial: number };
  pagamentosSemData: number;
  importacaoPendente: { linhas: number; lotes: number };
  historicoParcial: boolean;
  aviso: string | null;
}

export function useVisaoGeral() {
  return useQuery({ queryKey: ['gestao-empresarial', 'visao-geral'], queryFn: () => gestaoApi.get<VisaoGeralWire>('/visao-geral') });
}
