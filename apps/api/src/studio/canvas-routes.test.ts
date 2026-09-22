import { describe, expect, it } from 'vitest';
import type { CanvaObject, CanvaPage } from '@desigual-os/types';
import { updateDocumentSchema } from './canvas-routes';

function forma(id: string, zIndex: number, extra: Partial<CanvaObject> = {}): CanvaObject {
  return {
    id, type: 'shape', shape: 'rect', name: `camada ${id}`,
    x: 0, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1,
    rotation: 0, opacity: 1, locked: false, visible: true, zIndex,
    fill: '#ffffff', stroke: '#000000', strokeWidth: 0,
    ...extra,
  } as CanvaObject;
}

const pagina = (objects: CanvaObject[]): CanvaPage => ({
  id: 'p1', order: 0, background: { type: 'color', value: '#ffffff' }, objects,
});

describe('updateDocumentSchema — o que o servidor aceita gravar', () => {
  /** Hipótese 7 da forense do Gate 2.2: "o front manda a ordem certa e o
   * backend modifica". Aqui a ordem do array e o zIndex saem idênticos. */
  it('preserva a ORDEM do array de objetos e o zIndex de cada um', () => {
    const entrada = pagina([forma('BACKGROUND', 0), forma('SHAPE', 1), forma('TEXT', 2), forma('IMAGE', 3)]);
    const saida = updateDocumentSchema.parse({ pages: [entrada] });
    expect(saida.pages![0]!.objects.map((o) => o.id)).toEqual(['BACKGROUND', 'SHAPE', 'TEXT', 'IMAGE']);
    expect(saida.pages![0]!.objects.map((o) => o.zIndex)).toEqual([0, 1, 2, 3]);
  });

  it('não reordena por zIndex: a ordem do array é a que chega', () => {
    // Array fora de ordem de propósito - o servidor não é quem decide isso.
    const entrada = pagina([forma('C', 2), forma('A', 0), forma('B', 1)]);
    const saida = updateDocumentSchema.parse({ pages: [entrada] });
    expect(saida.pages![0]!.objects.map((o) => o.id)).toEqual(['C', 'A', 'B']);
  });

  it('mantém o nome da camada (o campo que o zod já descartou uma vez)', () => {
    const saida = updateDocumentSchema.parse({ pages: [pagina([forma('a', 0, { name: 'CTA Background' })])] });
    expect(saida.pages![0]!.objects[0]!.name).toBe('CTA Background');
  });

  it('mantém visibilidade e bloqueio', () => {
    const saida = updateDocumentSchema.parse({
      pages: [pagina([forma('a', 0, { visible: false, locked: true })])],
    });
    expect(saida.pages![0]!.objects[0]!.visible).toBe(false);
    expect(saida.pages![0]!.objects[0]!.locked).toBe(true);
  });

  it('recusa um objeto sem zIndex em vez de gravar meio documento', () => {
    const sem = { ...forma('a', 0) } as Record<string, unknown>;
    delete sem.zIndex;
    expect(() => updateDocumentSchema.parse({ pages: [pagina([sem as unknown as CanvaObject])] })).toThrow();
  });
});
