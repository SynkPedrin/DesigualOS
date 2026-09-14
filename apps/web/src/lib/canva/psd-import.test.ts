import { describe, expect, it } from 'vitest';
import type { BlendMode } from 'ag-psd';
import {
  describePsdApproximations,
  isApproximatedPsdBlendMode,
  luminanceToAlpha,
  maskOutsideAlpha,
  maskPlacement,
  psdBlendModeToCanva,
  type PsdImportApproximations,
} from './psd-import';
import { CANVA_BLEND_MODES } from '@desigual-os/types';

/**
 * Fidelidade da importação de PSD. O que é testado aqui é a lógica que pode
 * errar em silêncio: o mapeamento de modos de mesclagem, a conversão de
 * máscara (tons de cinza) em alfa, e o deslocamento da máscara dentro da
 * camada. O desenho no <canvas> em si não é testado - o jsdom deste projeto
 * não tem contexto 2d de verdade -, mas todo número que entra nas chamadas
 * de canvas passa por estas funções.
 */

describe('psdBlendModeToCanva', () => {
  it('mapeia todo modo de mesclagem do Photoshop pra um modo que o Canvas2D aceita', () => {
    const psdModes: BlendMode[] = [
      'pass through', 'normal', 'dissolve', 'darken', 'multiply', 'color burn', 'linear burn',
      'darker color', 'lighten', 'screen', 'color dodge', 'linear dodge', 'lighter color',
      'overlay', 'soft light', 'hard light', 'vivid light', 'linear light', 'pin light',
      'hard mix', 'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation',
      'color', 'luminosity', 'linear height', 'height', 'subtraction',
    ];

    for (const mode of psdModes) {
      expect(CANVA_BLEND_MODES).toContain(psdBlendModeToCanva(mode));
    }
  });

  it('os modos com equivalente exato passam pelo nome correspondente', () => {
    expect(psdBlendModeToCanva('multiply')).toBe('multiply');
    expect(psdBlendModeToCanva('color burn')).toBe('color-burn');
    expect(psdBlendModeToCanva('soft light')).toBe('soft-light');
    expect(psdBlendModeToCanva('luminosity')).toBe('luminosity');
  });

  it('"pass through" (modo de PASTA) vira normal, porque as pastas são achatadas na importação', () => {
    expect(psdBlendModeToCanva('pass through')).toBe('normal');
    expect(isApproximatedPsdBlendMode('pass through')).toBe(false);
  });

  it('camada sem modo declarado é normal', () => {
    expect(psdBlendModeToCanva(undefined)).toBe('normal');
  });

  it('modo sem equivalente no Canvas2D cai na aproximação mais próxima E é sinalizado como aproximação', () => {
    expect(psdBlendModeToCanva('linear burn')).toBe('multiply');
    expect(psdBlendModeToCanva('vivid light')).toBe('hard-light');
    expect(psdBlendModeToCanva('linear dodge')).toBe('screen');

    expect(isApproximatedPsdBlendMode('linear burn')).toBe(true);
    expect(isApproximatedPsdBlendMode('vivid light')).toBe(true);
    expect(isApproximatedPsdBlendMode('multiply')).toBe(false);
    expect(isApproximatedPsdBlendMode('overlay')).toBe(false);
  });
});

describe('luminanceToAlpha', () => {
  it('máscara branca vira alfa cheio, preta vira transparente, cinza vira meio-termo', () => {
    // Uma máscara do Photoshop é uma imagem em tons de cinza 100% OPACA -
    // sem esta conversão, usá-la como recorte não apagaria nada.
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, // branco = aparece
      0, 0, 0, 255,       // preto = some
      128, 128, 128, 255, // cinza = meio visível
    ]);

    luminanceToAlpha(pixels);

    expect([...pixels.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...pixels.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...pixels.slice(8, 12)]).toEqual([0, 0, 0, 128]);
  });
});

describe('maskPlacement', () => {
  it('converte o retângulo da máscara (coordenadas do documento) pra dentro da camada', () => {
    const layer = { left: 100, top: 200, width: 400, height: 300 };
    const mask = { left: 150, top: 260, width: 200, height: 100 };

    expect(maskPlacement(layer, mask)).toEqual({ offsetX: 50, offsetY: 60, width: 200, height: 100 });
  });

  it('máscara que começa ANTES da camada gera deslocamento negativo (não é zerado)', () => {
    const layer = { left: 100, top: 200, width: 400, height: 300 };
    const mask = { left: 0, top: 0, width: 1080, height: 1350 };

    expect(maskPlacement(layer, mask)).toEqual({ offsetX: -100, offsetY: -200, width: 1080, height: 1350 });
  });
});

describe('maskOutsideAlpha', () => {
  it('defaultColor 0 esconde e 255 mostra a área fora do retângulo da máscara', () => {
    expect(maskOutsideAlpha(0)).toBe(0);
    expect(maskOutsideAlpha(255)).toBe(1);
  });

  it('sem defaultColor assume visível (errar pra "aparece" não faz camada sumir sem explicação)', () => {
    expect(maskOutsideAlpha(undefined)).toBe(1);
  });
});

describe('describePsdApproximations', () => {
  const nada: PsdImportApproximations = { blendModes: [], layerEffects: 0, clippingToGroup: 0 };

  it('importação 100% fiel não gera aviso nenhum', () => {
    expect(describePsdApproximations(nada)).toBeNull();
  });

  it('nomeia os modos de mesclagem aproximados', () => {
    const message = describePsdApproximations({ ...nada, blendModes: ['vivid light', 'divide'] });
    expect(message).toContain('vivid light');
    expect(message).toContain('divide');
  });

  it('conta estilos de camada e recortes sobre pasta na mesma frase', () => {
    const message = describePsdApproximations({ blendModes: [], layerEffects: 3, clippingToGroup: 2 });
    expect(message).toContain('3 camadas usam estilo de camada');
    expect(message).toContain('2 recorte(s) sobre pasta');
  });

  it('usa singular quando é uma camada só', () => {
    const message = describePsdApproximations({ ...nada, layerEffects: 1 });
    expect(message).toContain('1 camada usa estilo de camada');
  });
});
