import { describe, expect, it } from 'vitest';
import { Canvas, Group, Rect } from 'fabric';
import { installFakeCanvas2d } from './test-canvas-2d';

installFakeCanvas2d();

const caixa = (o: Rect) => {
  const r = o.getBoundingRect();
  return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
};

describe('fabric puro: group/ungroup', () => {
  it('round-trip sem transformar', () => {
    const el = document.createElement('canvas');
    const canvas = new Canvas(el, { width: 1080, height: 1350 });
    const a = new Rect({ left: 100, top: 100, width: 120, height: 80 });
    const b = new Rect({ left: 300, top: 220, width: 60, height: 200, angle: 15 });
    const c = new Rect({ left: 520, top: 140, width: 200, height: 90, angle: -30 });
    canvas.add(a, b, c);
    const antes = [caixa(a), caixa(b), caixa(c)];
    console.log('FABRIC_ANTES :', JSON.stringify(antes));

    // Exatamente o que groupSelected faz hoje.
    const filhos = [a, b, c];
    for (const o of filhos) canvas.remove(o);
    const g = new Group(filhos);
    canvas.add(g);
    console.log('FABRIC_GRUPO :', JSON.stringify(caixa(g as unknown as Rect)));
    console.log('FABRIC_LOCAL :', JSON.stringify(filhos.map((o) => ({ l: Math.round(o.left), t: Math.round(o.top) }))));

    // Exatamente o que ungroupSelected faz hoje.
    const removidos = g.removeAll();
    canvas.remove(g);
    for (const o of removidos) canvas.add(o);
    const depois = [caixa(a), caixa(b), caixa(c)];
    console.log('FABRIC_DEPOIS:', JSON.stringify(depois));
    expect(depois).toEqual(antes);
  });
});

describe('fabric puro: group/ungroup a partir de uma ActiveSelection', () => {
  it('round-trip quando os objetos vieram de um selectAll', async () => {
    const { ActiveSelection } = await import('fabric');
    const el = document.createElement('canvas');
    const canvas = new Canvas(el, { width: 1080, height: 1350 });
    const a = new Rect({ left: 100, top: 100, width: 120, height: 80 });
    const b = new Rect({ left: 300, top: 220, width: 60, height: 200, angle: 15 });
    const c = new Rect({ left: 520, top: 140, width: 200, height: 90, angle: -30 });
    canvas.add(a, b, c);
    const antes = [caixa(a), caixa(b), caixa(c)];

    // selectAll do editor
    canvas.setActiveObject(new ActiveSelection([a, b, c], { canvas }));

    // groupSelected do editor
    const ativos = canvas.getActiveObjects() as Rect[];
    canvas.discardActiveObject();
    for (const o of ativos) canvas.remove(o);
    const g = new Group(ativos);
    canvas.add(g);
    canvas.setActiveObject(g);
    console.log('AS_LOCAL  :', JSON.stringify(ativos.map((o) => ({ l: Math.round(o.left), t: Math.round(o.top) }))));

    // ungroupSelected do editor
    const removidos = g.removeAll();
    canvas.remove(g);
    for (const o of removidos) canvas.add(o);
    const depois = [caixa(a), caixa(b), caixa(c)];
    console.log('AS_ANTES  :', JSON.stringify(antes));
    console.log('AS_DEPOIS :', JSON.stringify(depois));
    expect(depois).toEqual(antes);
  });
});

describe('origem do Group', () => {
  it('reporta originX/originY e a caixa real depois de transformar', () => {
    const el = document.createElement('canvas');
    const canvas = new Canvas(el, { width: 1080, height: 1350 });
    const a = new Rect({ left: 100, top: 100, width: 120, height: 80 });
    const b = new Rect({ left: 300, top: 220, width: 60, height: 200, angle: 15 });
    const c = new Rect({ left: 520, top: 140, width: 200, height: 90, angle: -30 });
    canvas.add(a, b, c);
    for (const o of [a, b, c]) canvas.remove(o);
    const g = new Group([a, b, c]);
    canvas.add(g);
    console.log('ORIGEM:', g.originX, g.originY, 'left/top:', Math.round(g.left), Math.round(g.top), 'w/h:', Math.round(g.width), Math.round(g.height));
    g.set({ left: 60, top: 40 });
    g.set({ scaleX: 500 / g.width, scaleY: 300 / g.height });
    g.set({ angle: 20 });
    g.setCoords();
    const r = g.getBoundingRect();
    console.log('CAIXA_REAL:', JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
    expect(g.originX).toBeDefined();
  });
});

/**
 * O invariante real: cada FILHO fica no mesmo lugar da tela ao desagrupar.
 *
 * Comparar a caixa do grupo com a união dos filhos NÃO serve: a caixa de um
 * retângulo 500x300 girado 20 graus (572x453) é maior que a união das caixas
 * dos filhos girados dentro dele (486x294). As duas divergirem é geometria,
 * não defeito.
 */
describe('fabric puro: ungroup DEPOIS de transformar o grupo', () => {
  it('cada filho fica exatamente onde estava na tela', () => {
    const el = document.createElement('canvas');
    const canvas = new Canvas(el, { width: 1080, height: 1350 });
    const a = new Rect({ left: 100, top: 100, width: 120, height: 80 });
    const b = new Rect({ left: 300, top: 220, width: 60, height: 200, angle: 15 });
    const c = new Rect({ left: 520, top: 140, width: 200, height: 90, angle: -30 });
    canvas.add(a, b, c);
    for (const o of [a, b, c]) canvas.remove(o);
    const g = new Group([a, b, c]);
    canvas.add(g);

    g.set({ left: 60, top: 40 });
    g.set({ scaleX: 500 / g.width, scaleY: 300 / g.height });
    g.set({ angle: 20 });
    g.setCoords();

    // getBoundingRect usa coordenadas em cache: sem `setCoords()` o filho
    // devolve a caixa de ANTES do grupo ter sido transformado, e a medição
    // é que estaria errada, não o Fabric.
    for (const o of [a, b, c]) o.setCoords();
    const dentro = [a, b, c].map(caixa);
    console.log('T_DENTRO :', JSON.stringify(dentro));

    const removidos = g.removeAll();
    canvas.remove(g);
    for (const o of removidos) canvas.add(o);
    const fora = [a, b, c].map(caixa);
    console.log('T_FORA   :', JSON.stringify(fora));
    // 2px de folga: a caixa alinhada aos eixos de um retângulo girado é
    // arredondada, e comparar inteiro a inteiro pegaria só isso.
    fora.forEach((f, i) => {
      const d = dentro[i]!;
      expect(Math.abs(f.left - d.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(f.top - d.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(f.w - d.w)).toBeLessThanOrEqual(2);
      expect(Math.abs(f.h - d.h)).toBeLessThanOrEqual(2);
    });
  });
});
