export type SituacaoDoLancamento = 'aberto' | 'vencido' | 'quitado' | 'cancelado';

export interface LancamentoParaSituacao {
  /** O banco guarda texto (com CHECK); um valor fora da lista é bug de dado e não pode virar "aberto" em silêncio. */
  status: string;
  dueDate: string;
}

/**
 * "Vencido" NÃO é gravado: é um lançamento aberto cujo vencimento já passou. Guardar isso
 * deixaria o dado errado na manhã seguinte sem que ninguém tivesse tocado nele. Vence no dia
 * seguinte ao vencimento: no próprio dia ainda está "aberto".
 */
export function situacaoDe(l: LancamentoParaSituacao, hoje: string): SituacaoDoLancamento {
  if (l.status === 'quitado' || l.status === 'cancelado') return l.status;
  if (l.status !== 'aberto') throw new Error(`Status de lançamento desconhecido: "${l.status}".`);
  return l.dueDate < hoje ? 'vencido' : 'aberto';
}
