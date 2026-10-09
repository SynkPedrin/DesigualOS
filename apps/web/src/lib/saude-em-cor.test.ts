import { describe, expect, it } from 'vitest';
import { saudeEmCor } from './saude-em-cor';

/**
 * A cor do número de saúde fica no rodapé de TODAS as telas, então ela é lida
 * mais vezes que qualquer outro indicador do produto. Até 09/10/2026 era
 * `text-sinal` fixa: 20% e 82% saíam iguais, e uma cor que não muda com o valor
 * não informa nada — só parece alarme permanente.
 *
 * O que estes testes travam é que a régua continue significando o que diz, e em
 * particular que ela NUNCA fique otimista por falta de leitura.
 */
describe('saudeEmCor', () => {
  it('90% ou mais é verde', () => {
    expect(saudeEmCor(100)).toBe('text-sucesso');
    expect(saudeEmCor(90)).toBe('text-sucesso');
  });

  it('entre 60 e 89 é aviso: degradado, dá pra trabalhar', () => {
    expect(saudeEmCor(89)).toBe('text-aviso');
    expect(saudeEmCor(82)).toBe('text-aviso');
    expect(saudeEmCor(60)).toBe('text-aviso');
  });

  it('abaixo de 60 é erro, e 20% não vira verde por ninguém gostar do vermelho', () => {
    expect(saudeEmCor(59)).toBe('text-erro');
    expect(saudeEmCor(20)).toBe('text-erro');
    expect(saudeEmCor(0)).toBe('text-erro');
  });

  /**
   * O caso que importa mais que os outros três: sem leitura, a resposta é
   * cinza. Não saber não é estar bem, e a tentação de tratar ausência como
   * sucesso é exatamente o que fez o painel estampar "Saúde geral 100%" com o
   * worker morto havia dez minutos, em 10/09/2026.
   */
  it('sem leitura é cinza, nunca verde', () => {
    expect(saudeEmCor(null)).toBe('text-nevoa');
  });
});
