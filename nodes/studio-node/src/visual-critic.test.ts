import { describe, expect, it } from 'vitest';
import { normalizeProblemRegion } from './visual-critic';

describe('normalizeProblemRegion', () => {
  /**
   * Caso medido (16/09/2026, family.png): o `qwen3.6:35b-a3b` devolveu
   * QUATRO problemas seguidos de mão/pé/pulso, todos rotulados
   * `region: "product"`, numa imagem sem produto nenhum. O enum do schema
   * garante valor válido, não valor correto - sem esta normalização o
   * roteamento de correção mandaria "product reference workflow" pra
   * consertar um dedo.
   */
  it('reclassifica defeito de mão rotulado como product', () => {
    const fixed = normalizeProblemRegion({
      region: 'product',
      severity: 'medium',
      description: "The father's left hand appears slightly oversized and the fingers are somewhat fused together",
    });
    expect(fixed.region).toBe('hands');
  });

  it('reclassifica defeito de rosto rotulado como global', () => {
    const fixed = normalizeProblemRegion({
      region: 'global',
      severity: 'medium',
      description: 'The eyes and mouth have a slightly plastic, overly smooth texture',
    });
    expect(fixed.region).toBe('face');
  });

  it('reclassifica defeito de placa/texto', () => {
    const fixed = normalizeProblemRegion({
      region: 'background',
      severity: 'medium',
      description: "The sign 'Residencial HABIANA' has uneven font spacing",
    });
    expect(fixed.region).toBe('text');
  });

  it('preserva o rótulo quando a descrição não contradiz', () => {
    const problem = { region: 'lighting' as const, severity: 'low' as const, description: 'Shadows are soft and diffuse rather than directional' };
    expect(normalizeProblemRegion(problem)).toEqual(problem);
  });

  it('mão ganha de rosto quando os dois aparecem (mão é o defeito que reprova)', () => {
    const fixed = normalizeProblemRegion({
      region: 'global',
      severity: 'high',
      description: 'the face is fine but the fingers are fused',
    });
    expect(fixed.region).toBe('hands');
  });
});
