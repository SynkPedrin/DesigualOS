import { describe, expect, it } from 'vitest';
import type { CanvaObject } from '@desigual-os/types';
import { Ellipse, Polygon, Triangle } from 'fabric';
import {
  blendModeToComposite,
  buildClipShape,
  buildCssFilterString,
  buildFallbackExisting,
  readCanvaObject,
  clipShapeKindOf,
  cloneCanvaObject,
  compositeToBlendMode,
  computeImagePlacement,
  defaultShapeStroke,
  starPoints,
  type FabricObjectWithMeta,
} from './fabric-sync';
import { CANVA_BLEND_MODES, type CanvaShapeObject } from '@desigual-os/types';

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

describe('blendModeToComposite / compositeToBlendMode', () => {
  it('"normal" (nome do Photoshop) mapeia pra "source-over" (nome do Canvas2D), não pra si mesmo', () => {
    expect(blendModeToComposite('normal')).toBe('source-over');
    expect(compositeToBlendMode('source-over')).toBe('normal');
  });

  it('undefined em qualquer direção volta pro equivalente de "normal"', () => {
    expect(blendModeToComposite(undefined)).toBe('source-over');
    expect(compositeToBlendMode(undefined)).toBe('normal');
  });

  it('round-trip: todo modo do Photoshop sobrevive ida e volta sem perda', () => {
    for (const mode of CANVA_BLEND_MODES) {
      expect(compositeToBlendMode(blendModeToComposite(mode))).toBe(mode);
    }
  });

  it('um valor de composite desconhecido (nunca produzido por nós) cai em "normal", não quebra', () => {
    expect(compositeToBlendMode('destination-out')).toBe('normal');
  });
});

describe('buildFallbackExisting', () => {
  // Achado real (2026-09-10): sem isto, um objeto do canvas recém-criado
  // (forma/texto/imagem adicionados, colar, duplicar, agrupar) sumia
  // silenciosamente do documento salvo no primeiro commit seguinte, porque
  // flushActivePageFromCanvas só sabia RELER um objeto já registrado antes,
  // nunca INSERIR um novo. Estes testes travam o comportamento de
  // reconstrução a partir do objeto Fabric ao vivo, sem precisar de um
  // registro prévio.
  const baseFabricFields = {
    left: 10,
    top: 20,
    width: 100,
    height: 50,
    scaleX: 1,
    scaleY: 2,
    angle: 0,
    opacity: 1,
    selectable: true,
    visible: true,
    globalCompositeOperation: 'source-over',
  };

  it('imagem: recupera a src via getSrc() (não tem outro jeito de saber a URL sem registro prévio)', () => {
    const fake = {
      ...baseFabricFields,
      canvaId: 'img-1',
      canvaType: 'image',
      getSrc: () => 'https://cdn.exemplo/foto.png',
    } as unknown as FabricObjectWithMeta;

    const result = buildFallbackExisting(fake);
    expect(result.type).toBe('image');
    if (result.type === 'image') expect(result.src).toBe('https://cdn.exemplo/foto.png');
  });

  it('texto: lê tudo direto do objeto Textbox ao vivo, sem precisar de registro prévio', () => {
    const fake = {
      ...baseFabricFields,
      canvaId: 'txt-1',
      canvaType: 'text',
      text: 'Olá mundo',
      fontFamily: 'Space Grotesk',
      fontSize: 42,
      fontWeight: 700,
      fontStyle: 'italic',
      fill: '#111111',
      textAlign: 'center',
      charSpacing: 2,
      lineHeight: 1.2,
      underline: true,
    } as unknown as FabricObjectWithMeta;

    const result = buildFallbackExisting(fake);
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.text).toBe('Olá mundo');
      expect(result.fontFamily).toBe('Space Grotesk');
      expect(result.fontWeight).toBe(700);
      expect(result.uppercase).toBe(false); // não recuperável sem registro prévio, default honesto
    }
  });

  it('forma: recupera o TIPO da forma (rect/ellipse/...) via canvaShapeKind, marcado na criação', () => {
    const fake = {
      ...baseFabricFields,
      canvaId: 'shape-1',
      canvaType: 'shape',
      canvaShapeKind: 'star',
      fill: '#ff0000',
      stroke: '#00ff00',
      strokeWidth: 3,
    } as unknown as FabricObjectWithMeta;

    const result = buildFallbackExisting(fake);
    expect(result.type).toBe('shape');
    if (result.type === 'shape') expect(result.shape).toBe('star');
  });

  it('forma sem canvaShapeKind (não deveria acontecer, mas não quebra): cai em "rect"', () => {
    const fake = {
      ...baseFabricFields,
      canvaId: 'shape-2',
      canvaType: 'shape',
      fill: '#ff0000',
      stroke: '#00ff00',
      strokeWidth: 3,
    } as unknown as FabricObjectWithMeta;

    const result = buildFallbackExisting(fake);
    if (result.type === 'shape') expect(result.shape).toBe('rect');
  });

  it('traço de pincel: reconstrói pathData via util.joinPath a partir do path ao vivo', () => {
    const fake = {
      ...baseFabricFields,
      canvaId: 'path-1',
      canvaType: 'path',
      path: [
        ['M', 0, 0],
        ['L', 10, 10],
      ],
      stroke: '#9333ea',
      strokeWidth: 4,
    } as unknown as FabricObjectWithMeta;

    const result = buildFallbackExisting(fake);
    expect(result.type).toBe('path');
    if (result.type === 'path') {
      expect(result.pathData.length).toBeGreaterThan(0);
      expect(result.pathData).toContain('M');
    }
  });

  it('grupo: reconstrói fabricData via toObject() ao vivo (melhor que qualquer valor velho)', () => {
    const fakeToObject = { type: 'group', objects: [] };
    const fake = {
      ...baseFabricFields,
      canvaId: 'group-1',
      canvaType: 'group',
      toObject: () => fakeToObject,
    } as unknown as FabricObjectWithMeta;

    const result = buildFallbackExisting(fake);
    expect(result.type).toBe('group');
    if (result.type === 'group') expect(result.fabricData).toEqual(fakeToObject);
  });

  it('locked reflete selectable === false do objeto ao vivo, não um default fixo', () => {
    const fake = {
      ...baseFabricFields,
      selectable: false,
      canvaId: 'shape-3',
      canvaType: 'shape',
      canvaShapeKind: 'rect',
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 0,
    } as unknown as FabricObjectWithMeta;

    expect(buildFallbackExisting(fake).locked).toBe(true);
  });
});

describe('computeImagePlacement', () => {
  /**
   * Regressão do defeito relatado como "o upload não funciona" (2026-09-11):
   * a imagem entrava com o tamanho JÁ REDUZIDO em width/height e escala 1, o
   * que no fabric.Image significa recortar a origem, não encolher a imagem.
   */
  it('foto maior que o artboard: caixa de origem continua sendo a resolução ORIGINAL, quem encolhe é a escala', () => {
    const placement = computeImagePlacement(3000, 2000, 1080, 1350);

    expect(placement.width).toBe(3000);
    expect(placement.height).toBe(2000);
    // 90% de 1080 = 972 de largura máxima -> 972/3000
    expect(placement.scaleX).toBeCloseTo(0.324, 5);
    expect(placement.scaleY).toBeCloseTo(0.324, 5);
    // O tamanho exibido é width * scaleX, e cabe em 90% do artboard.
    expect(placement.width * placement.scaleX).toBeCloseTo(972, 5);
    expect(placement.height * placement.scaleY).toBeCloseTo(648, 5);
  });

  it('centraliza pelo tamanho EXIBIDO, não pela resolução original', () => {
    const placement = computeImagePlacement(3000, 2000, 1080, 1350);

    expect(placement.x).toBeCloseTo((1080 - 972) / 2, 5);
    expect(placement.y).toBeCloseTo((1350 - 648) / 2, 5);
  });

  it('imagem menor que o artboard entra em tamanho real (nunca amplia)', () => {
    const placement = computeImagePlacement(200, 100, 1080, 1350);

    expect(placement.scaleX).toBe(1);
    expect(placement.width).toBe(200);
    expect(placement.x).toBe((1080 - 200) / 2);
  });

  it('altura é o lado limitante quando a imagem é mais alta que larga', () => {
    const placement = computeImagePlacement(1000, 4000, 1080, 1350);

    // 90% de 1350 = 1215 -> 1215/4000
    expect(placement.scaleY).toBeCloseTo(0.30375, 5);
    expect(placement.height * placement.scaleY).toBeCloseTo(1215, 5);
  });

  it('sem dimensão conhecida (probe falhou) cai pra metade do artboard, em escala 1', () => {
    const placement = computeImagePlacement(0, 0, 1080, 1350);

    expect(placement.width).toBe(540);
    expect(placement.height).toBe(675);
    expect(placement.scaleX).toBe(1);
  });
});

describe('buildClipShape', () => {
  // Achado (2026-09-11, "máscaras de camada"): clipPath do Fabric é
  // posicionado relativo ao CENTRO do objeto que recorta (não ao canto
  // superior esquerdo) - por isso a forma tem que nascer centrada em (0,0).
  it('"rect" e "line" não geram máscara nenhuma (retângulo já é o recorte padrão; linha tem área zero)', () => {
    expect(buildClipShape('rect', 100, 100)).toBeNull();
    expect(buildClipShape('line', 100, 100)).toBeNull();
    expect(buildClipShape(undefined, 100, 100)).toBeNull();
  });

  it('"ellipse" cria uma Ellipse do Fabric com raio metade da largura/altura', () => {
    const clip = buildClipShape('ellipse', 200, 100);
    expect(clip).toBeInstanceOf(Ellipse);
    expect((clip as InstanceType<typeof Ellipse>).rx).toBe(100);
    expect((clip as InstanceType<typeof Ellipse>).ry).toBe(50);
  });

  it('"triangle" cria um Triangle do Fabric do tamanho pedido', () => {
    const clip = buildClipShape('triangle', 80, 60);
    expect(clip).toBeInstanceOf(Triangle);
    expect((clip as InstanceType<typeof Triangle>).width).toBe(80);
    expect((clip as InstanceType<typeof Triangle>).height).toBe(60);
  });

  it('"star" cria um Polygon do Fabric com 10 pontos, centrado em (0,0)', () => {
    const clip = buildClipShape('star', 100, 100);
    expect(clip).toBeInstanceOf(Polygon);
    const points = (clip as InstanceType<typeof Polygon>).points;
    expect(points).toHaveLength(10);
    // Centrado: nenhum ponto deveria ficar a mais de metade da caixa do centro.
    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(50 + 0.001);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(50 + 0.001);
    }
  });

  it('todas as formas têm origin centralizado (clipPath é relativo ao centro do objeto no Fabric)', () => {
    for (const shape of ['ellipse', 'triangle', 'star'] as const) {
      const clip = buildClipShape(shape, 100, 100)!;
      expect(clip.originX).toBe('center');
      expect(clip.originY).toBe('center');
    }
  });
});

describe('clipShapeKindOf', () => {
  // Achado real (2026-09-11, ao revisar a máscara depois de pronta):
  // recortar (crop) uma imagem que já tem máscara aplicada precisa
  // RECONSTRUIR a máscara no novo tamanho (ver applyCrop) - isto aqui é
  // como ele descobre qual forma reconstruir, direto da instância Fabric
  // viva, sem depender de já ter sido salva em pagesRef antes.
  it('null/undefined (sem máscara) devolve undefined', () => {
    expect(clipShapeKindOf(null)).toBeUndefined();
    expect(clipShapeKindOf(undefined)).toBeUndefined();
  });

  it('reconhece cada forma construída por buildClipShape - round-trip completo', () => {
    expect(clipShapeKindOf(buildClipShape('ellipse', 100, 100))).toBe('ellipse');
    expect(clipShapeKindOf(buildClipShape('triangle', 100, 100))).toBe('triangle');
    expect(clipShapeKindOf(buildClipShape('star', 100, 100))).toBe('star');
  });
});

describe('readCanvaObject - nome da camada', () => {
  /**
   * Regressão medida em 17/09/2026: renomear uma camada para "CTA Background"
   * aparecia na UI e voltava para "Forma - rect" depois do F5. `name` só
   * existe no NOSSO modelo (não há equivalente no objeto Fabric), então
   * qualquer releitura do canvas precisa trazê-lo de `existing` - igual a
   * `metadata`.
   */
  it('preserva o nome vindo do objeto existente', () => {
    const existing = {
      id: 'obj-1', type: 'shape', shape: 'rect', fill: '#000000',
      x: 0, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotation: 0,
      opacity: 1, locked: false, visible: true, zIndex: 0, name: 'CTA Background',
    } as unknown as CanvaObject;
    const fabricObject = {
      canvaId: 'obj-1', canvaType: 'shape', left: 5, top: 5, width: 10, height: 10,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, selectable: true, visible: true,
      fill: '#000000', type: 'rect',
    } as unknown as Parameters<typeof readCanvaObject>[0];

    expect(readCanvaObject(fabricObject, existing, 0).name).toBe('CTA Background');
  });

  it('sem nome no existente, não inventa nome', () => {
    const existing = {
      id: 'obj-2', type: 'shape', shape: 'rect', fill: '#000000',
      x: 0, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotation: 0,
      opacity: 1, locked: false, visible: true, zIndex: 0,
    } as unknown as CanvaObject;
    const fabricObject = {
      canvaId: 'obj-2', canvaType: 'shape', left: 0, top: 0, width: 10, height: 10,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1, selectable: true, visible: true,
      fill: '#000000', type: 'rect',
    } as unknown as Parameters<typeof readCanvaObject>[0];

    expect(readCanvaObject(fabricObject, existing, 0).name).toBeUndefined();
  });
});
