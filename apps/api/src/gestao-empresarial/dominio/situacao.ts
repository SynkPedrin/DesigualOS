export type SituacaoDoLancamento = 'aberto' | 'vencido' | 'quitado' | 'cancelado';

export interface LancamentoParaSituacao {
  status: 'aberto' | 'quitado' | 'cancelado';
  dueDate: string;
}

/**
 * "Vencido" NÃO é gravado: é um lançamento aberto cujo vencimento já passou. Guardar isso
 * deixaria o dado errado na manhã seguinte sem que ninguém tivesse tocado nele. Vence no dia
 * seguinte ao vencimento: no próprio dia ainda está "aberto".
 */
export function situacaoDe(l: LancamentoParaSituacao, hoje: string): SituacaoDoLancamento {
  if (l.status !== 'aberto') return l.status;
  return l.dueDate < hoje ? 'vencido' : 'aberto';
}
