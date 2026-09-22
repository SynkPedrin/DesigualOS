import { describe, expect, it } from 'vitest';
import type { CanvaObject } from '@desigual-os/types';
import { documentColors, MAX_RECENT_COLORS, normalizeColor, parseColor, pushRecentColor, rgbaToHex, toHslString, toRgbString } from './color';

describe('normalizeColor', () => {
  /** O motivo de existir: três escritas da mesma cor não podem virar três cores. */
  it('formas equivalentes viram a MESMA string canônica', () => {
    const esperado = '#ffffff';
    expect(normalizeColor('#fff')).toBe(esperado);
    expect(normalizeColor('#FFFFFF')).toBe(esperado);
    expect(normalizeColor('rgb(255,255,255)')).toBe(esperado);
    expect(normalizeColor('rgb(255, 255, 255)')).toBe(esperado);
    expect(normalizeColor('hsl(0, 0%, 100%)')).toBe(esperado);
    expect(normalizeColor('  #FfFfFf  ')).toBe(esperado);
  });

  it('preserva alpha só quando existe de verdade', () => {
    expect(normalizeColor('rgba(0,0,0,1)')).toBe('#000000');
    expect(normalizeColor('rgba(0,0,0,0.5)')).toBe('#00000080');
    expect(normalizeColor('#00000080')).toBe('#00000080');
  });

  it('hex de 4 dígitos carrega alpha', () => {
    expect(normalizeColor('#f00f')).toBe('#ff0000');
    expect(normalizeColor('#f000')).toBe('#ff000000');
  });

  it('entrada inválida devolve null em vez de uma cor inventada', () => {
    for (const ruim of ['', 'xyz', '#gg', 'rgb(1,2)', 'hsl(a,b,c)', '#12345']) {
      expect(normalizeColor(ruim)).toBeNull();
    }
  });

  it('transparent é reconhecido', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('conversões', () => {
  it('ida e volta hex -> rgb -> hsl mantém a cor', () => {
    expect(toRgbString('#7b2eff')).toBe('rgb(123, 46, 255)');
    expect(normalizeColor(toRgbString('#7b2eff')!)).toBe('#7b2eff');
    expect(normalizeColor(toHslString('#7b2eff')!)).toBe('#7b2eff');
  });

  it('rgb com alpha vira rgba', () => {
    expect(toRgbString('#00000080')).toMatch(/^rgba\(0, 0, 0, 0\.5\d*\)$/);
  });

  it('cinza puro tem saturação zero', () => {
    expect(toHslString('#808080')).toBe('hsl(0, 0%, 50%)');
  });
});

describe('documentColors', () => {
  const shape = (fill: string, stroke?: string): CanvaObject =>
    ({ id: Math.random().toString(36), type: 'shape', shape: 'rect', fill, stroke, x: 0, y: 0, width: 10, height: 10,
       scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, locked: false, visible: true, zIndex: 0 }) as unknown as CanvaObject;

  it('extrai cores dos objetos sem duplicar equivalentes', () => {
    const cores = documentColors([shape('#fff'), shape('#FFFFFF'), shape('rgb(255,255,255)'), shape('#7b2eff')]);
    expect(cores.sort()).toEqual(['#7b2eff', '#ffffff']);
  });

  it('inclui stroke além do fill', () => {
    expect(documentColors([shape('#000000', '#ff0000')]).sort()).toEqual(['#000000', '#ff0000']);
  });

  /** Grupo guarda estrutura nativa do Fabric, não CanvaObject[] recursivo:
   * as cores dos filhos não são legíveis pelo modelo portável, e a função
   * ignora o grupo em vez de tentar adivinhar o formato interno. */
  it('ignora grupo sem quebrar', () => {
    const grupo = { id: 'g', type: 'group', x: 0, y: 0, width: 10, height: 10,
      scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, locked: false, visible: true, zIndex: 0 } as unknown as CanvaObject;
    expect(documentColors([grupo, shape('#123456')])).toEqual(['#123456']);
  });

  it('ignora totalmente transparente (não é cor para reaplicar)', () => {
    expect(documentColors([shape('#00000000')])).toEqual([]);
  });

  it('documento vazio devolve lista vazia', () => {
    expect(documentColors([])).toEqual([]);
  });
});

describe('pushRecentColor', () => {
  it('coloca na frente e não duplica equivalente', () => {
    let r = pushRecentColor([], '#fff');
    r = pushRecentColor(r, '#7b2eff');
    r = pushRecentColor(r, 'rgb(255,255,255)');
    expect(r).toEqual(['#ffffff', '#7b2eff']);
  });

  it('respeita o teto', () => {
    let r: string[] = [];
    for (let i = 0; i < MAX_RECENT_COLORS + 5; i++) r = pushRecentColor(r, `#0000${i.toString(16).padStart(2, '0')}`);
    expect(r).toHaveLength(MAX_RECENT_COLORS);
  });

  it('cor inválida não entra na lista', () => {
    expect(pushRecentColor(['#ffffff'], 'nao-e-cor')).toEqual(['#ffffff']);
  });
});

describe('rgbaToHex', () => {
  it('pixel opaco vira #rrggbb', () => {
    expect(rgbaToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbaToHex(123, 46, 255)).toBe('#7b2eff');
  });

  it('alpha parcial vira #rrggbbaa', () => {
    expect(rgbaToHex(0, 0, 0, 0.5)).toBe('#00000080');
  });

  it('componentes fora de 0-255 são clampados', () => {
    expect(rgbaToHex(300, -5, 0)).toBe('#ff0000');
  });
});
