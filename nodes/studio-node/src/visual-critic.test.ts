import { describe, expect, it } from 'vitest';
import { normalizeProblemRegion, decideKeepUpscaled } from './visual-critic';

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

describe('decideKeepUpscaled (final QA)', () => {
  const bom = { identity_preserved: 9, texture_natural: 8, logo_product_intact: 9, oversharpen_free: 8, detail_gain: 7, degradations: [] };

  it('mantém o upscale quando nada foi danificado', () => {
    expect(decideKeepUpscaled(bom)).toBe(true);
  });

  /** O ponto da Fase E: upscale não aprova sozinho. */
  it('descarta o upscale que trocou o rosto, mesmo com ganho grande de detalhe', () => {
    expect(decideKeepUpscaled({ ...bom, identity_preserved: 4, detail_gain: 10 })).toBe(false);
  });

  it('descarta oversharpen com halo', () => {
    expect(decideKeepUpscaled({ ...bom, oversharpen_free: 3 })).toBe(false);
  });

  it('descarta textura de pele alucinada', () => {
    expect(decideKeepUpscaled({ ...bom, texture_natural: 2 })).toBe(false);
  });

  it('descarta logo/produto deformado', () => {
    expect(decideKeepUpscaled({ ...bom, logo_product_intact: 3 })).toBe(false);
  });

  it('ganho de detalhe baixo NÃO reprova (upscale inócuo não é upscale danoso)', () => {
    expect(decideKeepUpscaled({ ...bom, detail_gain: 0 })).toBe(true);
  });
});
