import { describe, expect, it } from 'vitest';
import { DESFECHOS_DE_PESSOA, RECUSA_DE_STATUS, ehDesfechoDePessoa } from './tratamento';

/**
 * A cerca do PATCH /signals/:id, verificada aqui em vez de só na mão.
 *
 * Conferi os quatro comportamentos contra a API viva antes de escrever isto
 * (status inválido recusado, id inexistente 404, resolver funciona, sinal
 * resolvido some dos pendentes). Verificação manual não sobrevive à próxima
 * mudança — e a parte que mais depende de julgamento, que é QUAIS valores uma
 * pessoa pode escrever, é justamente a que alguém "amplia" sem pensar.
 */
describe('desfechos que uma pessoa pode dar a um sinal', () => {
  it('aceita os dois desfechos humanos', () => {
    expect(ehDesfechoDePessoa('resolved')).toBe(true);
    expect(ehDesfechoDePessoa('dismissed')).toBe(true);
  });

  /**
   * O ponto inteiro do módulo: 'pending' e 'delivered' são do SISTEMA. Deixar a
   * tela escrevê-los faria o estado mentir sobre quem agiu — um sinal voltaria
   * a "pendente" sem nada ter mudado no mundo, ou apareceria como "entregue"
   * porque alguém clicou.
   */
  it('recusa os estados que pertencem ao sistema', () => {
    expect(ehDesfechoDePessoa('pending')).toBe(false);
    expect(ehDesfechoDePessoa('delivered')).toBe(false);
    expect(ehDesfechoDePessoa('acknowledged')).toBe(false);
  });

  it('recusa lixo sem explodir', () => {
    expect(ehDesfechoDePessoa(undefined)).toBe(false);
    expect(ehDesfechoDePessoa(null)).toBe(false);
    expect(ehDesfechoDePessoa(42)).toBe(false);
    expect(ehDesfechoDePessoa('')).toBe(false);
    expect(ehDesfechoDePessoa({ status: 'resolved' })).toBe(false);
  });

  /**
   * `resolved` e `dismissed` afirmam coisas diferentes — "o problema acabou" e
   * "o problema não existia" — e é essa diferença que permite descobrir depois
   * que uma regra gera alarme falso. Se alguém colapsar as duas num "fechado",
   * este teste cai junto e obriga a decisão a ser consciente.
   */
  it('mantém os dois desfechos separados, que é o que revela regra de alarme falso', () => {
    expect(DESFECHOS_DE_PESSOA).toHaveLength(2);
    expect([...DESFECHOS_DE_PESSOA]).toEqual(['dismissed', 'resolved']);
  });

  /** A recusa diz o que VALE, não só que não vale. */
  it('a mensagem de recusa lista as opções válidas', () => {
    for (const d of DESFECHOS_DE_PESSOA) expect(RECUSA_DE_STATUS).toContain(d);
  });
});
