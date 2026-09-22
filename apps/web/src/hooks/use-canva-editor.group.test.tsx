/**
 * GRUPO — matriz de transformação e persistência (Gate 2.2, §10-12).
 *
 * O risco estrutural aqui é silencioso: agrupar, transformar e desagrupar
 * pode deixar cada filho num lugar diferente do que estava na tela, porque o
 * Fabric reparenteia os filhos para o espaço LOCAL do grupo. Este arquivo
 * mede a caixa absoluta de cada filho antes e depois, em vez de olhar a
 * aparência.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { CanvaObject, CanvaPage } from '@desigual-os/types';
import { installFakeCanvas2d } from '@/lib/canva/test-canvas-2d';
import { useCanvaEditor, type UseCanvaEditorResult } from './use-canva-editor';

installFakeCanvas2d();
// React exige este sinal para não avisar que `act()` roda fora de um ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function forma(id: string, x: number, y: number, w: number, h: number, rotation: number): CanvaObject {
  return {
    id, type: 'shape', shape: 'rect', name: id,
    x, y, width: w, height: h, scaleX: 1, scaleY: 1,
    rotation, opacity: 1, locked: false, visible: true, zIndex: 0,
    fill: '#ffffff', stroke: '#000000', strokeWidth: 0,
  } as CanvaObject;
}

const PAGINA = (): CanvaPage => ({
  id: 'p', order: 0, background: { type: 'color', value: '#ffffff' },
  objects: [
    { ...forma('A', 100, 100, 120, 80, 0), zIndex: 0 },
    { ...forma('B', 300, 220, 60, 200, 15), zIndex: 1 },
    { ...forma('C', 520, 140, 200, 90, -30), zIndex: 2 },
  ] as CanvaObject[],
});

async function montar(pages: CanvaPage[]) {
  const salvos: CanvaPage[][] = [];
  let api: UseCanvaEditorResult | null = null;
  function Harness() {
    api = useCanvaEditor(pages, 1080, 1350, (p) => { salvos.push(p); }, async () => 'about:blank');
    return <div ref={api.containerRef}><canvas ref={api.canvasElRef} /></div>;
  }
  const host = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const passo = async (f: () => void) => {
    await act(async () => { f(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  };
  return { api: () => api!, salvos, passo, desmontar: () => act(() => { root.unmount(); }) };
}

/**
 * Caixa absoluta (alinhada aos eixos) de um objeto do DOCUMENTO.
 *
 * Mede o modelo persistido, não o Fabric: é o modelo que o F5 relê e que a
 * exportação desenha, então é ele que precisa estar certo. O Fabric gira o
 * retângulo em torno do canto superior esquerdo (originX/originY padrão),
 * que é o mesmo que `x`/`y` guardam.
 */
function caixaAbsoluta(o: CanvaObject): { left: number; top: number; width: number; height: number } {
  const w = o.width * o.scaleX;
  const h = o.height * o.scaleY;
  const rad = (o.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sen = Math.sin(rad);
  const cantos = [[0, 0], [w, 0], [w, h], [0, h]].map(([cx, cy]) => [
    o.x + cx! * cos - cy! * sen,
    o.y + cx! * sen + cy! * cos,
  ]);
  const xs = cantos.map((c) => c[0]!);
  const ys = cantos.map((c) => c[1]!);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function caixasDoDocumento(api: UseCanvaEditorResult): Record<string, { left: number; top: number; width: number; height: number }> {
  const saida: Record<string, { left: number; top: number; width: number; height: number }> = {};
  for (const o of api.activePage?.objects ?? []) saida[o.id] = caixaAbsoluta(o);
  return saida;
}

const arredonda = (c: { left: number; top: number; width: number; height: number }) => ({
  left: Math.round(c.left), top: Math.round(c.top), width: Math.round(c.width), height: Math.round(c.height),
});

describe('grupo — transformar e desagrupar', () => {
  it('agrupar, transformar e desagrupar preserva a geometria RELATIVA dos filhos', async () => {
    const h = await montar([PAGINA()]);
    const antesDeTudo = caixasDoDocumento(h.api());
    console.log('ANTES   :', JSON.stringify(Object.fromEntries(Object.entries(antesDeTudo).map(([k, v]) => [k, arredonda(v)]))));

    await h.passo(() => h.api().selectAll());
    await h.passo(() => h.api().groupSelected());
    expect(h.api().activePage!.objects).toHaveLength(1);

    await h.passo(() => h.api().setSelectedPosition(60, 40));
    await h.passo(() => h.api().setSelectedSize(500, 300));
    await h.passo(() => h.api().setSelectedRotation(20));
    const grupoTransformado = arredonda(caixasDoDocumento(h.api())[h.api().activePage!.objects[0]!.id]!);
    console.log('GRUPO   :', JSON.stringify(grupoTransformado));

    await h.passo(() => h.api().ungroupSelected());
    const filhos = caixasDoDocumento(h.api());
    console.log('UNGROUP :', JSON.stringify(Object.fromEntries(Object.entries(filhos).map(([k, v]) => [k, arredonda(v)]))));
    expect(Object.keys(filhos).sort()).toEqual(['A', 'B', 'C']);

    // A transformação do grupo chegou MESMO em cada filho?
    //
    // Previsão independente do Fabric: o grupo saiu de 638x389 para 500x300
    // (escala 0,784 x 0,771) e girou 20 graus. A forma A media 120x80, então
    // dentro do grupo transformado ela mede 94,1 x 61,7 girada 20 graus - e a
    // caixa alinhada aos eixos disso é
    //   w = 94,1*cos20 + 61,7*sen20 = 109,5
    //   h = 94,1*sen20 + 61,7*cos20 = 90,2
    // Se o grupo tivesse sido desmontado sem distribuir a transformação, A
    // voltaria com os 120x80 originais.
    const escalaX = 500 / 638;
    const escalaY = 300 / 389;
    const rad = (20 * Math.PI) / 180;
    const larguraPrevista = 120 * escalaX * Math.cos(rad) + 80 * escalaY * Math.sin(rad);
    const alturaPrevista = 120 * escalaX * Math.sin(rad) + 80 * escalaY * Math.cos(rad);
    console.log('PREVISTO:', Math.round(larguraPrevista), 'x', Math.round(alturaPrevista));
    expect(Math.abs(filhos.A!.width - larguraPrevista)).toBeLessThanOrEqual(2);
    expect(Math.abs(filhos.A!.height - alturaPrevista)).toBeLessThanOrEqual(2);

    // E desagrupar é idempotente: reagrupar e desagrupar de novo não move
    // ninguém mais um milímetro.
    await h.passo(() => h.api().selectAll());
    await h.passo(() => h.api().groupSelected());
    await h.passo(() => h.api().ungroupSelected());
    const filhosDeNovo = caixasDoDocumento(h.api());
    console.log('IDEMPOT :', JSON.stringify(Object.fromEntries(Object.entries(filhosDeNovo).map(([k, v]) => [k, arredonda(v)]))));
    for (const id of ['A', 'B', 'C']) {
      for (const campo of ['left', 'top', 'width', 'height'] as const) {
        expect(Math.abs(filhosDeNovo[id]![campo] - filhos[id]![campo])).toBeLessThanOrEqual(2);
      }
    }

    h.desmontar();
  });

  it('grupo salvo continua sendo um objeto type=group depois de re-hidratar', async () => {
    const h = await montar([PAGINA()]);
    await h.passo(() => h.api().selectAll());
    await h.passo(() => h.api().groupSelected());
    await h.passo(() => h.api().setSelectedPosition(75, 55));

    const payload = h.salvos[h.salvos.length - 1]!;
    const objs = payload[0]!.objects;
    console.log('SALVO   :', objs.map((o) => `${o.type}@${Math.round(o.x)},${Math.round(o.y)}`).join(' '));
    expect(objs).toHaveLength(1);
    expect(objs[0]!.type).toBe('group');
    h.desmontar();

    const recarregado = await montar(payload);
    const depoisF5 = caixasDoDocumento(recarregado.api());
    const ids = Object.keys(depoisF5);
    expect(ids).toHaveLength(1);
    expect(recarregado.api().activePage!.objects[0]!.type).toBe('group');
    console.log('APOS_F5 :', JSON.stringify(arredonda(depoisF5[ids[0]!]!)));
    recarregado.desmontar();
  });

  it('desagrupar depois do F5 devolve os três filhos', async () => {
    const h = await montar([PAGINA()]);
    await h.passo(() => h.api().selectAll());
    await h.passo(() => h.api().groupSelected());
    const payload = h.salvos[h.salvos.length - 1]!;
    h.desmontar();

    const r = await montar(payload);
    const grupoId = Object.keys(caixasDoDocumento(r.api()))[0]!;
    await r.passo(() => r.api().selectObjectById(grupoId));
    await r.passo(() => r.api().ungroupSelected());
    expect(Object.keys(caixasDoDocumento(r.api())).sort()).toEqual(['A', 'B', 'C']);
    r.desmontar();
  });
});

describe('grupo — isolando a origem do desvio', () => {
  it('agrupar e desagrupar SEM transformar devolve cada filho ao lugar exato', async () => {
    const h = await montar([PAGINA()]);
    const antes = caixasDoDocumento(h.api());
    await h.passo(() => h.api().selectAll());
    await h.passo(() => h.api().groupSelected());
    await h.passo(() => h.api().ungroupSelected());
    const depois = caixasDoDocumento(h.api());
    console.log('RT_ANTES :', JSON.stringify(Object.fromEntries(Object.entries(antes).map(([k, v]) => [k, arredonda(v)]))));
    console.log('RT_DEPOIS:', JSON.stringify(Object.fromEntries(Object.entries(depois).map(([k, v]) => [k, arredonda(v)]))));
    for (const id of ['A', 'B', 'C']) {
      expect(arredonda(depois[id]!)).toEqual(arredonda(antes[id]!));
    }
    h.desmontar();
  });

  it('campos crus do objeto grupo depois de transformar', async () => {
    const h = await montar([PAGINA()]);
    await h.passo(() => h.api().selectAll());
    await h.passo(() => h.api().groupSelected());
    const cru = (rotulo: string) => {
      const g = h.api().activePage!.objects[0]!;
      console.log(rotulo, JSON.stringify({ x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width), h: Math.round(g.height), sx: g.scaleX, sy: g.scaleY, r: g.rotation }));
    };
    cru('CRU_APOS_GROUP :');
    await h.passo(() => h.api().setSelectedPosition(60, 40));
    cru('CRU_APOS_POS   :');
    await h.passo(() => h.api().setSelectedSize(500, 300));
    cru('CRU_APOS_SIZE  :');
    await h.passo(() => h.api().setSelectedRotation(20));
    cru('CRU_APOS_ROT   :');
    h.desmontar();
  });
});

/**
 * A raiz do desvio do ungroup, isolada: enquanto existe uma seleção
 * múltipla, o Fabric guarda os filhos em coordenadas RELATIVAS ao centro da
 * `ActiveSelection`. Qualquer leitura do canvas feita nesse estado grava
 * essas coordenadas locais no documento como se fossem absolutas.
 */
describe('leitura do canvas com seleção múltipla ativa', () => {
  it('selecionar vários e commitar NÃO pode mover ninguém', async () => {
    const h = await montar([PAGINA()]);
    const antes = caixasDoDocumento(h.api());
    await h.passo(() => h.api().selectAll());
    // Uma ação qualquer que commite o histórico, sem mexer em posição.
    await h.passo(() => h.api().renameObject('A', 'Camada A'));
    const depois = caixasDoDocumento(h.api());
    console.log('SEL_ANTES :', JSON.stringify(Object.fromEntries(Object.entries(antes).map(([k, v]) => [k, arredonda(v)]))));
    console.log('SEL_DEPOIS:', JSON.stringify(Object.fromEntries(Object.entries(depois).map(([k, v]) => [k, arredonda(v)]))));
    for (const id of ['A', 'B', 'C']) expect(arredonda(depois[id]!)).toEqual(arredonda(antes[id]!));
    h.desmontar();
  });
});
