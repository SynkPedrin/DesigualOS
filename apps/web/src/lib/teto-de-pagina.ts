/**
 * O TETO DA PÁGINA, DITO EM VOZ ALTA.
 *
 * `/inbox/threads`, `/approvals` e `/demands` são paginadas e devolvem no
 * máximo 30 linhas por padrão (`limit` com `.default(30)` nos três schemas, e
 * `.max(100)` como teto duro). O front nunca mandava `limit`, então herdava
 * esses 30 sem saber: uma tela que contava `data.length` e estampava o número
 * como total estava, na verdade, contando O QUE COUBE.
 *
 * Com mais de 30 conversas esperando resposta, o cartão "Conversas não
 * respondidas" mostrava 30, sem nenhum sinal de que havia mais. Um número
 * baixo demais num painel de pendências é pior que nenhum número: ele diz
 * que a fila está sob controle.
 *
 * Mandar o limite daqui não aumenta o que cabe; o que muda é que a tela passa
 * a CONHECER o próprio teto, e pode dizer "30+" em vez de "30" quando a página
 * vem cheia. A alternativa de verdade é uma contagem no servidor, que não
 * existe hoje e não se inventa no cliente.
 */
export const TETO_DE_PAGINA = 30;

/** `true` quando a página voltou cheia, ou seja, o número é um PISO e não um total. */
export function veioCheia(n: number | undefined, teto = TETO_DE_PAGINA): boolean {
  return n !== undefined && n >= teto;
}

/** "30+" quando é piso, "12" quando é total. Nunca um total que não foi contado. */
export function comoPiso(valor: number, teto = TETO_DE_PAGINA): string {
  return valor >= teto ? `${teto}+` : valor.toLocaleString('pt-BR');
}
