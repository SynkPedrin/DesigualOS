/**
 * tratamento.ts — quais desfechos uma PESSOA pode dar a um sinal.
 *
 * `proactive_signals.status` aceita cinco valores: 'pending', 'delivered',
 * 'acknowledged', 'dismissed', 'resolved'. Os dois primeiros são do SISTEMA —
 * 'pending' é como o sinal nasce, 'delivered' é o event bus registrando que
 * entregou. Deixar a tela escrevê-los faria o estado mentir sobre quem agiu:
 * um sinal voltaria a "pendente" sem nada ter mudado no mundo, ou apareceria
 * como "entregue" porque alguém clicou.
 *
 * Sobram os dois que só uma pessoa pode dar, e eles diferem no que AFIRMAM:
 *
 *   resolved ..... "cuidei disso". O problema existia e acabou.
 *   dismissed .... "não era problema". O problema não existia.
 *
 * A distinção não é burocrática: é o único jeito de descobrir depois que uma
 * regra está gerando alarme falso. Uma regra com muitos `dismissed` está
 * errada; uma com muitos `resolved` está fazendo o trabalho dela. Colapsar as
 * duas num "fechado" apagaria exatamente o dado que diz se o alerta vale a pena.
 */

export const DESFECHOS_DE_PESSOA = ['dismissed', 'resolved'] as const;

export type DesfechoDePessoa = (typeof DESFECHOS_DE_PESSOA)[number];

export function ehDesfechoDePessoa(valor: unknown): valor is DesfechoDePessoa {
  return typeof valor === 'string' && (DESFECHOS_DE_PESSOA as readonly string[]).includes(valor);
}

/** A mensagem de recusa. Diz o que vale, em vez de só dizer que não vale. */
export const RECUSA_DE_STATUS = `status deve ser ${DESFECHOS_DE_PESSOA.map((d) => `'${d}'`).join(' ou ')}`;
