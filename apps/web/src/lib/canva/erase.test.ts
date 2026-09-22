import { describe, expect, it } from 'vitest';
import {
  circleIntersectsRect,
  classifyEraseTarget,
  eraserRadii,
  interpolateErasePoints,
  localToBitmapPoint,
} from './erase';

describe('classifyEraseTarget', () => {
  it('paths e imagens são apagáveis, o resto não', () => {
    expect(classifyEraseTarget('path')).toBe('path');
    expect(classifyEraseTarget('image')).toBe('image');
    expect(classifyEraseTarget('text')).toBeNull();
    expect(classifyEraseTarget('shape')).toBeNull();
    expect(classifyEraseTarget('group')).toBeNull();
    expect(classifyEraseTarget(undefined)).toBeNull();
  });
});

describe('circleIntersectsRect', () => {
  const rect = { left: 100, top: 100, width: 50, height: 50 };

  it('centro dentro da caixa é hit', () => {
    expect(circleIntersectsRect({ x: 120, y: 120, radius: 4 }, rect)).toBe(true);
  });

  it('fora da caixa mas dentro do raio é hit (proximidade)', () => {
    expect(circleIntersectsRect({ x: 90, y: 120, radius: 12 }, rect)).toBe(true);
  });

  it('fora do alcance do raio não é hit', () => {
    expect(circleIntersectsRect({ x: 80, y: 120, radius: 12 }, rect)).toBe(false);
  });

  it('canto da caixa usa distância euclidiana, não Manhattan', () => {
    // distância do centro ao canto (100,100): sqrt(8^2+8^2) ≈ 11.3
    expect(circleIntersectsRect({ x: 92, y: 92, radius: 12 }, rect)).toBe(true);
    expect(circleIntersectsRect({ x: 92, y: 92, radius: 10 }, rect)).toBe(false);
  });
});

describe('localToBitmapPoint', () => {
  it('centro do objeto vira centro do bitmap', () => {
    expect(localToBitmapPoint({ x: 0, y: 0 }, { width: 200, height: 100 })).toEqual({ x: 100, y: 50 });
  });

  it('canto superior esquerdo local vira (0,0)', () => {
    expect(localToBitmapPoint({ x: -100, y: -50 }, { width: 200, height: 100 })).toEqual({ x: 0, y: 0 });
  });
});

describe('eraserRadii', () => {
  it('sem escala, o raio é metade da largura', () => {
    expect(eraserRadii(20, 1, 1)).toEqual({ rx: 10, ry: 10 });
  });

  it('escala anisotrópica vira elipse no bitmap (círculo na tela)', () => {
    const { rx, ry } = eraserRadii(20, 2, 0.5);
    expect(rx).toBeCloseTo(5);
    expect(ry).toBeCloseTo(20);
  });

  it('escala zero/negativa (flip) não gera divisão por zero', () => {
    const { rx } = eraserRadii(20, 0, -1);
    expect(Number.isFinite(rx)).toBe(true);
  });
});

describe('interpolateErasePoints', () => {
  it('inclui o ponto final e cobre a distância com passos curtos', () => {
    const pontos = interpolateErasePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 10);
    expect(pontos[pontos.length - 1]).toEqual({ x: 100, y: 0 });
    for (let i = 1; i < pontos.length; i += 1) {
      const d = Math.hypot(pontos[i]!.x - pontos[i - 1]!.x, pontos[i]!.y - pontos[i - 1]!.y);
      expect(d).toBeLessThanOrEqual(5.001); // passo = min(rx,ry)/2
    }
  });

  it('arrasto mínimo gera ao menos o próprio ponto', () => {
    expect(interpolateErasePoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 10, 10)).toHaveLength(1);
  });
});
