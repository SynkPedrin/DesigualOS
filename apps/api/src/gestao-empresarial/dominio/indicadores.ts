export const AVISO_HISTORICO_PARCIAL =
  'Histórico importado parcialmente. Indicadores financeiros consolidados podem não representar a operação completa.';

export interface LancamentoParaIndicador {
  kind: 'receita' | 'despesa';
  status: 'aberto' | 'quitado' | 'cancelado';
  amountCents: number;
  paidAmountCents?: number | null;
}

/**
 * Totais por situação. CANCELADO NÃO É RECEITA: na importação do Operand, 60% do valor bruto
 * (R$ 192.095,10 de R$ 319.451,59) era cancelado. Somar o bruto inflaria a receita em mais do dobro.
 */
export function totaisPorSituacao(lancamentos: readonly LancamentoParaIndicador[]) {
  const t = { receitaRecebida: 0, receitaAberta: 0, despesaPaga: 0, despesaAberta: 0, cancelado: 0 };
  for (const l of lancamentos) {
    if (l.status === 'cancelado') {
      t.cancelado += l.amountCents;
      continue;
    }
    const valor = l.status === 'quitado' ? (l.paidAmountCents ?? l.amountCents) : l.amountCents;
    if (l.kind === 'receita') t[l.status === 'quitado' ? 'receitaRecebida' : 'receitaAberta'] += valor;
    else t[l.status === 'quitado' ? 'despesaPaga' : 'despesaAberta'] += valor;
  }
  return { ...t, resultadoRealizado: t.receitaRecebida - t.despesaPaga };
}

/**
 * O histórico é parcial enquanto houver receita sem NENHUMA despesa registrada: um "resultado"
 * calculado assim parece lucro e é só falta de dado. A tela mostra o aviso junto de qualquer
 * indicador consolidado.
 */
export function historicoParcial(lancamentos: readonly LancamentoParaIndicador[]): boolean {
  const temReceita = lancamentos.some((l) => l.kind === 'receita' && l.status !== 'cancelado');
  const temDespesa = lancamentos.some((l) => l.kind === 'despesa');
  return temReceita && !temDespesa;
}
