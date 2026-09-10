import { describe, expect, it } from 'vitest';
import { buildCssFilterString, cloneCanvaObject, defaultShapeStroke, starPoints } from './fabric-sync';
import type { CanvaShapeObject } from '@desigual-os/types';

describe('cloneCanvaObject', () => {
  it('gera um novo id e desloca +20px em x/y (pedido explícito: deixar visualmente claro que é cópia)', () => {
    const original: CanvaShapeObject = {
      id: 'original-id',
      type: 'shape',
      shape: 'rect',
      x: 100,
      y: 200,
      width: 50,
      height: 50,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 0,
    };

    const clone = cloneCanvaObject(original, 'clone-id');
    if (clone.type !== 'shape') throw new Error('expected a shape clone');

    expect(clone.id).toBe('clone-id');
    expect(clone.x).toBe(120);
    expect(clone.y).toBe(220);
    // Todo o resto (estilo/tamanho/transform) é preservado intocado.
    expect(clone.width).toBe(50);
    expect(clone.fill).toBe('#fff');
  });

  it('não muta o objeto original', () => {
    const original: CanvaShapeObject = {
      id: 'a',
      type: 'shape',
      shape: 'ellipse',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      zIndex: 0,
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 0,
    };
    cloneCanvaObject(original, 'b');
    expect(original.x).toBe(0);
    expect(original.id).toBe('a');
  });
});

describe('defaultShapeStroke', () => {
  it('linha vem sem preenchimento e com borda mais grossa (é só um traço)', () => {
    const result = defaultShapeStroke('line');
    expect(result.fill).toBe('transparent');
    expect(result.strokeWidth).toBeGreaterThan(0);
  });

  it('formas preenchidas (rect/ellipse/triangle/star) vêm sem borda por padrão', () => {
    for (const shape of ['rect', 'ellipse', 'triangle', 'star'] as const) {
      const result = defaultShapeStroke(shape);
      expect(result.fill).not.toBe('transparent');
      expect(result.strokeWidth).toBe(0);
    }
  });
});

describe('starPoints', () => {
  it('gera 10 pontos (5 pontas + 5 vales) de uma estrela', () => {
    expect(starPoints(100, 100)).toHaveLength(10);
  });

  it('pontas ficam mais longe do centro que os vales', () => {
    const points = starPoints(100, 100);
    const center = { x: 50, y: 50 };
    const distances = points.map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    // Índices pares = pontas (outer radius), ímpares = vales (inner radius).
    for (let i = 0; i < distances.length; i += 2) {
      expect(distances[i]).toBeGreaterThan(distances[i + 1]!);
    }
  });

  it('cabe dentro da caixa width x height pedida (nenhum ponto escapa do raio máximo)', () => {
    const points = starPoints(200, 100);
    const maxRadius = Math.min(200, 100) / 2;
    for (const point of points) {
      const distance = Math.hypot(point.x - 100, point.y - 50);
      expect(distance).toBeLessThanOrEqual(maxRadius + 0.001);
    }
  });
});

describe('buildCssFilterString', () => {
  it('devolve string vazia sem filtros', () => {
    expect(buildCssFilterString(undefined)).toBe('');
  });

  it('devolve string vazia quando todos os valores são os "sem efeito" (1/0/false)', () => {
    expect(buildCssFilterString({ brightness: 1, contrast: 1, saturation: 1, blur: 0, grayscale: false, sepia: false })).toBe('');
  });

  it('inclui só os filtros com efeito real, na ordem esperada', () => {
    const result = buildCssFilterString({ brightness: 1.2, contrast: 1, saturation: 0.5, blur: 4, grayscale: true, sepia: false });
    expect(result).toBe('brightness(1.2) saturate(0.5) blur(4px) grayscale(1)');
  });

  it('sepia sozinho', () => {
    expect(buildCssFilterString({ sepia: true })).toBe('sepia(1)');
  });
});
