/**
 * ESCALA — 100 objetos (Gate 2.2, §34).
 *
 * O que isto mede: o custo das operações do EDITOR sobre um documento de 100
 * objetos - reler o canvas, reempilhar, alinhar, distribuir, serializar.
 * O que isto NÃO mede: quadros por segundo, tempo de pintura, se o cursor
 * "trava" ao arrastar. Isso depende de um canvas real e só o navegador
 * responde; está declarado como pendente no relatório, não escondido aqui.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { CanvaObject, CanvaPage } from '@desigual-os/types';
import { installFakeCanvas2d } from '@/lib/canva/test-canvas-2d';
import { useCanvaEditor, type UseCanvaEditorResult } from './use-canva-editor';

installFakeCanvas2d();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOTAL = 100;

function documento(): CanvaPage[] {
  const objects: CanvaObject[] = Array.from({ length: TOTAL }, (_, i) => ({
    id: `obj-${i}`, type: 'shape', shape: i % 2 === 0 ? 'rect' : 'ellipse', name: `Camada ${i}`,
    x: (i % 10) * 100 + 20, y: Math.floor(i / 10) * 120 + 20,
    width: 80, height: 60, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
    locked: false, visible: true, zIndex: i,
    fill: '#ffffff', stroke: '#000000', strokeWidth: 0,
  }) as unknown as CanvaObject);
  return [{ id: 'p', order: 0, background: { type: 'color', value: '#ffffff' }, objects }];
}

/**
 * Teto explícito de 30s, e não o default de 5s do vitest.
 *
 * Este teste monta 100 objetos do Fabric dentro do jsdom. Rodando sozinho leva
 * ~370ms; rodando junto com os outros 17 arquivos em paralelo, ele DISPUTA CPU
 * com todos e o mesmo trabalho passa dos 5s - flagrado assim no portão de
 * release de 18/09/2026, verde quando isolado e vermelho na suíte inteira.
 *
 * Nenhuma asserção foi afrouxada: o que muda é só quanto tempo o teste pode
 * levar numa máquina ocupada. Teste que pisca é pior que teste que falta -
 * ensina a equipe a ignorar vermelho.
 */
const TETO_MS = 30_000;

describe('documento com 100 objetos', () => {
  it('hidrata, reordena, alinha e distribui sem perder nem duplicar objeto', async () => {
    const salvos: CanvaPage[][] = [];
    let api: UseCanvaEditorResult | null = null;
    function Harness() {
      api = useCanvaEditor(documento(), 1080, 1350, (p) => { salvos.push(p); }, async () => 'about:blank');
      return <div ref={api.containerRef}><canvas ref={api.canvasElRef} /></div>;
    }
    const host = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(host);
    const root = createRoot(host);

    const t0 = performance.now();
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    const tHidratar = performance.now() - t0;
    expect(api!.activePage!.objects).toHaveLength(TOTAL);

    const cronometrar = async (rotulo: string, f: () => void) => {
      const inicio = performance.now();
      await act(async () => { f(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const ms = performance.now() - inicio;
      console.log(`${rotulo.padEnd(24)}: ${ms.toFixed(1)}ms`);
      return ms;
    };

    console.log(`${'hidratar 100 objetos'.padEnd(24)}: ${tHidratar.toFixed(1)}ms`);
    const tReorder = await cronometrar('reordenar (99 -> 0)', () => api!.reorderObject(99, 0));
    await cronometrar('selecionar tudo', () => api!.selectAll());
    const tAlinhar = await cronometrar('alinhar 100 à esquerda', () => api!.alignSelected('left'));
    const tDistribuir = await cronometrar('distribuir 100', () => api!.distributeSelected('vertical'));
    await cronometrar('desfazer', () => api!.undo());
    await cronometrar('refazer', () => api!.redo());

    // Nada sumiu e nada duplicou em nenhuma das operações.
    const ids = api!.activePage!.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(salvos[salvos.length - 1]![0]!.objects).toHaveLength(TOTAL);

    // Teto folgado: serve só para pegar uma regressão de ORDEM DE GRANDEZA
    // (um laço quadrático novo, por exemplo), não para medir fluidez.
    expect(tReorder).toBeLessThan(3000);
    expect(tAlinhar).toBeLessThan(3000);
    expect(tDistribuir).toBeLessThan(3000);

    await act(() => { root.unmount(); });
  }, TETO_MS);
});
