import { describe, expect, it } from 'vitest';
import {
  buildStrokeOutline,
  decimateWithPressure,
  outlineToPathData,
  pressureToWidth,
  resolveBrushStyle,
  smoothingToDecimate,
  type BrushPoint,
} from './brush';

const linha = (n: number, pressure = 0.5): BrushPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0, pressure }));

describe('smoothingToDecimate', () => {
  it('cresce com a suavização e respeita os extremos', () => {
    expect(smoothingToDecimate(0)).toBeCloseTo(0.4);
    expect(smoothingToDecimate(50)).toBeCloseTo(0.4 + 0.25 * 11.6);
    expect(smoothingToDecimate(100)).toBeCloseTo(12);
  });

  it('clampa fora da faixa em vez de explodir', () => {
    expect(smoothingToDecimate(-10)).toBeCloseTo(0.4);
    expect(smoothingToDecimate(150)).toBeCloseTo(12);
  });
});

describe('pressureToWidth', () => {
  it('pressão 0.5 (mouse) devolve exatamente a largura base', () => {
    expect(pressureToWidth(10, 0.5)).toBeCloseTo(10);
  });

  it('pressão mínima não some (piso de 35%) e máxima engorda', () => {
    expect(pressureToWidth(10, 0)).toBeCloseTo(3.5);
    expect(pressureToWidth(10, 1)).toBeCloseTo(16.5);
  });

  it('pressão fora de 0-1 é clampada', () => {
    expect(pressureToWidth(10, -1)).toBeCloseTo(3.5);
    expect(pressureToWidth(10, 2)).toBeCloseTo(16.5);
  });
});

describe('resolveBrushStyle', () => {
  const base = { width: 10, opacity: 100, smoothing: 0 };

  it('lápis é opaco e sem firula', () => {
    const s = resolveBrushStyle({ ...base, type: 'lapis' });
    expect(s).toMatchObject({ width: 10, opacity: 1, composite: 'source-over', shadowBlur: 0 });
  });

  it('caneta é levemente translúcida com sombra curta', () => {
    const s = resolveBrushStyle({ ...base, type: 'caneta' });
    expect(s.opacity).toBeCloseTo(0.85);
    expect(s.shadowBlur).toBeGreaterThan(0);
    expect(s.composite).toBe('source-over');
  });

  it('marca-texto é largo, transparente e em multiply', () => {
    const s = resolveBrushStyle({ ...base, type: 'marca-texto' });
    expect(s.width).toBeCloseTo(25);
    expect(s.opacity).toBeCloseTo(0.4);
    expect(s.composite).toBe('multiply');
  });

  it('opacidade do usuário modula a do tipo', () => {
    const s = resolveBrushStyle({ ...base, type: 'caneta', opacity: 50 });
    expect(s.opacity).toBeCloseTo(0.425);
  });
});

describe('decimateWithPressure', () => {
  it('mantém o primeiro e o último ponto sempre', () => {
    const pontos = linha(20);
    const out = decimateWithPressure(pontos, 15);
    expect(out[0]).toBe(pontos[0]);
    expect(out[out.length - 1]).toBe(pontos[pontos.length - 1]);
    expect(out.length).toBeLessThan(pontos.length);
  });

  it('descarta pontos mais próximos que a distância mínima', () => {
    const pontos = linha(10); // 10px entre pontos
    const out = decimateWithPressure(pontos, 25);
    // ~90px de linha com passo mínimo 25 -> no máximo ~5 pontos
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it('distância 0 ou lista curta devolve a entrada intacta', () => {
    const pontos = linha(5);
    expect(decimateWithPressure(pontos, 0)).toBe(pontos);
    expect(decimateWithPressure(linha(2), 100)).toHaveLength(2);
  });

  it('pressão viaja junto com o ponto (alinhamento preservado)', () => {
    const pontos: BrushPoint[] = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 1, y: 0, pressure: 0.9 }, // perto demais -> sai
      { x: 100, y: 0, pressure: 0.8 },
    ];
    const out = decimateWithPressure(pontos, 10);
    expect(out.map((p) => p.pressure)).toEqual([0.2, 0.8]);
  });
});

describe('buildStrokeOutline', () => {
  it('lista vazia gera silhueta vazia', () => {
    expect(buildStrokeOutline([], 10)).toEqual([]);
  });

  it('um ponto vira um "dot" poligonal', () => {
    const out = buildStrokeOutline([{ x: 50, y: 50, pressure: 0.5 }], 10);
    expect(out.length).toBe(8);
    for (const p of out) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(5);
    }
  });

  it('traço reto com pressão constante gera faixa de largura uniforme', () => {
    const out = buildStrokeOutline(linha(10), 10); // largura 10 -> raio 5
    expect(out.length).toBe(20);
    const metade = out.length / 2;
    for (let i = 0; i < metade; i += 1) {
      // linha horizontal em y=0: bordas em y=-5 e y=+5
      expect(Math.abs(Math.abs(out[i]!.y) - 5)).toBeLessThan(0.001);
    }
  });

  it('pressão maior engorda a silhueta naquele ponto', () => {
    const pontos: BrushPoint[] = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 50, y: 0, pressure: 1 },
      { x: 100, y: 0, pressure: 0.2 },
    ];
    const out = buildStrokeOutline(pontos, 10);
    const raioMeio = Math.abs(out[1]!.y);
    const raioPonta = Math.abs(out[0]!.y);
    expect(raioMeio).toBeGreaterThan(raioPonta);
  });
});

describe('outlineToPathData', () => {
  it('gera path fechado começando em M', () => {
    const d = outlineToPathData([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('silhueta vazia gera string vazia', () => {
    expect(outlineToPathData([])).toBe('');
  });

  it('arredonda coordenadas pra não inflar o JSON salvo', () => {
    const d = outlineToPathData([{ x: 1.23456789, y: 2 }]);
    expect(d).toContain('1.23');
  });
});
