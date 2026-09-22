/**
 * FORENSE DO REORDER (Gate 2.2).
 *
 * Monta o hook DE VERDADE num jsdom e roda a transação inteira:
 * hidratar -> reordenar -> flush -> payload de autosave -> re-hidratar.
 * O objetivo não é testar uma reimplementação da lógica: é rodar o mesmo
 * código que o navegador roda e ver em qual etapa a ordem diverge.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvaPage, CanvaObject } from '@desigual-os/types';
import { installFakeCanvas2d } from '@/lib/canva/test-canvas-2d';
import { useCanvaEditor, type UseCanvaEditorResult } from './use-canva-editor';

installFakeCanvas2d();
// React exige este sinal para não avisar que `act()` roda fora de um ambiente de teste.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function shape(id: string, zIndex: number): CanvaObject {
  return {
    id, type: 'shape', shape: 'rect', name: id,
    x: 10 * zIndex, y: 10 * zIndex, width: 50, height: 50,
    scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
    locked: false, visible: true, zIndex,
    fill: '#ffffff', stroke: '#000000', strokeWidth: 0,
  } as CanvaObject;
}

const pagina = (): CanvaPage => ({
  id: 'page-1', order: 0,
  background: { type: 'color', value: '#ffffff' },
  objects: [shape('BACKGROUND', 0), shape('IMAGE', 1), shape('SHAPE', 2), shape('TEXT', 3)],
});

async function montar() {
  const salvos: CanvaPage[][] = [];
  let api: UseCanvaEditorResult | null = null;

  function Harness() {
    api = useCanvaEditor(
      [pagina()], 1080, 1350,
      (pages) => { salvos.push(pages); },
      async () => 'about:blank',
    );
    return (
      <div ref={api.containerRef} style={{ width: 800, height: 600 }}>
        <canvas ref={api.canvasElRef} />
      </div>
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  // O setup do canvas carrega os objetos de forma assíncrona.
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  return {
    api: () => api!,
    salvos,
    desmontar: () => act(() => { root.unmount(); }),
  };
}

/** Ordem VISUAL (topo primeiro) - a mesma que o painel Camadas mostra. */
const ordemVisual = (page: CanvaPage | undefined) =>
  [...(page?.objects ?? [])].sort((a, b) => b.zIndex - a.zIndex).map((o) => o.id);

/** Ordem do ARRAY como está gravado (fundo primeiro). */
const ordemArray = (page: CanvaPage | undefined) => (page?.objects ?? []).map((o) => o.id);
const zIndexes = (page: CanvaPage | undefined) => (page?.objects ?? []).map((o) => `${o.id}:${o.zIndex}`);

describe('reorder de camada — trace completo', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('hidrata na ordem esperada', async () => {
    const h = await montar();
    expect(ordemVisual(h.api().activePage)).toEqual(['TEXT', 'SHAPE', 'IMAGE', 'BACKGROUND']);
    h.desmontar();
  });

  it('mover IMAGE do índice visual 2 para o 0 persiste no payload de autosave', async () => {
    const h = await montar();
    const antes = ordemVisual(h.api().activePage);
    console.log('UI_ANTES        :', antes.join(','));
    console.log('ARRAY_ANTES     :', ordemArray(h.api().activePage).join(','));

    // Visual: [TEXT, SHAPE, IMAGE, BACKGROUND] -> mover IMAGE (2) para o topo (0)
    await act(async () => { h.api().reorderObject(2, 0); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const depois = ordemVisual(h.api().activePage);
    console.log('UI_DEPOIS       :', depois.join(','));
    console.log('ARRAY_DEPOIS    :', ordemArray(h.api().activePage).join(','));
    console.log('ZINDEX_DEPOIS   :', zIndexes(h.api().activePage).join(' '));

    const ultimoSalvo = h.salvos[h.salvos.length - 1]?.[0];
    console.log('PAYLOAD_VISUAL  :', ordemVisual(ultimoSalvo).join(','));
    console.log('PAYLOAD_ARRAY   :', ordemArray(ultimoSalvo).join(','));
    console.log('PAYLOAD_ZINDEX  :', zIndexes(ultimoSalvo).join(' '));

    expect(depois).toEqual(['IMAGE', 'TEXT', 'SHAPE', 'BACKGROUND']);
    // Isto é o que o F5 vai reler: se divergir aqui, o defeito é ANTES da rede.
    expect(ordemVisual(ultimoSalvo)).toEqual(['IMAGE', 'TEXT', 'SHAPE', 'BACKGROUND']);
    h.desmontar();
  });
});

/**
 * Reprodução do cenário EXATO do G2-08/10, que era o teste que falhava:
 * documento novo (vazio), duas formas criadas pelo próprio editor, drag
 * entre as duas linhas, depois ocultar a primeira.
 */
describe('reorder no cenário do G2-08/10', () => {
  async function montarVazio() {
    const salvos: CanvaPage[][] = [];
    let api: UseCanvaEditorResult | null = null;
    function Harness() {
      api = useCanvaEditor(
        [{ id: 'p', order: 0, background: { type: 'color', value: '#ffffff' }, objects: [] }],
        1080, 1350,
        (pages) => { salvos.push(pages); },
        async () => 'about:blank',
      );
      return <div ref={api.containerRef}><canvas ref={api.canvasElRef} /></div>;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    return { api: () => api!, salvos, desmontar: () => act(() => { root.unmount(); }) };
  }

  it('duas formas criadas na sessão: drag 0->1 chega íntegro no payload', async () => {
    const h = await montarVazio();
    await act(async () => { h.api().addShape('rect'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await act(async () => { h.api().addShape('ellipse'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const antes = ordemVisual(h.api().activePage);
    console.log('G2-10 UI_ANTES   :', antes.join(','), '|', zIndexes(h.api().activePage).join(' '));
    expect(antes).toHaveLength(2);

    await act(async () => { h.api().reorderObject(0, 1); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const depois = ordemVisual(h.api().activePage);
    console.log('G2-10 UI_DEPOIS  :', depois.join(','), '|', zIndexes(h.api().activePage).join(' '));
    expect(depois).toEqual([...antes].reverse());

    const payloadReorder = ordemVisual(h.salvos[h.salvos.length - 1]?.[0]);
    console.log('G2-10 PAYLOAD_R  :', payloadReorder.join(','));
    expect(payloadReorder).toEqual(depois);

    // ...e agora a etapa seguinte do teste real: ocultar a camada do topo.
    const topo = depois[0]!;
    await act(async () => { h.api().setObjectVisible(topo, false); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const depoisDeOcultar = ordemVisual(h.api().activePage);
    const payloadFinal = ordemVisual(h.salvos[h.salvos.length - 1]?.[0]);
    console.log('G2-10 UI_OCULTAR :', depoisDeOcultar.join(','), '|', zIndexes(h.api().activePage).join(' '));
    console.log('G2-10 PAYLOAD_F  :', payloadFinal.join(','), '|', zIndexes(h.salvos[h.salvos.length - 1]?.[0]).join(' '));

    // Este é o estado que o F5 vai reler.
    expect(payloadFinal).toEqual(depois);
    h.desmontar();
  });
});

/**
 * Fecha o ciclo: pega o payload que o autosave receberia, monta um editor
 * NOVO com ele (que é exatamente o que o F5 faz) e compara. Se a ordem
 * sobrevive a isto, ela sobrevive ao recarregamento.
 */
async function montarCom(pages: CanvaPage[]) {
  const salvos: CanvaPage[][] = [];
  let api: UseCanvaEditorResult | null = null;
  function Harness() {
    api = useCanvaEditor(pages, 1080, 1350, (p) => { salvos.push(p); }, async () => 'about:blank');
    return <div ref={api.containerRef}><canvas ref={api.canvasElRef} /></div>;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  return { api: () => api!, salvos, desmontar: () => act(() => { root.unmount(); }) };
}

describe('reorder sobrevive ao recarregamento', () => {
  it('o payload salvo re-hidrata na MESMA ordem visual', async () => {
    const h = await montar();
    await act(async () => { h.api().reorderObject(2, 0); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const esperado = ordemVisual(h.api().activePage);
    const payload = h.salvos[h.salvos.length - 1]!;
    h.desmontar();

    const recarregado = await montarCom(payload);
    console.log('APOS_F5_UI      :', ordemVisual(recarregado.api().activePage).join(','));
    expect(ordemVisual(recarregado.api().activePage)).toEqual(esperado);
    recarregado.desmontar();
  });

  it('undo volta a ordem anterior e redo devolve a nova, e ambas re-hidratam', async () => {
    const h = await montar();
    const inicial = ordemVisual(h.api().activePage);
    await act(async () => { h.api().reorderObject(2, 0); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const nova = ordemVisual(h.api().activePage);
    expect(nova).not.toEqual(inicial);

    await act(async () => { h.api().undo(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(ordemVisual(h.api().activePage)).toEqual(inicial);
    const payloadUndo = h.salvos[h.salvos.length - 1]!;

    await act(async () => { h.api().redo(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(ordemVisual(h.api().activePage)).toEqual(nova);
    const payloadRedo = h.salvos[h.salvos.length - 1]!;
    h.desmontar();

    const aposUndo = await montarCom(payloadUndo);
    expect(ordemVisual(aposUndo.api().activePage)).toEqual(inicial);
    aposUndo.desmontar();

    const aposRedo = await montarCom(payloadRedo);
    expect(ordemVisual(aposRedo.api().activePage)).toEqual(nova);
    aposRedo.desmontar();
  });
});

/** §9 do Gate 2.2: os quatro comandos usam a mesma transação do arrasto. */
describe('comandos de pilha', () => {
  async function selecionarEChamar(comando: 'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward', id: string) {
    const h = await montar();
    await act(async () => { h.api().selectObjectById(id); });
    await act(async () => { h.api()[comando](); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const visual = ordemVisual(h.api().activePage);
    const payload = ordemVisual(h.salvos[h.salvos.length - 1]?.[0]);
    h.desmontar();
    return { visual, payload };
  }

  it('trazer para a frente coloca no topo e persiste', async () => {
    const r = await selecionarEChamar('bringToFront', 'BACKGROUND');
    expect(r.visual).toEqual(['BACKGROUND', 'TEXT', 'SHAPE', 'IMAGE']);
    expect(r.payload).toEqual(r.visual);
  });

  it('enviar para trás coloca no fundo e persiste', async () => {
    const r = await selecionarEChamar('sendToBack', 'TEXT');
    expect(r.visual).toEqual(['SHAPE', 'IMAGE', 'BACKGROUND', 'TEXT']);
    expect(r.payload).toEqual(r.visual);
  });

  it('avançar sobe um degrau e persiste', async () => {
    const r = await selecionarEChamar('bringForward', 'IMAGE');
    expect(r.visual).toEqual(['TEXT', 'IMAGE', 'SHAPE', 'BACKGROUND']);
    expect(r.payload).toEqual(r.visual);
  });

  it('recuar desce um degrau e persiste', async () => {
    const r = await selecionarEChamar('sendBackward', 'SHAPE');
    expect(r.visual).toEqual(['TEXT', 'IMAGE', 'SHAPE', 'BACKGROUND']);
    expect(r.payload).toEqual(r.visual);
  });
});
