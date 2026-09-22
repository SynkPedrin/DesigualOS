import { describe, expect, it } from 'vitest';
import { melhorEncaixe, SCREEN_SNAP_TOLERANCE, snapTolerance } from './snap';

describe('snapTolerance', () => {
  /** O ponto do gate: a sensação de encaixe tem que ser a MESMA nos 3 zooms. */
  it('compensa o zoom para manter a tolerância constante na TELA', () => {
    for (const zoom of [0.25, 1, 4]) {
      const emDocumento = snapTolerance(zoom);
      expect(emDocumento * zoom).toBeCloseTo(SCREEN_SNAP_TOLERANCE, 6);
    }
  });

  it('a 25% tolera mais documento; a 400%, menos', () => {
    expect(snapTolerance(0.25)).toBeGreaterThan(snapTolerance(1));
    expect(snapTolerance(4)).toBeLessThan(snapTolerance(1));
  });

  it('zoom inválido não gera tolerância infinita', () => {
    expect(snapTolerance(0)).toBe(SCREEN_SNAP_TOLERANCE);
    expect(snapTolerance(Number.NaN)).toBe(SCREEN_SNAP_TOLERANCE);
  });
});

describe('melhorEncaixe', () => {
  const borda = (atual: number) => ({ atual, posicaoSeEncaixar: (alvo: number) => alvo });

  it('encaixa no alvo dentro da tolerância', () => {
    expect(melhorEncaixe([borda(98)], [100], 7)).toEqual({ posicao: 100, guia: 100 });
  });

  it('não encaixa fora da tolerância', () => {
    expect(melhorEncaixe([borda(80)], [100], 7)).toBeNull();
  });

  /** Sem isso, a ordem do array decide o encaixe - o "snap caótico". */
  it('com alvos competindo, escolhe o de MENOR deslocamento', () => {
    const r = melhorEncaixe([borda(103)], [100, 105, 110], 7);
    expect(r!.guia).toBe(105);
  });

  it('considera várias âncoras do objeto (borda e centro)', () => {
    const r = melhorEncaixe(
      [
        { atual: 50, posicaoSeEncaixar: (a) => a },
        { atual: 99, posicaoSeEncaixar: (a) => a - 49 },
      ],
      [100],
      7,
    );
    // O centro (99) está a 1 do alvo; a borda (50) está a 50. Ganha o centro.
    expect(r).toEqual({ posicao: 51, guia: 100 });
  });

  it('sem alvos devolve null', () => {
    expect(melhorEncaixe([borda(10)], [], 7)).toBeNull();
  });
});

describe('tolerância nos extremos de zoom (G2-06)', () => {
  /**
   * O que precisa ser verdade: a distância em PIXELS DE TELA na qual o
   * objeto encaixa é a mesma em qualquer zoom. Em 25% a tolerância no
   * documento tem que ser maior (cada pixel de tela vale 4 do documento) e
   * em 400% menor (cada pixel de tela vale 1/4).
   */
  it.each([
    [0.25, 28],
    [1, 7],
    [4, 1.75],
  ])('zoom %s: tolerância de documento = %s', (zoom, esperado) => {
    expect(snapTolerance(zoom)).toBeCloseTo(esperado, 6);
  });

  it('o mesmo alvo encaixa na MESMA posição em 25%, 100% e 400%', () => {
    // Objeto com a borda esquerda a 3px de tela do alvo, nos três zooms.
    for (const zoom of [0.25, 1, 4]) {
      const distanciaNoDocumento = 3 / zoom;
      const encaixe = melhorEncaixe(
        [{ atual: 440 + distanciaNoDocumento, posicaoSeEncaixar: (alvo) => alvo }],
        [440],
        snapTolerance(zoom),
      );
      expect(encaixe?.posicao).toBe(440);
    }
  });

  it('a 400% um desvio de 8px de tela NÃO encaixa (precisão é o ponto do zoom)', () => {
    const zoom = 4;
    const encaixe = melhorEncaixe(
      [{ atual: 440 + 8 / zoom, posicaoSeEncaixar: (alvo) => alvo }],
      [440],
      snapTolerance(zoom),
    );
    expect(encaixe).toBeNull();
  });

  it('a 25% o mesmo desvio de 8px de tela também não encaixa', () => {
    const zoom = 0.25;
    const encaixe = melhorEncaixe(
      [{ atual: 440 + 8 / zoom, posicaoSeEncaixar: (alvo) => alvo }],
      [440],
      snapTolerance(zoom),
    );
    expect(encaixe).toBeNull();
  });
});
