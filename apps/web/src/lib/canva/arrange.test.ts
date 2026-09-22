import { describe, expect, it } from 'vitest';
import { alinhar, distribuir, envelope, moverNaPilha, reordenar, type Caixa } from './arrange';

const caixa = (id: string, left: number, top: number, width = 100, height = 50): Caixa => ({ id, left, top, width, height });

describe('envelope', () => {
  it('cobre todas as caixas', () => {
    expect(envelope([caixa('a', 10, 20), caixa('b', 200, 300, 40, 60)])).toEqual({ left: 10, top: 20, right: 240, bottom: 360 });
  });
});

describe('alinhar', () => {
  const tres = [caixa('a', 0, 0, 100, 50), caixa('b', 50, 100, 200, 80), caixa('c', 300, 200, 60, 20)];

  it('à esquerda usa a borda esquerda do conjunto', () => {
    const r = alinhar(tres, 'left');
    expect(r.a!.left).toBe(0);
    expect(r.b!.left).toBe(0);
    expect(r.c!.left).toBe(0);
  });

  it('à direita encosta as bordas direitas (respeitando larguras diferentes)', () => {
    const r = alinhar(tres, 'right');
    expect(r.a!.left).toBe(360 - 100);
    expect(r.b!.left).toBe(360 - 200);
    expect(r.c!.left).toBe(360 - 60);
  });

  it('centraliza pelo centro do conjunto, não pela origem', () => {
    const r = alinhar(tres, 'center');
    const centroConjunto = (0 + 360) / 2;
    expect(r.a!.left! + 100 / 2).toBeCloseTo(centroConjunto, 6);
    expect(r.b!.left! + 200 / 2).toBeCloseTo(centroConjunto, 6);
  });

  it('alinha no eixo vertical sem tocar no horizontal', () => {
    const r = alinhar(tres, 'top');
    expect(r.a!.top).toBe(0);
    expect(r.b!.top).toBe(0);
    expect(r.a!.left).toBeUndefined();
  });

  it('meio vertical usa a altura de cada caixa', () => {
    const r = alinhar(tres, 'middle');
    const centro = (0 + 220) / 2;
    expect(r.b!.top! + 80 / 2).toBeCloseTo(centro, 6);
  });

  /** Com um objeto só, "alinhar entre si" não significa nada: a referência é o artboard. */
  it('seleção única centraliza no ARTBOARD', () => {
    const r = alinhar([caixa('a', 10, 10, 100, 50)], 'center', { width: 1080, height: 1350 });
    expect(r.a!.left).toBe((1080 - 100) / 2);
  });

  it('seleção única sem artboard não se move', () => {
    const r = alinhar([caixa('a', 10, 10, 100, 50)], 'center');
    expect(r.a!.left).toBe(10);
  });

  it('lista vazia não quebra', () => {
    expect(alinhar([], 'left')).toEqual({});
  });
});

describe('distribuir', () => {
  it('iguala o VÃO entre caixas de tamanhos diferentes', () => {
    const caixas = [caixa('a', 0, 0, 100, 10), caixa('b', 150, 0, 40, 10), caixa('c', 400, 0, 200, 10)];
    const r = distribuir(caixas, 'horizontal');
    const pos = (id: string, w: number) => ({ left: r[id]!.left!, right: r[id]!.left! + w });
    const a = pos('a', 100);
    const b = pos('b', 40);
    const c = pos('c', 200);
    // Extremos não se movem.
    expect(a.left).toBe(0);
    expect(c.right).toBe(600);
    // Os dois vãos são iguais.
    expect(b.left - a.right).toBeCloseTo(c.left - b.right, 6);
  });

  it('não distribui com menos de 3 caixas', () => {
    expect(distribuir([caixa('a', 0, 0), caixa('b', 10, 0)], 'horizontal')).toEqual({});
  });

  it('distribui no eixo vertical', () => {
    const caixas = [caixa('a', 0, 0, 10, 100), caixa('b', 0, 150, 10, 40), caixa('c', 0, 400, 10, 200)];
    const r = distribuir(caixas, 'vertical');
    expect(r.a!.top).toBe(0);
    expect(r.c!.top! + 200).toBe(600);
    const vao1 = r.b!.top! - (r.a!.top! + 100);
    const vao2 = r.c!.top! - (r.b!.top! + 40);
    expect(vao1).toBeCloseTo(vao2, 6);
  });

  it('funciona mesmo se vierem fora de ordem', () => {
    const caixas = [caixa('c', 400, 0, 200, 10), caixa('a', 0, 0, 100, 10), caixa('b', 150, 0, 40, 10)];
    const r = distribuir(caixas, 'horizontal');
    expect(r.a!.left).toBe(0);
  });
});

describe('reordenar', () => {
  const itens = [{ id: 'fundo' }, { id: 'imagem' }, { id: 'texto' }];

  it('move um item para cima na pilha', () => {
    expect(reordenar(itens, 0, 2).map((i) => i.id)).toEqual(['imagem', 'texto', 'fundo']);
  });

  it('move para baixo', () => {
    expect(reordenar(itens, 2, 0).map((i) => i.id)).toEqual(['texto', 'fundo', 'imagem']);
  });

  it('índice inválido ou sem movimento devolve a mesma lista', () => {
    expect(reordenar(itens, 1, 1)).toBe(itens);
    expect(reordenar(itens, -1, 0)).toBe(itens);
    expect(reordenar(itens, 0, 99)).toBe(itens);
  });
});

describe('moverNaPilha', () => {
  const pilha = (ids: string[]) => ids.map((id) => ({ id }));
  const ids = (itens: { id: string }[]) => itens.map((i) => i.id);

  it('front leva para o topo mantendo a ordem relativa entre os selecionados', () => {
    expect(ids(moverNaPilha(pilha(['a', 'b', 'c', 'd']), ['a', 'c'], 'front'))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('back leva para o fundo', () => {
    expect(ids(moverNaPilha(pilha(['a', 'b', 'c', 'd']), ['c'], 'back'))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('forward avança um', () => {
    expect(ids(moverNaPilha(pilha(['a', 'b', 'c']), ['a'], 'forward'))).toEqual(['b', 'a', 'c']);
  });

  it('backward recua um', () => {
    expect(ids(moverNaPilha(pilha(['a', 'b', 'c']), ['c'], 'backward'))).toEqual(['a', 'c', 'b']);
  });

  it('no topo, avançar não faz nada (e não perde item)', () => {
    expect(ids(moverNaPilha(pilha(['a', 'b']), ['b'], 'forward'))).toEqual(['a', 'b']);
  });

  it('avançar e recuar devolve a pilha ao estado original', () => {
    const inicial = pilha(['a', 'b', 'c', 'd']);
    const ida = moverNaPilha(inicial, ['b'], 'forward');
    expect(ids(moverNaPilha(ida, ['b'], 'backward'))).toEqual(['a', 'b', 'c', 'd']);
  });

  /** Dois vizinhos selecionados não podem trocar de ordem entre si. */
  it('vizinhos selecionados avançam juntos sem se atravessar', () => {
    expect(ids(moverNaPilha(pilha(['a', 'b', 'c', 'd']), ['b', 'c'], 'forward'))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('seleção vazia devolve a pilha intacta', () => {
    const p = pilha(['a', 'b']);
    expect(moverNaPilha(p, [], 'front')).toBe(p);
  });
});
