import { describe, expect, it } from 'vitest';
import { clampRect } from './crop-overlay';

describe('clampRect', () => {
  const bounds = { width: 200, height: 100 };

  it('mantém um retângulo já dentro dos limites intocado', () => {
    expect(clampRect({ x: 10, y: 10, width: 50, height: 50 }, bounds)).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  it('nunca deixa width/height menor que 20px (tamanho mínimo de recorte)', () => {
    const result = clampRect({ x: 0, y: 0, width: 5, height: 5 }, bounds);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it('nunca deixa width/height maior que os limites do frame', () => {
    const result = clampRect({ x: 0, y: 0, width: 500, height: 500 }, bounds);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('empurra x/y de volta pra dentro quando o retângulo tentaria sair pela direita/baixo', () => {
    const result = clampRect({ x: 190, y: 90, width: 50, height: 50 }, bounds);
    // x + width não pode passar de bounds.width (200): x fica em 150.
    expect(result.x).toBe(150);
    expect(result.y).toBe(50);
  });

  it('nunca deixa x/y negativos', () => {
    const result = clampRect({ x: -30, y: -30, width: 50, height: 50 }, bounds);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});
