/**
 * PERSISTÊNCIA E HISTÓRICO (Gate 2.2, §30-31 e G2-12/G2-13).
 *
 * Tudo aqui mede o DOCUMENTO — o que o autosave envia e o que o F5 relê.
 * Pixel não é medido neste arquivo: para isso o teste tem que ser no
 * navegador, onde o canvas é real (ver lib/canva/test-canvas-2d.ts).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { CanvaObject, CanvaPage, CanvaTextObject, CanvaImageObject } from '@desigual-os/types';
import { installFakeCanvas2d, installFakeImage } from '@/lib/canva/test-canvas-2d';
import { useCanvaEditor, type UseCanvaEditorResult } from './use-canva-editor';

installFakeCanvas2d();
installFakeImage();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  return {
    api: () => api!,
    ultimoSalvo: () => salvos[salvos.length - 1]!,
    passo,
    desmontar: () => act(() => { root.unmount(); }),
  };
}

const VAZIA = (): CanvaPage[] => [
  { id: 'p', order: 0, background: { type: 'color', value: '#ffffff' }, objects: [] },
];

/** Assinatura estável de um documento, para comparar antes/depois do F5. */
function assinatura(pages: CanvaPage[]): string {
  return JSON.stringify(
    pages.map((p) => ({
      id: p.id,
      background: p.background,
      objects: p.objects.map((o) => ({ ...o, id: undefined })),
    })),
  );
}

describe('G2-12 — tipografia persiste', () => {
  it('todas as dimensões de texto sobrevivem ao recarregamento', async () => {
    const h = await montar(VAZIA());
    await h.passo(() => h.api().addText('title'));
    await h.passo(() =>
      h.api().updateSelectedText({
        fontFamily: 'Georgia', fontSize: 64, fontWeight: 800, fontStyle: 'italic',
        textAlign: 'right', lineHeight: 1.45, letterSpacing: 120, underline: true, fill: '#7b2eff',
      }),
    );
    await h.passo(() => h.api().setSelectedOpacity(0.6));

    const payload = h.ultimoSalvo();
    const t = payload[0]!.objects[0] as CanvaTextObject;
    console.log('TEXTO_SALVO:', JSON.stringify({ f: t.fontFamily, s: t.fontSize, w: t.fontWeight, st: t.fontStyle, a: t.textAlign, lh: t.lineHeight, ls: t.letterSpacing, u: t.underline, c: t.fill, o: t.opacity }));
    h.desmontar();

    const r = await montar(payload);
    const depois = r.api().activePage!.objects[0] as CanvaTextObject;
    expect(depois.fontFamily).toBe('Georgia');
    expect(depois.fontSize).toBe(64);
    expect(depois.fontWeight).toBe(800);
    expect(depois.fontStyle).toBe('italic');
    expect(depois.textAlign).toBe('right');
    expect(depois.lineHeight).toBeCloseTo(1.45, 2);
    expect(depois.letterSpacing).toBe(120);
    expect(depois.underline).toBe(true);
    expect(depois.fill).toBe('#7b2eff');
    expect(depois.opacity).toBeCloseTo(0.6, 2);
    r.desmontar();
  });
});

describe('sombra de texto e forma persiste', () => {
  it('liga sombra no texto, sobrevive ao recarregamento e dá pra desligar de novo', async () => {
    const h = await montar(VAZIA());
    await h.passo(() => h.api().addText('title'));
    await h.passo(() => h.api().updateSelectedText({ shadow: true }));

    const payload = h.ultimoSalvo();
    const t = payload[0]!.objects[0] as CanvaTextObject;
    expect(t.shadow).toBe(true);
    h.desmontar();

    const r = await montar(payload);
    const depois = r.api().activePage!.objects[0] as CanvaTextObject;
    expect(depois.shadow).toBe(true);

    await r.passo(() => r.api().selectObjectById(depois.id));
    await r.passo(() => r.api().updateSelectedText({ shadow: false }));
    const semSombra = r.ultimoSalvo()[0]!.objects[0] as CanvaTextObject;
    expect(semSombra.shadow).toBe(false);
    r.desmontar();
  });
});

/**
 * Mede o MODELO de filtros (acumular, desfazer, persistir). Que o pixel
 * resultante fique bonito é outra pergunta, e essa só o navegador responde.
 */
describe('G2-13 — controles de imagem', () => {
  const comImagem = (): CanvaPage[] => [{
    id: 'p', order: 0, background: { type: 'color', value: '#ffffff' },
    objects: [{
      id: 'img', type: 'image', name: 'Foto', src: 'about:blank',
      x: 40, y: 60, width: 300, height: 200, scaleX: 1, scaleY: 1,
      rotation: 0, opacity: 1, locked: false, visible: true, zIndex: 0,
      flipX: false, flipY: false, cropX: 0, cropY: 0,
    } as unknown as CanvaObject],
  }];

  /** O defeito original: cada filtro novo zerava o anterior. */
  it('dois filtros em sequência coexistem e persistem', async () => {
    const h = await montar(comImagem());
    await h.passo(() => h.api().selectObjectById('img'));
    await h.passo(() => h.api().updateSelectedImageFilters({ brightness: 0.25 }));
    await h.passo(() => h.api().updateSelectedImageFilters({ contrast: -0.15 }));
    await h.passo(() => h.api().updateSelectedImageFilters({ saturation: 0.4 }));
    await h.passo(() => h.api().updateSelectedImageFilters({ blur: 0.3 }));
    await h.passo(() => h.api().flipSelected('x'));
    await h.passo(() => h.api().setSelectedOpacity(0.8));

    const payload = h.ultimoSalvo();
    const img = payload[0]!.objects[0] as CanvaImageObject;
    console.log('IMAGEM_SALVA:', JSON.stringify({ ...img.filters, flipX: img.flipX, o: img.opacity }));
    h.desmontar();

    const r = await montar(payload);
    const depois = r.api().activePage!.objects[0] as CanvaImageObject;
    expect(depois.filters?.brightness).toBeCloseTo(0.25, 3);
    expect(depois.filters?.contrast).toBeCloseTo(-0.15, 3);
    expect(depois.filters?.saturation).toBeCloseTo(0.4, 3);
    expect(depois.filters?.blur).toBeCloseTo(0.3, 3);
    expect(depois.flipX).toBe(true);
    expect(depois.opacity).toBeCloseTo(0.8, 2);
    r.desmontar();
  });

  it('desfazer um filtro devolve o valor anterior sem apagar os outros', async () => {
    const h = await montar(comImagem());
    await h.passo(() => h.api().selectObjectById('img'));
    await h.passo(() => h.api().updateSelectedImageFilters({ brightness: 0.25 }));
    await h.passo(() => h.api().updateSelectedImageFilters({ contrast: -0.15 }));
    await h.passo(() => h.api().undo());
    const img = h.api().activePage!.objects[0] as CanvaImageObject;
    expect(img.filters?.brightness).toBeCloseTo(0.25, 3);
    expect(img.filters?.contrast ?? 0).toBeCloseTo(0, 3);
    h.desmontar();
  });
});

describe('G2-17 — torture test do histórico', () => {
  it('desfazer tudo volta ao estado inicial e refazer tudo volta ao final', async () => {
    const h = await montar(VAZIA());

    // Sequência da §30 do briefing.
    await h.passo(() => h.api().addShape('rect'));
    const idA = h.api().activePage!.objects[0]!.id;
    await h.passo(() => h.api().addShape('ellipse'));
    const idB = h.api().activePage!.objects[1]!.id;
    await h.passo(() => h.api().addShape('triangle'));
    const inicial = assinatura(h.api().pages);
    const passos: (() => void)[] = [
      () => h.api().selectObjectById(idA),
      () => h.api().setSelectedPosition(120, 240),
      () => h.api().setSelectedSize(320, 180),
      () => h.api().setSelectedRotation(35),
      () => h.api().updateSelectedShape({ fill: '#7b2eff' }),
      () => h.api().setSelectedOpacity(0.55),
      () => h.api().selectAll(),
      () => h.api().alignSelected('left'),
      () => h.api().distributeSelected('vertical'),
      () => h.api().renameObject(idA, 'Fundo do CTA'),
      () => h.api().setObjectVisible(idB, false),
      () => h.api().setObjectVisible(idB, true),
      () => h.api().setObjectLocked(idB, true),
      () => h.api().setObjectLocked(idB, false),
      () => h.api().reorderObject(0, 2),
    ];
    for (const p of passos) await h.passo(p);
    const final = assinatura(h.api().pages);
    expect(final).not.toBe(inicial);

    // Desfaz até o fim.
    let voltas = 0;
    while (h.api().canUndo && voltas < 80) {
      await h.passo(() => h.api().undo());
      voltas += 1;
    }
    console.log('TORTURE undo passos:', voltas);
    const depoisDeDesfazerTudo = assinatura(h.api().pages);
    expect(depoisDeDesfazerTudo).toBe(assinatura([{ id: 'p', order: 0, background: { type: 'color', value: '#ffffff' }, objects: [] }]));

    // Refaz até o fim.
    let idas = 0;
    while (h.api().canRedo && idas < 80) {
      await h.passo(() => h.api().redo());
      idas += 1;
    }
    console.log('TORTURE redo passos:', idas);
    expect(assinatura(h.api().pages)).toBe(final);
    h.desmontar();
  });
});

describe('G2-18 — F5 de documento complexo', () => {
  it('a serialização antes e depois do recarregamento é idêntica', async () => {
    const h = await montar(VAZIA());
    await h.passo(() => h.api().addShape('rect'));
    const idForma = h.api().activePage!.objects[0]!.id;
    await h.passo(() => h.api().addText('title'));
    await h.passo(() => h.api().updateSelectedText({ fontFamily: 'Georgia', fontSize: 48, underline: true, fill: '#1b1b1f' }));
    const idTexto = h.api().activePage!.objects[1]!.id;
    await h.passo(() => h.api().addShape('ellipse'));
    await h.passo(() => h.api().addShape('star'));
    await h.passo(() => h.api().selectObjectById(idForma));
    await h.passo(() => h.api().updateSelectedShape({ fill: '#7b2eff', stroke: '#00d6a4', strokeWidth: 6 }));
    await h.passo(() => h.api().renameObject(idForma, 'Fundo'));
    await h.passo(() => h.api().renameObject(idTexto, 'Headline'));
    await h.passo(() => h.api().setObjectVisible(h.api().activePage!.objects[2]!.id, false));
    await h.passo(() => h.api().setObjectLocked(h.api().activePage!.objects[3]!.id, true));
    await h.passo(() => h.api().reorderObject(3, 0));
    await h.passo(() => h.api().setPageBackground({ type: 'color', value: '#0b0b0d' }));

    const payload = h.ultimoSalvo();
    // Sem isto, dois documentos VAZIOS passariam a comparação: foi
    // exatamente o que aconteceu enquanto `setPageBackground` apagava tudo.
    expect(payload[0]!.objects).toHaveLength(4);
    expect(payload[0]!.background.value).toBe('#0b0b0d');
    const antes = assinatura(payload);
    console.log('F5_ANTES objetos:', payload[0]!.objects.map((o) => `${o.name ?? o.type}${o.visible ? '' : '(oculto)'}${o.locked ? '(travado)' : ''}:${o.zIndex}`).join(' '));
    h.desmontar();

    const r = await montar(payload);
    const depois = assinatura(r.api().pages);
    console.log('F5_DEPOIS objetos:', r.api().activePage!.objects.map((o) => `${o.name ?? o.type}${o.visible ? '' : '(oculto)'}${o.locked ? '(travado)' : ''}:${o.zIndex}`).join(' '));
    expect(depois).toBe(antes);
    r.desmontar();
  });
});

describe('páginas — apagar uma não pode contaminar a outra', () => {
  it('apagar a página ATIVA preserva o conteúdo da página vizinha', async () => {
    const h = await montar(VAZIA());
    // Página 1 com três formas.
    await h.passo(() => h.api().addShape('rect'));
    await h.passo(() => h.api().addShape('ellipse'));
    await h.passo(() => h.api().addShape('triangle'));
    expect(h.api().activePage!.objects).toHaveLength(3);
    const idPagina1 = h.api().activePageId;

    // Página 2 com UMA forma.
    await h.passo(() => h.api().addPage());
    const idPagina2 = h.api().activePageId;
    expect(idPagina2).not.toBe(idPagina1);
    await h.passo(() => h.api().addShape('star'));
    expect(h.api().activePage!.objects).toHaveLength(1);

    // Apaga a página 2, que é a ATIVA. O canvas ainda tem os objetos dela.
    await h.passo(() => h.api().deletePage(idPagina2));
    expect(h.api().pages).toHaveLength(1);
    expect(h.api().activePageId).toBe(idPagina1);
    const sobrou = h.api().activePage!.objects;
    console.log('PAGINA_RESTANTE:', sobrou.map((o) => o.type + ':' + (o as { shape?: string }).shape).join(' '));
    expect(sobrou).toHaveLength(3);

    // E o que foi salvo é o mesmo.
    const payload = h.ultimoSalvo();
    expect(payload).toHaveLength(1);
    expect(payload[0]!.objects).toHaveLength(3);
    h.desmontar();
  });
});
