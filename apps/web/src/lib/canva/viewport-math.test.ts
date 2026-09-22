import { describe, expect, it } from 'vitest';
import {
  centerViewport, clampPan, clampZoom, documentToScreen, intersects, MAX_ZOOM, MIN_ZOOM, marqueeRect,
  panBy, screenToDocument, zoomAtPointer, zoomFromWheel, type Viewport,
} from './viewport-math';

describe('clampZoom', () => {
  it('respeita os limites', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('não propaga NaN/Infinity para o layout', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });
});

describe('zoomFromWheel', () => {
  it('deltaY negativo (roda pra cima) aproxima, positivo afasta', () => {
    expect(zoomFromWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomFromWheel(1, 100)).toBeLessThan(1);
  });

  it('é proporcional: o mesmo gesto muda a mesma FRAÇÃO em qualquer zoom', () => {
    const razaoBaixo = zoomFromWheel(0.2, -100) / 0.2;
    const razaoAlto = zoomFromWheel(2, -100) / 2;
    expect(razaoBaixo).toBeCloseTo(razaoAlto, 6);
  });

  it('nunca escapa dos limites', () => {
    expect(zoomFromWheel(MAX_ZOOM, -100000)).toBe(MAX_ZOOM);
    expect(zoomFromWheel(MIN_ZOOM, 100000)).toBe(MIN_ZOOM);
  });
});

describe('screenToDocument / documentToScreen', () => {
  const rect = { left: 100, top: 50 };

  it('são inversas uma da outra', () => {
    const doc = screenToDocument({ x: 340, y: 250 }, rect, 2);
    expect(doc).toEqual({ x: 120, y: 100 });
    expect(documentToScreen(doc, rect, 2)).toEqual({ x: 340, y: 250 });
  });

  it('zoom 0 não gera divisão por zero', () => {
    expect(screenToDocument({ x: 100, y: 50 }, rect, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('zoomAtPointer', () => {
  const container = { width: 800, height: 600 };
  const doc = { width: 1080, height: 1350 };

  /** O invariante do gate: o ponto do documento sob o cursor NÃO se move. */
  it('mantém o ponto sob o cursor, com a artboard MENOR que o container', () => {
    const vp = centerViewport(0.3, container, doc);
    const pointer = { x: 280, y: 190 };
    const docAntes = { x: (pointer.x - vp.panX) / vp.zoom, y: (pointer.y - vp.panY) / vp.zoom };
    const depois = zoomAtPointer(vp, 0.6, pointer);
    expect(depois.panX + docAntes.x * depois.zoom).toBeCloseTo(pointer.x, 6);
    expect(depois.panY + docAntes.y * depois.zoom).toBeCloseTo(pointer.y, 6);
  });

  it('mantém o ponto sob o cursor com a artboard MAIOR que o container', () => {
    const vp: Viewport = { zoom: 2, panX: -500, panY: -900 };
    const pointer = { x: 120, y: 400 };
    const docAntes = { x: (pointer.x - vp.panX) / vp.zoom, y: (pointer.y - vp.panY) / vp.zoom };
    const depois = zoomAtPointer(vp, 3.5, pointer);
    expect(depois.panX + docAntes.x * depois.zoom).toBeCloseTo(pointer.x, 6);
    expect(depois.panY + docAntes.y * depois.zoom).toBeCloseTo(pointer.y, 6);
  });

  it('respeita os limites de zoom ao ancorar', () => {
    const vp = centerViewport(1, container, doc);
    expect(zoomAtPointer(vp, 99, { x: 10, y: 10 }).zoom).toBe(MAX_ZOOM);
    expect(zoomAtPointer(vp, 0.0001, { x: 10, y: 10 }).zoom).toBe(MIN_ZOOM);
  });
});

describe('panBy / clampPan', () => {
  const container = { width: 800, height: 600 };
  const doc = { width: 1080, height: 1350 };

  it('a artboard acompanha o ponteiro 1:1', () => {
    expect(panBy({ zoom: 1, panX: 10, panY: 20 }, 30, -15)).toEqual({ zoom: 1, panX: 40, panY: 5 });
  });

  it('nunca deixa a artboard sumir da tela', () => {
    const longe = clampPan({ zoom: 1, panX: 99999, panY: -99999 }, container, doc);
    expect(longe.panX).toBeLessThanOrEqual(container.width);
    expect(longe.panY + doc.height).toBeGreaterThan(0);
  });

  it('NÃO prende ao centro: pan livre é o que permite ancorar o zoom', () => {
    const vp = clampPan({ zoom: 0.3, panX: 40, panY: 30 }, container, doc);
    const centrado = centerViewport(0.3, container, doc);
    expect(vp.panX).not.toBeCloseTo(centrado.panX, 3);
  });
});

describe('marqueeRect / intersects', () => {
  it('normaliza arrasto em qualquer direção', () => {
    const a = marqueeRect({ x: 100, y: 100 }, { x: 20, y: 40 });
    expect(a).toEqual({ left: 20, top: 40, width: 80, height: 60 });
  });

  it('seleciona por INTERSEÇÃO, não por contenção total', () => {
    const marquee = { left: 0, top: 0, width: 100, height: 100 };
    const encostando = { left: 90, top: 90, width: 200, height: 200 };
    expect(intersects(marquee, encostando)).toBe(true);
  });

  it('não seleciona quem está fora', () => {
    const marquee = { left: 0, top: 0, width: 50, height: 50 };
    expect(intersects(marquee, { left: 60, top: 60, width: 10, height: 10 })).toBe(false);
  });

  it('encostar exatamente na borda não conta como interseção', () => {
    const marquee = { left: 0, top: 0, width: 50, height: 50 };
    expect(intersects(marquee, { left: 50, top: 0, width: 10, height: 10 })).toBe(false);
  });
});
