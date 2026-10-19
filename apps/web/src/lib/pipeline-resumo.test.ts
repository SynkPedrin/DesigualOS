import { describe, expect, it } from 'vitest';
import { lerValorEmCentavos, resumoDoQuadro, formatarCentavos } from './pipeline-resumo';
import type { PipelineStage } from '@/mocks/pipeline';

/**
 * O valor do cartão é TEXTO LIVRE no banco — foi assim que a tela nasceu, e
 * somar texto livre em silêncio é como se produz um número errado com cara de
 * certo. Um cartão escrito de outro jeito encolhe a soma e ninguém percebe.
 */
describe('lerValorEmCentavos', () => {
  it.each([
    ['R$ 4.500', 450_000],
    ['R$ 4.500,50', 450_050],
    ['12.000', 1_200_000],
    ['1800', 180_000],
    ['R$ 3.500/mês', 350_000],
    ['R$ 1.234.567,89', 123_456_789],
  ])('%s -> %i centavos', (texto, esperado) => {
    expect(lerValorEmCentavos(texto)).toBe(esperado);
  });

  /**
   * Ponto é MILHAR no formato brasileiro. Lido como decimal, "12.000" vira
   * doze reais — a soma do quadro inteiro é dividida por mil e continua
   * parecendo plausível.
   */
  it('ponto é milhar, não decimal', () => {
    expect(lerValorEmCentavos('12.000')).toBe(1_200_000);
    expect(lerValorEmCentavos('12,00')).toBe(1_200);
  });

  /** "a definir" não é zero: zero entraria na soma como se fosse valor conhecido. */
  it.each([null, '', 'a definir', 'sob consulta', '-'])('%s não vira zero', (texto) => {
    expect(lerValorEmCentavos(texto as string | null)).toBeNull();
  });
});

const estagios: PipelineStage[] = [
  { id: 'a', label: 'Novo', color: 'info' },
  { id: 'b', label: 'Fechado', color: 'sinal' },
];
const card = (stageId: string, valor: string | null) => ({ stageId, valor });

describe('resumoDoQuadro', () => {
  it('conta e soma por coluna, com a proporção do total', () => {
    const r = resumoDoQuadro(estagios, [card('a', 'R$ 1.000'), card('a', 'R$ 500'), card('b', 'R$ 2.000')]);
    expect(r.total).toBe(3);
    expect(r.estagios[0]!.quantidade).toBe(2);
    expect(r.estagios[0]!.somaCentavos).toBe(150_000);
    expect(r.estagios[0]!.proporcao).toBeCloseTo(2 / 3);
    expect(r.somaCentavos).toBe(350_000);
  });

  /**
   * O cartão sem valor legível é CONTADO, não somado. É isso que permite a
   * tela dizer "R$ 1.000 · 1 sem valor" em vez de afirmar um total que não
   * cobre o quadro inteiro.
   */
  it('cartão sem valor legível aparece separado, não como zero', () => {
    const r = resumoDoQuadro(estagios, [card('a', 'R$ 1.000'), card('a', 'a definir')]);
    expect(r.estagios[0]!.quantidade).toBe(2);
    expect(r.estagios[0]!.somaCentavos).toBe(100_000);
    expect(r.estagios[0]!.semValor).toBe(1);
    expect(r.semValor).toBe(1);
  });

  it('quadro vazio não divide por zero', () => {
    const r = resumoDoQuadro(estagios, []);
    expect(r.total).toBe(0);
    expect(r.estagios[0]!.proporcao).toBeNull();
    expect(r.somaCentavos).toBe(0);
  });

  it('cartão em coluna que não existe mais não entra em coluna nenhuma', () => {
    const r = resumoDoQuadro(estagios, [card('coluna-apagada', 'R$ 900')]);
    expect(r.estagios.every((e) => e.quantidade === 0)).toBe(true);
    expect(r.total).toBe(1);
  });

  it('formata em real sem centavos quando é valor redondo', () => {
    expect(formatarCentavos(450_000)).toMatch(/4\.500/);
  });
});
