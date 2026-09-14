'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveSelection, Canvas, Group, PencilBrush, util, type FabricObject, type Path } from 'fabric';
import type {
  CanvaBlendMode,
  CanvaImageFilters,
  CanvaImageObject,
  CanvaObject,
  CanvaObjectType,
  CanvaPage,
  CanvaPageBackground,
  CanvaPathObject,
  CanvaShapeKind,
  CanvaShapeObject,
  CanvaTextObject,
} from '@desigual-os/types';
import {
  blendModeToComposite,
  buildClipShape,
  clipShapeKindOf,
  buildFallbackExisting,
  cloneCanvaObject,
  computeImagePlacement,
  defaultShapeStroke,
  instantiateFabricObject,
  isManaged,
  loadImageElement,
  readCanvaObject,
  type FabricObjectWithMeta,
} from '@/lib/canva/fabric-sync';
import { loadFontVariant } from '@/lib/canva/font-manager';
import { toast } from '@/stores/toast-store';

const MAX_HISTORY = 60;
const SNAP_THRESHOLD = 6;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** Resolução interna do canvas = até 2x o tamanho do documento, não MAX_ZOOM (4x):
 * um PSD importado em resolução de impressão (ex: A4 a 300dpi) já é grande
 * sozinho - multiplicar por 4 arrisca estourar o limite de pixels de canvas
 * do navegador (Chrome: ~268M px totais). 2x já deixa nítido até 200% de
 * zoom (o preset mais usado) com folga de sobra pra documentos grandes. */
const RENDER_OVERSAMPLE = 2;

/**
 * Achado real (2026-09-10): RENDER_OVERSAMPLE fixo em 2x, sem teto, quebrava
 * PSDs de resolução de impressão importados ("não carrega pra edição",
 * "espaço saindo cortado") - um documento de, digamos, 4960x7016 (A4 300dpi)
 * vezes 2 gera um backstore de ~9920x14032px. Isso estoura limites reais de
 * canvas do navegador (Safari historicamente trava por volta de 4096px por
 * lado; mesmo o teto de área do Chrome fica apertado), e o resultado não é
 * um erro visível - é canvas em branco ou recortado silenciosamente. Este
 * teto reduz o oversample (nunca abaixo de 1x = nítido só até 100% de zoom)
 * pra documentos grandes, em vez de arriscar estourar o backstore.
 */
const MAX_BACKSTORE_SIDE = 4096;

/**
 * Achado real (2026-09-10, prioridade explícita do usuário: "performance com
 * documento grande"): lendo o código-fonte do fabric@6.9.1
 * (canvas/DOMManagers/util.mjs, setCanvasDimensions), `enableRetinaScaling`
 * (default TRUE) já multiplica o backstore que passamos pra
 * `canvas.setDimensions` por `window.devicePixelRatio` sozinho, POR DENTRO -
 * numa tela Retina comum (dpr=2), nosso `RENDER_OVERSAMPLE` empilhava em
 * cima disso: backstore final = documentSide * oversample * dpr. Com
 * oversample=2 e dpr=2, isso é 4x de lado = 16x de pixels totais pra
 * compor a cada frame, sem ganho real de nitidez (o dpr sozinho já cobre a
 * nitidez nativa da tela) - só custo de performance. O teto agora considera
 * o backstore FINAL (pós-dpr), não só o nosso fator, então documentos
 * grandes em tela Retina recebem MENOS oversample extra (o dpr já fez parte
 * do trabalho de nitidez de graça).
 */
function computeRenderOversample(documentWidth: number, documentHeight: number): number {
  const maxSide = Math.max(documentWidth, documentHeight);
  if (maxSide <= 0) return RENDER_OVERSAMPLE;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const budget = MAX_BACKSTORE_SIDE / dpr;
  return Math.max(1, Math.min(RENDER_OVERSAMPLE, budget / maxSide));
}

function sameNumberArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameGuideArrays(prev: { vertical: number[]; horizontal: number[] }, vertical: number[], horizontal: number[]): boolean {
  return sameNumberArray(prev.vertical, vertical) && sameNumberArray(prev.horizontal, horizontal);
}

function deepClonePages(pages: CanvaPage[]): CanvaPage[] {
  return JSON.parse(JSON.stringify(pages)) as CanvaPage[];
}

function newId(): string {
  return crypto.randomUUID();
}

/** `Canvas.backgroundImage` é tipado como `FabricObject` puro (sem `| undefined`)
 * mesmo sendo uma propriedade opcional em tempo de execução - `exactOptionalPropertyTypes`
 * barra `= undefined` direto. Fabric internamente só faz um check de truthy, então
 * limpar de verdade funciona; só a assinatura do .d.ts está imprecisa aqui. */
function clearBackgroundImage(canvas: Canvas): void {
  canvas.backgroundImage = undefined as unknown as FabricObject;
}

function defaultTextObject(variant: 'title' | 'subtitle' | 'body', canvasWidth: number, canvasHeight: number): CanvaTextObject {
  const presets = {
    title: { text: 'Adicionar título', fontSize: 64, fontWeight: 800, width: canvasWidth * 0.8 },
    subtitle: { text: 'Adicionar subtítulo', fontSize: 36, fontWeight: 600, width: canvasWidth * 0.7 },
    body: { text: 'Adicionar texto', fontSize: 22, fontWeight: 400, width: canvasWidth * 0.6 },
  }[variant];

  return {
    id: newId(),
    type: 'text',
    x: (canvasWidth - presets.width) / 2,
    y: canvasHeight / 2 - presets.fontSize,
    width: presets.width,
    height: presets.fontSize * 1.4,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    zIndex: 0,
    text: presets.text,
    fontFamily: 'Work Sans',
    fontSize: presets.fontSize,
    fontWeight: presets.fontWeight,
    fontStyle: 'normal',
    fill: '#0f0f0f',
    textAlign: 'left',
    letterSpacing: 0,
    lineHeight: 1.16,
    underline: false,
    uppercase: false,
  };
}

function defaultShapeObject(shape: CanvaShapeKind, canvasWidth: number, canvasHeight: number): CanvaShapeObject {
  const size = Math.min(canvasWidth, canvasHeight) * 0.35;
  const { fill, stroke, strokeWidth } = defaultShapeStroke(shape);
  return {
    id: newId(),
    type: 'shape',
    shape,
    x: (canvasWidth - size) / 2,
    y: (canvasHeight - size) / 2,
    width: size,
    height: shape === 'line' ? 4 : size,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    zIndex: 0,
    fill,
    stroke,
    strokeWidth,
    cornerRadius: shape === 'rect' ? 0 : undefined,
  };
}

export interface CanvaSelectionState {
  ids: string[];
  type: CanvaObjectType | 'multiple' | null;
  /** Snapshot dos dados do único objeto selecionado (pra alimentar a toolbar de texto/forma/imagem). */
  object: CanvaObject | null;
}

export interface CanvaGuides {
  vertical: number[];
  horizontal: number[];
}

/**
 * Motor do editor Studio > Canva. Uma instância de fabric.Canvas renderiza
 * SEMPRE a página ativa; as demais páginas ficam só como dados (CanvaPage[])
 * até virarem ativas. `pagesRef` é a fonte de verdade completa do documento -
 * a página ativa só é sincronizada de volta pra lá em pontos de corte
 * (trocar de página, autosave, commit de histórico, export), não a cada
 * frame, pra não gerar overhead lendo o canvas inteiro a cada movimento.
 */
export function useCanvaEditor(
  initialPages: CanvaPage[],
  documentWidth: number,
  documentHeight: number,
  onChange: (pages: CanvaPage[]) => void,
  /** Chamado pra todo arquivo local (paste/drag do computador) - o resultado
   * (URL permanente no Storage) que vira `src`, nunca um data: URL cru: além
   * de inchar o JSON salvo, um upload de verdade é o que faz a imagem colada
   * aparecer no painel "Uploads" (pedido explícito do usuário, 2026-09-11). */
  uploadImageFile: (file: File) => Promise<string>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const pagesRef = useRef<CanvaPage[]>(initialPages.length > 0 ? initialPages : [
    { id: newId(), order: 0, background: { type: 'color', value: '#ffffff' }, objects: [] },
  ]);
  const activePageIdRef = useRef<string>(pagesRef.current[0]!.id);
  const clipboardRef = useRef<CanvaObject[] | null>(null);
  const historyRef = useRef<{ stack: CanvaPage[][]; index: number }>({ stack: [deepClonePages(pagesRef.current)], index: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loadTokenRef = useRef(0);

  const [pagesVersion, setPagesVersion] = useState(0);
  const [activePageId, setActivePageIdState] = useState(activePageIdRef.current);
  const [zoom, setZoomState] = useState(1);
  const [selection, setSelection] = useState<CanvaSelectionState>({ ids: [], type: null, object: null });
  const [isReady, setIsReady] = useState(false);
  const [guides, setGuides] = useState<CanvaGuides>({ vertical: [], horizontal: [] });
  // Pincel de desenho livre (pedido explícito: "ferramentas de seleção e
  // pincel") - `isDrawingMode` espelha `canvas.isDrawingMode` (Fabric
  // desliga a seleção/arraste normal de objetos sozinho enquanto ativo).
  const [isDrawingMode, setIsDrawingModeState] = useState(false);
  const [brushColor, setBrushColorState] = useState('#9333ea');
  const [brushWidth, setBrushWidthState] = useState(4);
  // O valor em si não é lido; existe só pra forçar recomputar canUndo/canRedo
  // (derivados de historyRef.current, uma ref, a cada novo render).
  const [, setHistoryTick] = useState(0);

  const pages = useMemo(() => pagesRef.current, [pagesVersion]);
  const activePage = useMemo(() => pages.find((page) => page.id === activePageId), [pages, activePageId]);

  const notifyChange = useCallback(() => {
    onChangeRef.current(deepClonePages(pagesRef.current));
  }, []);

  /** Lê o canvas de volta pro CanvaPage ativo em pagesRef (ordem real = zIndex real). */
  const flushActivePageFromCanvas = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const pageIndex = pagesRef.current.findIndex((page) => page.id === activePageIdRef.current);
    if (pageIndex === -1) return;
    const page = pagesRef.current[pageIndex]!;
    const byId = new Map(page.objects.map((obj) => [obj.id, obj]));
    // Achado real (2026-09-10): antes disto, um objeto do canvas SEM entrada
    // prévia em `byId` (ou seja, qualquer objeto recém-criado: forma/texto/
    // imagem adicionados, colar, duplicar, agrupar) virava `null` aqui e
    // desaparecia silenciosamente do documento no autosave seguinte -
    // `buildFallbackExisting` reconstrói um registro honesto direto do
    // próprio objeto Fabric ao vivo, então NENHUM objeto do canvas é
    // descartado por falta de histórico prévio (ver comentário completo em
    // fabric-sync.ts).
    const objects = canvas
      .getObjects()
      .filter(isManaged)
      .map((fabricObject, index) => {
        const existing = byId.get(fabricObject.canvaId) ?? buildFallbackExisting(fabricObject);
        return readCanvaObject(fabricObject, existing, index);
      });
    pagesRef.current = pagesRef.current.map((p, index) => (index === pageIndex ? { ...p, objects } : p));
  }, []);

  /**
   * Registra objetos recém-criados em `pagesRef` ANTES do primeiro
   * `commitHistory()` deles. `flushActivePageFromCanvas` já tem um fallback
   * que reconstrói um registro a partir do objeto Fabric ao vivo quando
   * nenhum existe (ver buildFallbackExisting em fabric-sync.ts) - isto aqui
   * é ainda melhor que esse fallback nos casos em que já temos os dados
   * ORIGINAIS limpos em mãos (ex: a URL de uma imagem antes de qualquer
   * filtro "assado" nela - o fallback só consegue ler a URL ATUAL via
   * `getSrc()`, que pra uma imagem com filtro é um data: URL gigante do
   * canvas offscreen, não a URL limpa original).
   */
  const seedObjectsIntoPage = useCallback((objs: CanvaObject[]) => {
    const pageIndex = pagesRef.current.findIndex((p) => p.id === activePageIdRef.current);
    if (pageIndex === -1) return;
    pagesRef.current = pagesRef.current.map((p, index) =>
      index === pageIndex ? { ...p, objects: [...p.objects, ...objs] } : p,
    );
  }, []);

  const commitHistory = useCallback(() => {
    flushActivePageFromCanvas();
    const snapshot = deepClonePages(pagesRef.current);
    const { stack, index } = historyRef.current;
    const truncated = stack.slice(0, index + 1);
    truncated.push(snapshot);
    const overflow = truncated.length - MAX_HISTORY;
    const trimmed = overflow > 0 ? truncated.slice(overflow) : truncated;
    historyRef.current = { stack: trimmed, index: trimmed.length - 1 };
    setHistoryTick((tick) => tick + 1);
    notifyChange();
  }, [flushActivePageFromCanvas, notifyChange]);

  const readSelectionState = useCallback((): CanvaSelectionState => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return { ids: [], type: null, object: null };
    const active = canvas.getActiveObjects().filter(isManaged);
    if (active.length === 0) return { ids: [], type: null, object: null };
    const types = new Set(active.map((obj) => obj.canvaType));
    const type: CanvaObjectType | 'multiple' = types.size > 1 ? 'multiple' : (active[0]!.canvaType as CanvaObjectType);
    let object: CanvaObject | null = null;
    if (active.length === 1) {
      const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
      const existing = page?.objects.find((o) => o.id === active[0]!.canvaId) ?? null;
      object = existing ? readCanvaObject(active[0]!, existing, existing.zIndex) : null;
    }
    return { ids: active.map((obj) => obj.canvaId), type, object };
  }, []);

  /** Guias de alinhamento: centro da página e centro/bordas dos demais objetos, com threshold fixo. */
  const applySnapping = useCallback(
    (moving: FabricObject) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const movingWidth = (moving.width ?? 0) * (moving.scaleX ?? 1);
      const movingHeight = (moving.height ?? 0) * (moving.scaleY ?? 1);
      const left = moving.left ?? 0;
      const top = moving.top ?? 0;
      const centerX = left + movingWidth / 2;
      const centerY = top + movingHeight / 2;

      const vTargets = [documentWidth / 2];
      const hTargets = [documentHeight / 2];
      for (const other of canvas.getObjects()) {
        if (other === moving || !isManaged(other)) continue;
        const ow = (other.width ?? 0) * (other.scaleX ?? 1);
        const oh = (other.height ?? 0) * (other.scaleY ?? 1);
        const ol = other.left ?? 0;
        const ot = other.top ?? 0;
        vTargets.push(ol, ol + ow, ol + ow / 2);
        hTargets.push(ot, ot + oh, ot + oh / 2);
      }

      const guideLinesV: number[] = [];
      const guideLinesH: number[] = [];
      let snappedLeft = left;
      let snappedTop = top;

      for (const target of vTargets) {
        if (Math.abs(centerX - target) < SNAP_THRESHOLD) {
          snappedLeft = target - movingWidth / 2;
          guideLinesV.push(target);
          break;
        }
        if (Math.abs(left - target) < SNAP_THRESHOLD) {
          snappedLeft = target;
          guideLinesV.push(target);
          break;
        }
      }
      for (const target of hTargets) {
        if (Math.abs(centerY - target) < SNAP_THRESHOLD) {
          snappedTop = target - movingHeight / 2;
          guideLinesH.push(target);
          break;
        }
        if (Math.abs(top - target) < SNAP_THRESHOLD) {
          snappedTop = target;
          guideLinesH.push(target);
          break;
        }
      }

      moving.set({ left: snappedLeft, top: snappedTop });
      // Achado real (2026-09-10, prioridade "performance com documento
      // grande"): isto disparava `setGuides` com um array NOVO a cada
      // mousemove do arraste (até ~60x/s), mesmo quando o resultado era
      // idêntico ao anterior (ex: arrastando longe de qualquer guia, os
      // dois arrays continuam vazios) - React não faz comparação profunda
      // de array, só de referência, então cada chamada virava um re-render
      // de verdade. Passar uma função pro setState e devolver a MESMA
      // referência quando o conteúdo não mudou é o jeito documentado do
      // React de pular o re-render (bail-out por Object.is).
      setGuides((prev) => (sameGuideArrays(prev, guideLinesV, guideLinesH) ? prev : { vertical: guideLinesV, horizontal: guideLinesH }));
    },
    [documentWidth, documentHeight],
  );

  const loadPageIntoCanvas = useCallback(async (page: CanvaPage) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const token = ++loadTokenRef.current;

    canvas.discardActiveObject();
    canvas.clear();

    if (page.background.type === 'color') {
      canvas.backgroundColor = page.background.value ?? '#ffffff';
      clearBackgroundImage(canvas);
    } else if (page.background.type === 'image' && page.background.value) {
      const bg = await instantiateFabricObject({
        id: '__background__',
        type: 'image',
        src: page.background.value,
        x: 0,
        y: 0,
        width: documentWidth,
        height: documentHeight,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        locked: true,
        visible: true,
        zIndex: -1,
      });
      if (token !== loadTokenRef.current) return;
      bg.selectable = false;
      bg.evented = false;
      canvas.backgroundColor = '#ffffff';
      canvas.backgroundImage = bg;
    } else {
      canvas.backgroundColor = 'transparent';
      clearBackgroundImage(canvas);
    }

    // Achado real (2026-09-11): sem try/catch aqui, UM objeto que falhasse
    // ao carregar (ex: imagem que não respondeu a tempo) derrubava o loop
    // inteiro sem aviso nenhum - a página inteira ficava em branco mesmo
    // com dezenas de outros objetos válidos esperando pra entrar. Cada
    // objeto agora falha sozinho, os outros continuam carregando normalmente.
    //
    // Achado real (2026-09-10, "performance com documento grande"): isto
    // dava `await` um objeto de cada vez, num for-loop sequencial - pra um
    // PSD importado com dezenas de camadas/imagens, o carregamento inteiro
    // ficava preso à soma de TODOS os fetches de rede, um atrás do outro,
    // em vez de rodar em paralelo. `Promise.allSettled` sobre todos de uma
    // vez faz os fetches concorrerem de verdade; a ordem de `canvas.add()`
    // continua a mesma (por índice do array já ordenado por zIndex, não pela
    // ordem de chegada de cada promise).
    const sorted = [...page.objects].sort((a, b) => a.zIndex - b.zIndex);
    const outcomes = await Promise.allSettled(sorted.map((obj) => instantiateFabricObject(obj)));
    if (token !== loadTokenRef.current) return;

    let failedCount = 0;
    outcomes.forEach((outcome, index) => {
      const obj = sorted[index]!;
      if (outcome.status === 'rejected') {
        failedCount += 1;
        console.error('canvas_object_load_failed', { objectId: obj.id, type: obj.type, error: outcome.reason });
        return;
      }
      canvas.add(outcome.value);
    });
    canvas.requestRenderAll();
    if (failedCount > 0) {
      toast(
        failedCount === 1
          ? 'Um elemento desta página não pôde ser carregado.'
          : `${failedCount} elementos desta página não puderam ser carregados.`,
        'error',
      );
    }
  }, [documentWidth, documentHeight]);

  const setActivePageId = useCallback(
    (id: string) => {
      if (id === activePageIdRef.current) return;
      flushActivePageFromCanvas();
      activePageIdRef.current = id;
      setActivePageIdState(id);
      const page = pagesRef.current.find((p) => p.id === id);
      if (page) void loadPageIntoCanvas(page);
      setSelection({ ids: [], type: null, object: null });
    },
    [flushActivePageFromCanvas, loadPageIntoCanvas],
  );

  // Setup do canvas Fabric - uma vez só por montagem do editor.
  useEffect(() => {
    const canvasEl = canvasElRef.current;
    if (!canvasEl) return;

    const canvas = new Canvas(canvasEl, {
      width: documentWidth,
      height: documentHeight,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selectionColor: 'rgba(147,51,234,0.12)',
      selectionBorderColor: '#9333ea',
      selectionLineWidth: 1,
    });

    // Achado real (2026-09-11, "muito perto sem conseguir ver direito"): o
    // zoom do usuário é feito via CSS transform no wrapper (documentado no
    // topo do arquivo), então sem isto o canvas só tem pixels de verdade pra
    // 100% - dar zoom além disso amplia os MESMOS pixels via CSS, ficando
    // borrado. Renderiza a resolução interna em RENDER_OVERSAMPLE vezes
    // (via canvas.setZoom + backstore maior) mantendo o tamanho CSS igual -
    // fica nítido até esse nível de zoom antes de voltar a esticar. Não afeta
    // exportação: toDataURL/toBlob (ver use dos multiplicadores 1x/2x/4x)
    // ignoram o zoom do viewport de propósito, sempre re-renderizam do zero
    // no multiplicador pedido (confirmado lendo StaticCanvas.mjs).
    const oversample = computeRenderOversample(documentWidth, documentHeight);
    canvas.setDimensions(
      { width: documentWidth * oversample, height: documentHeight * oversample },
      { backstoreOnly: true },
    );
    canvas.setZoom(oversample);

    fabricCanvasRef.current = canvas;

    canvas.on('selection:created', () => setSelection(readSelectionState()));
    canvas.on('selection:updated', () => setSelection(readSelectionState()));
    canvas.on('selection:cleared', () => setSelection({ ids: [], type: null, object: null }));
    canvas.on('object:modified', () => commitHistory());
    canvas.on('object:moving', (event) => {
      applySnapping(event.target);
    });
    canvas.on('mouse:up', () =>
      setGuides((prev) => (prev.vertical.length === 0 && prev.horizontal.length === 0 ? prev : { vertical: [], horizontal: [] })),
    );
    // Traço de pincel concluído (fabric.PencilBrush já adicionou o Path ao
    // canvas sozinho) - vira um CanvaObject de verdade aqui, não fica só
    // "desenhado na tela". `commitHistory`/`seedObjectsIntoPage` são
    // referências estáveis (deps vazias em toda a cadeia delas), seguro
    // referenciar direto dentro deste efeito de deps fixas ([]).
    canvas.on('path:created', (event) => {
      const path = event.path as FabricObjectWithMeta;
      path.canvaId = newId();
      path.canvaType = 'path';
      const pathObj: CanvaPathObject = {
        id: path.canvaId,
        type: 'path',
        x: path.left ?? 0,
        y: path.top ?? 0,
        width: path.width ?? 0,
        height: path.height ?? 0,
        scaleX: path.scaleX ?? 1,
        scaleY: path.scaleY ?? 1,
        rotation: path.angle ?? 0,
        opacity: path.opacity ?? 1,
        locked: false,
        visible: true,
        zIndex: 0,
        pathData: util.joinPath((path as unknown as InstanceType<typeof Path>).path),
        stroke: typeof path.stroke === 'string' ? path.stroke : '#9333ea',
        strokeWidth: path.strokeWidth ?? 4,
        fill: typeof path.fill === 'string' ? path.fill : null,
      };
      seedObjectsIntoPage([pathObj]);
      commitHistory();
    });

    const initialPage = pagesRef.current.find((p) => p.id === activePageIdRef.current);
    void loadPageIntoCanvas(initialPage ?? pagesRef.current[0]!).then(() => setIsReady(true));

    return () => {
      loadTokenRef.current += 1;
      void canvas.dispose();
      fabricCanvasRef.current = null;
    };
    // Setup único: roda uma vez por montagem do editor, dependências fixas de propósito.
  }, []);

  const addObject = useCallback(
    async (obj: CanvaObject) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const fabricObject = await instantiateFabricObject(obj);
      canvas.add(fabricObject);
      canvas.setActiveObject(fabricObject);
      canvas.requestRenderAll();
      seedObjectsIntoPage([obj]);
      commitHistory();
    },
    [commitHistory, seedObjectsIntoPage],
  );

  const addText = useCallback(
    (variant: 'title' | 'subtitle' | 'body') => void addObject(defaultTextObject(variant, documentWidth, documentHeight)),
    [addObject, documentWidth, documentHeight],
  );

  const addShape = useCallback(
    (shape: CanvaShapeKind) => void addObject(defaultShapeObject(shape, documentWidth, documentHeight)),
    [addObject, documentWidth, documentHeight],
  );

  const addImageFromSrc = useCallback(
    async (src: string, naturalWidth?: number, naturalHeight?: number) => {
      let width = naturalWidth ?? documentWidth * 0.5;
      let height = naturalHeight ?? documentHeight * 0.5;
      if (!naturalWidth || !naturalHeight) {
        try {
          const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
            const probe = new Image();
            probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
            probe.onerror = () => reject(new Error('image probe failed'));
            probe.src = src;
          });
          width = dims.w;
          height = dims.h;
        } catch {
          // mantém o fallback 50% do artboard
        }
      }
      // Cabe dentro de ~90% do artboard preservando proporção, sem upscale além
      // do original. Toda inserção de imagem passa por aqui (upload, colar,
      // arrastar, banco de imagens, Brand Kit) - ver computeImagePlacement
      // sobre por que width/height NÃO é o tamanho exibido.
      const placement = computeImagePlacement(width, height, documentWidth, documentHeight);

      await addObject({
        id: newId(),
        type: 'image',
        src,
        ...placement,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        zIndex: 0,
      });
    },
    [addObject, documentWidth, documentHeight],
  );

  const addImageFromFile = useCallback(
    async (file: File) => {
      let src: string;
      try {
        src = await uploadImageFile(file);
      } catch {
        // Upload falhou (rede, storage fora do ar) - ainda assim não perde o
        // paste/drop do usuário: cai pra um data: URL local. Fica maior no
        // JSON salvo e não aparece no painel Uploads, mas a imagem entra.
        src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem'));
          reader.readAsDataURL(file);
        });
      }
      await addImageFromSrc(src);
    },
    [addImageFromSrc, uploadImageFile],
  );

  const deleteSelected = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    canvas.discardActiveObject();
    for (const obj of active) canvas.remove(obj);
    canvas.requestRenderAll();
    commitHistory();
  }, [commitHistory]);

  const duplicateSelected = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects().filter(isManaged);
    if (active.length === 0) return;
    flushActivePageFromCanvas();
    const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
    if (!page) return;

    const clones: CanvaObject[] = [];
    for (const fabricObject of active) {
      const existing = page.objects.find((o) => o.id === fabricObject.canvaId);
      if (!existing) continue;
      clones.push(cloneCanvaObject(existing, newId()));
    }

    canvas.discardActiveObject();
    const newFabricObjects: FabricObject[] = [];
    for (const clone of clones) {
      const fabricObject = await instantiateFabricObject(clone);
      canvas.add(fabricObject);
      newFabricObjects.push(fabricObject);
    }
    if (newFabricObjects.length === 1) {
      canvas.setActiveObject(newFabricObjects[0]!);
    } else if (newFabricObjects.length > 1) {
      canvas.setActiveObject(new ActiveSelection(newFabricObjects, { canvas }));
    }
    canvas.requestRenderAll();
    seedObjectsIntoPage(clones);
    commitHistory();
  }, [commitHistory, flushActivePageFromCanvas, seedObjectsIntoPage]);

  const copySelected = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    flushActivePageFromCanvas();
    const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
    if (!page) return;
    const active = canvas.getActiveObjects().filter(isManaged);
    const objects = active.map((f) => page.objects.find((o) => o.id === f.canvaId)).filter((o): o is CanvaObject => Boolean(o));
    clipboardRef.current = objects.length > 0 ? objects : null;
  }, [flushActivePageFromCanvas]);

  const pasteInternal = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !clipboardRef.current || clipboardRef.current.length === 0) return;
    const clones = clipboardRef.current.map((obj) => cloneCanvaObject(obj, newId()));
    canvas.discardActiveObject();
    const newFabricObjects: FabricObject[] = [];
    for (const clone of clones) {
      const fabricObject = await instantiateFabricObject(clone);
      canvas.add(fabricObject);
      newFabricObjects.push(fabricObject);
    }
    if (newFabricObjects.length === 1) canvas.setActiveObject(newFabricObjects[0]!);
    else if (newFabricObjects.length > 1) canvas.setActiveObject(new ActiveSelection(newFabricObjects, { canvas }));
    canvas.requestRenderAll();
    seedObjectsIntoPage(clones);
    commitHistory();
    // Cópia consecutiva (Ctrl+D repetido, ou C então V várias vezes) sempre desloca
    // a partir da última posição, não da original - senão colagens repetidas empilhariam.
    clipboardRef.current = clones;
  }, [commitHistory, seedObjectsIntoPage]);

  const withActiveObjects = useCallback((fn: (objects: FabricObject[]) => void) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    fn(active);
    canvas.requestRenderAll();
  }, []);

  const bringForward = useCallback(() => {
    withActiveObjects((objects) => {
      const canvas = fabricCanvasRef.current!;
      for (const obj of objects) canvas.bringObjectForward(obj);
    });
    commitHistory();
  }, [withActiveObjects, commitHistory]);

  const sendBackward = useCallback(() => {
    withActiveObjects((objects) => {
      const canvas = fabricCanvasRef.current!;
      for (const obj of objects) canvas.sendObjectBackwards(obj);
    });
    commitHistory();
  }, [withActiveObjects, commitHistory]);

  const bringToFront = useCallback(() => {
    withActiveObjects((objects) => {
      const canvas = fabricCanvasRef.current!;
      for (const obj of objects) canvas.bringObjectToFront(obj);
    });
    commitHistory();
  }, [withActiveObjects, commitHistory]);

  const sendToBack = useCallback(() => {
    withActiveObjects((objects) => {
      const canvas = fabricCanvasRef.current!;
      for (const obj of objects) canvas.sendObjectToBack(obj);
    });
    commitHistory();
  }, [withActiveObjects, commitHistory]);

  const setSelectedOpacity = useCallback(
    (value: number) => {
      withActiveObjects((objects) => {
        for (const obj of objects) obj.set({ opacity: value });
      });
      commitHistory();
    },
    [withActiveObjects, commitHistory],
  );

  /** Modo de mesclagem (pedido explícito: "blend modes... essencial pra
   * composição de imagem estilo Photoshop") - `globalCompositeOperation` é
   * uma prop nativa de qualquer FabricObject, não precisou de nenhuma
   * estrutura nova no motor, só o mapeamento de nomes (ver fabric-sync.ts). */
  const setSelectedBlendMode = useCallback(
    (blendMode: CanvaBlendMode) => {
      withActiveObjects((objects) => {
        for (const obj of objects) obj.set({ globalCompositeOperation: blendModeToComposite(blendMode) });
      });
      setSelection(readSelectionState());
      commitHistory();
    },
    [withActiveObjects, commitHistory, readSelectionState],
  );

  /**
   * Pincel de desenho livre (pedido explícito: "ferramentas de seleção e
   * pincel"). Fabric já resolve tudo do desenho em si (`isDrawingMode` +
   * `freeDrawingBrush`, um `PencilBrush` nativo) - ligar/desligar desliga
   * sozinho a seleção/arraste normal de objetos enquanto ativo. O traço
   * concluído vira um CanvaObject de verdade no `path:created` (registrado
   * no efeito de setup do canvas, mais abaixo), não fica só "desenhado".
   */
  const setDrawingMode = useCallback(
    (enabled: boolean) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      canvas.isDrawingMode = enabled;
      if (enabled) {
        canvas.freeDrawingBrush = new PencilBrush(canvas);
        canvas.freeDrawingBrush.color = brushColor;
        canvas.freeDrawingBrush.width = brushWidth;
      }
      setIsDrawingModeState(enabled);
    },
    [brushColor, brushWidth],
  );

  const setBrushColor = useCallback((color: string) => {
    setBrushColorState(color);
    const canvas = fabricCanvasRef.current;
    if (canvas?.freeDrawingBrush) canvas.freeDrawingBrush.color = color;
  }, []);

  const setBrushWidth = useCallback((width: number) => {
    setBrushWidthState(width);
    const canvas = fabricCanvasRef.current;
    if (canvas?.freeDrawingBrush) canvas.freeDrawingBrush.width = width;
  }, []);

  const toggleSelectedLock = useCallback(() => {
    withActiveObjects((objects) => {
      for (const obj of objects) {
        const nextLocked = obj.selectable !== false;
        obj.set({
          selectable: !nextLocked,
          evented: !nextLocked,
          lockMovementX: nextLocked,
          lockMovementY: nextLocked,
          lockRotation: nextLocked,
          lockScalingX: nextLocked,
          lockScalingY: nextLocked,
          hasControls: !nextLocked,
        });
      }
      fabricCanvasRef.current?.discardActiveObject();
    });
    commitHistory();
  }, [withActiveObjects, commitHistory]);

  const flipSelected = useCallback(
    (axis: 'x' | 'y') => {
      withActiveObjects((objects) => {
        for (const obj of objects) {
          if (axis === 'x') obj.set({ flipX: !obj.flipX });
          else obj.set({ flipY: !obj.flipY });
        }
      });
      commitHistory();
    },
    [withActiveObjects, commitHistory],
  );

  /** "Substituir" (imagem selecionada): troca o conteúdo mantendo posição/tamanho/
   * rotação do quadro - ao contrário de addImageFromSrc, que cria um objeto novo. */
  const replaceSelectedImageSrc = useCallback(
    async (src: string) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || !isManaged(active) || active.canvaType !== 'image') return;
      const image = active as unknown as { setElement: (el: HTMLImageElement | HTMLCanvasElement) => void; canvaId: string };
      const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
      const existing = page?.objects.find((o) => o.id === image.canvaId);
      // Substituição limpa: sem herdar filtros da imagem anterior (conteúdo novo, ajustes zerados).
      const element = await loadImageElement(src, undefined);
      // Tamanho OCUPADO na arte antes da troca (caixa de origem x escala). O
      // `setElement` do Fabric redefine width/height pro tamanho natural do
      // novo arquivo mas NÃO mexe em scaleX/scaleY: sem recalcular a escala
      // aqui, trocar uma imagem por outra de resolução diferente fazia o
      // objeto saltar de tamanho na tela (uma foto de 4000px substituindo uma
      // de 1000px aparecia 4x maior, estourando o artboard).
      const displayWidth = (active.width || 1) * (active.scaleX ?? 1);
      const displayHeight = (active.height || 1) * (active.scaleY ?? 1);
      image.setElement(element);
      const nextWidth = active.width || 1;
      const nextHeight = active.height || 1;
      active.set({ scaleX: displayWidth / nextWidth, scaleY: displayHeight / nextHeight });
      active.setCoords();
      if (existing?.type === 'image') existing.src = src;
      canvas.requestRenderAll();
      commitHistory();
    },
    [commitHistory],
  );

  /** Ajustar (imagem selecionada): re-assa `src` original com os novos
   * filtros (brightness/contrast/saturation/blur/grayscale/sepia) - nunca
   * acumula sobre uma versão já filtrada, sempre parte do original. */
  const updateSelectedImageFilters = useCallback(
    async (filters: CanvaImageFilters) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || !isManaged(active) || active.canvaType !== 'image') return;
      const image = active as unknown as { setElement: (el: HTMLImageElement | HTMLCanvasElement) => void; canvaId: string };
      const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
      const existing = page?.objects.find((o) => o.id === image.canvaId);
      if (existing?.type !== 'image') return;
      const element = await loadImageElement(existing.src, filters);
      image.setElement(element);
      existing.filters = filters;
      canvas.requestRenderAll();
      commitHistory();
    },
    [commitHistory],
  );

  /** Retorna o quadro on-canvas (em pixels de documento, não de tela) da imagem
   * selecionada, pra CropOverlay se posicionar. Só rotation=0 é suportado (o
   * pedido cobre livre/1:1/4:5/9:16/16:9, não recorte com imagem rotacionada). */
  const getActiveImageFrame = useCallback((): { left: number; top: number; width: number; height: number } | null => {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!active || !isManaged(active) || active.canvaType !== 'image') return null;
    if (Math.round(active.angle ?? 0) % 360 !== 0) return null;
    return {
      left: active.left ?? 0,
      top: active.top ?? 0,
      width: (active.width ?? 0) * (active.scaleX ?? 1),
      height: (active.height ?? 0) * (active.scaleY ?? 1),
    };
  }, []);

  /** `rect` em pixels de documento, relativo ao topo-esquerdo ATUAL da imagem
   * (mesmo espaço devolvido por getActiveImageFrame). Matemática do recorte:
   * cropX/cropY do Fabric são em pixels da imagem ORIGINAL, então o delta em
   * pixels de tela precisa ser convertido dividindo por scaleX/scaleY - a
   * mesma razão que faz `width`/`height` (que already são em pixels-fonte
   * quando há crop) não precisarem mudar de escala, só de valor. */
  const applyCrop = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || !isManaged(active) || active.canvaType !== 'image') return;
      const scaleX = active.scaleX ?? 1;
      const scaleY = active.scaleY ?? 1;
      const currentCropX = (active as unknown as { cropX?: number }).cropX ?? 0;
      const currentCropY = (active as unknown as { cropY?: number }).cropY ?? 0;

      const newWidth = rect.width / scaleX;
      const newHeight = rect.height / scaleY;
      active.set({
        cropX: currentCropX + rect.x / scaleX,
        cropY: currentCropY + rect.y / scaleY,
        width: newWidth,
        height: newHeight,
        left: (active.left ?? 0) + rect.x,
        top: (active.top ?? 0) + rect.y,
      });
      // Achado real (2026-09-11, ao revisar a própria máscara de recorte
      // recém-implementada): `clipPath` é construído com um rx/ry (ou
      // width/height, no caso de triângulo/estrela) FIXOS no momento em que
      // a máscara é aplicada - recortar a MESMA imagem depois muda
      // width/height do objeto mas não redimensiona a máscara junto, então
      // ela fica desalinhada/no tamanho errado em cima da imagem já
      // recortada. Reconstrói a máscara pro novo tamanho sempre que existe
      // uma ativa.
      const existingClip = (active as unknown as { clipPath?: FabricObject }).clipPath;
      if (existingClip) {
        const newClip = buildClipShape(clipShapeKindOf(existingClip), newWidth, newHeight);
        active.set({ clipPath: (newClip ?? undefined) as unknown as FabricObject });
      }
      canvas.requestRenderAll();
      commitHistory();
    },
    [commitHistory],
  );

  const updateSelectedText = useCallback(
    (patch: Partial<CanvaTextObject>) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      const fabricPatch: Record<string, unknown> = {};
      if (patch.text !== undefined) fabricPatch.text = patch.uppercase || patch.text ? patch.text.toUpperCase() : patch.text;
      if (patch.fontFamily !== undefined) fabricPatch.fontFamily = patch.fontFamily;
      if (patch.fontSize !== undefined) fabricPatch.fontSize = patch.fontSize;
      if (patch.fontWeight !== undefined) fabricPatch.fontWeight = patch.fontWeight;
      if (patch.fontStyle !== undefined) fabricPatch.fontStyle = patch.fontStyle;
      if (patch.fill !== undefined) fabricPatch.fill = patch.fill;
      if (patch.textAlign !== undefined) fabricPatch.textAlign = patch.textAlign;
      if (patch.letterSpacing !== undefined) fabricPatch.charSpacing = patch.letterSpacing;
      if (patch.lineHeight !== undefined) fabricPatch.lineHeight = patch.lineHeight;
      if (patch.underline !== undefined) fabricPatch.underline = patch.underline;
      active.set(fabricPatch);

      // fontId não é uma propriedade nativa do Fabric (só existe no nosso
      // modelo, pra recarregar o .woff2 certo ao reabrir o documento) - grava
      // direto no pagesRef, já que readCanvaObject não teria de onde lê-lo.
      if (patch.fontId !== undefined && isManaged(active)) {
        const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
        const existing = page?.objects.find((o) => o.id === active.canvaId);
        if (existing?.type === 'text') existing.fontId = patch.fontId;
      }

      // Achado real (2026-09-11): trocar peso (negrito) ou itálico de um
      // texto com fonte do Fontsource nunca recarregava o arquivo .woff2 da
      // variante certa - só o peso do Fabric mudava, sem o FontFace
      // correspondente existir. Diferente de CSS normal, Canvas2D NÃO
      // sintetiza um peso que falta - sem o FontFace exato, ele cai
      // silenciosamente na fonte padrão do navegador pra aquele peso,
      // incluindo na exportação final (PNG/JPEG com a fonte errada, sem
      // nenhum erro visível). Recarrega a variante certa sempre que peso/
      // itálico mudam num texto que tem `fontId` (fontes nativas do app,
      // sem fontId, não precisam disso - já vêm todo peso via next/font).
      if ((patch.fontWeight !== undefined || patch.fontStyle !== undefined) && isManaged(active)) {
        const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
        const existing = page?.objects.find((o) => o.id === active.canvaId);
        if (existing?.type === 'text' && existing.fontId) {
          const nextWeight = patch.fontWeight ?? existing.fontWeight;
          const nextStyle = patch.fontStyle ?? existing.fontStyle;
          loadFontVariant(existing.fontId, existing.fontFamily, nextWeight, nextStyle)
            .then(() => canvas.requestRenderAll())
            .catch((error: unknown) => console.error('font_variant_load_failed', error));
        }
      }

      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  const updateSelectedShape = useCallback(
    (patch: Partial<CanvaShapeObject>) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      const fabricPatch: Record<string, unknown> = {};
      if (patch.fill !== undefined) fabricPatch.fill = patch.fill;
      if (patch.stroke !== undefined) fabricPatch.stroke = patch.stroke;
      if (patch.strokeWidth !== undefined) fabricPatch.strokeWidth = patch.strokeWidth;
      if (patch.cornerRadius !== undefined) {
        fabricPatch.rx = patch.cornerRadius;
        fabricPatch.ry = patch.cornerRadius;
      }
      active.set(fabricPatch);
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Editar um traço de pincel já desenhado (cor/espessura) - `pathData`
   * (a geometria em si) nunca é tocado aqui, só a aparência do traço. */
  const updateSelectedPath = useCallback(
    (patch: { stroke?: string; strokeWidth?: number }) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      active.set(patch);
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Borda (moldura) da imagem selecionada - mesmo par stroke/strokeWidth de
   * updateSelectedShape, só que aplicável a `image` (Fabric.Image aceita
   * stroke/strokeWidth como qualquer outro FabricObject). */
  const updateSelectedImageBorder = useCallback(
    (patch: Partial<Pick<CanvaImageObject, 'stroke' | 'strokeWidth'>>) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || !isManaged(active) || active.canvaType !== 'image') return;
      const nextStrokeWidth = patch.strokeWidth ?? (active.strokeWidth as number | undefined) ?? 0;
      const nextStroke = patch.stroke ?? (typeof active.stroke === 'string' ? active.stroke : '#ffffff');
      active.set({
        stroke: nextStrokeWidth > 0 ? nextStroke : null,
        strokeWidth: nextStrokeWidth,
      });
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Máscara de recorte (pedido explícito: "máscaras de camada") - recorta a
   * imagem selecionada na silhueta da forma escolhida, via `clipPath` nativo
   * do Fabric (ver buildClipShape em fabric-sync.ts pro porquê da posição
   * centrada em vez de canto superior esquerdo). `null` remove a máscara. */
  const setSelectedImageClipShape = useCallback(
    (shape: CanvaShapeKind | null) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || !isManaged(active) || active.canvaType !== 'image') return;
      const clip = shape ? buildClipShape(shape, active.width ?? 0, active.height ?? 0) : null;
      // `set({ clipPath: undefined })` é rejeitado por exactOptionalPropertyTypes
      // na assinatura do Fabric (mesma razão do cast em clearBackgroundImage
      // acima) - a prop É opcional em runtime, só o .d.ts é impreciso aqui.
      active.set({ clipPath: (clip ?? undefined) as unknown as FabricObject });
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Tamanho exato via input numérico (pedido explícito: "esticar aumentar
   * diminuir, proporção tamanho"), não só arrastar as alças. `width`/`height`
   * aqui são o tamanho FINAL na tela (width*scaleX), não o box interno do
   * Fabric - evita confundir quem digita com a distinção crop-vs-display que
   * só existe pra imagens. `keepAspect` recalcula a outra dimensão a partir
   * da proporção atual, pra digitar só largura OU altura sem distorcer. */
  const setSelectedSize = useCallback(
    (width: number, height: number, keepAspect = false) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || width <= 0 || height <= 0) return;
      const baseWidth = active.width || 1;
      const baseHeight = active.height || 1;
      let targetWidth = width;
      let targetHeight = height;
      if (keepAspect) {
        const currentDisplayWidth = baseWidth * (active.scaleX ?? 1);
        const currentDisplayHeight = baseHeight * (active.scaleY ?? 1);
        const ratio = currentDisplayHeight / currentDisplayWidth || 1;
        if (width !== currentDisplayWidth) targetHeight = width * ratio;
        else targetWidth = height / ratio;
      }
      active.set({ scaleX: targetWidth / baseWidth, scaleY: targetHeight / baseHeight });
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Posição exata (canto superior esquerdo do objeto, mesmas coordenadas de
   * documento usadas em todo o resto do editor). */
  const setSelectedPosition = useCallback(
    (x: number, y: number) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active) return;
      active.set({ left: x, top: y });
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Ângulo exato em graus (pedido explícito: "controle de... angulação"),
   * complementa a alça de rotação padrão do Fabric (arrastar o topo). Fabric
   * já normaliza `angle` pra 0-360 sozinho ao renderizar, então nenhum módulo
   * extra é necessário aqui. */
  const setSelectedRotation = useCallback(
    (angle: number) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active) return;
      active.set({ angle });
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Seleciona um objeto da página ativa pelo id (usado pelo painel "Camadas" -
   * clique numa linha da lista seleciona o objeto correspondente no canvas,
   * mesmo que ele não esteja atualmente selecionado). */
  const selectObjectById = useCallback((id: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const target = canvas.getObjects().find((obj) => isManaged(obj) && obj.canvaId === id);
    if (!target) return;
    canvas.discardActiveObject();
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    setSelection(readSelectionState());
  }, [readSelectionState]);

  /** Visibilidade/bloqueio por id, independente de seleção - o painel "Camadas"
   * precisa alternar o olho/cadeado de QUALQUER linha da lista, não só do
   * objeto selecionado no momento (diferente de toggleSelectedLock). */
  const setObjectVisible = useCallback(
    (id: string, visible: boolean) => {
      const canvas = fabricCanvasRef.current;
      const target = canvas?.getObjects().find((obj) => isManaged(obj) && obj.canvaId === id);
      if (!canvas || !target) return;
      target.set({ visible });
      if (!visible && canvas.getActiveObject() === target) canvas.discardActiveObject();
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  const setObjectLocked = useCallback(
    (id: string, locked: boolean) => {
      const canvas = fabricCanvasRef.current;
      const target = canvas?.getObjects().find((obj) => isManaged(obj) && obj.canvaId === id);
      if (!canvas || !target) return;
      target.set({
        selectable: !locked,
        evented: !locked,
        lockMovementX: locked,
        lockMovementY: locked,
        lockRotation: locked,
        lockScalingX: locked,
        lockScalingY: locked,
        hasControls: !locked,
      });
      if (locked && canvas.getActiveObject() === target) canvas.discardActiveObject();
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  const selectAll = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    const objects = canvas.getObjects().filter((obj) => obj.selectable !== false);
    if (objects.length === 0) return;
    canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
    canvas.requestRenderAll();
  }, []);

  const deselectAll = useCallback(() => {
    fabricCanvasRef.current?.discardActiveObject();
    fabricCanvasRef.current?.requestRenderAll();
  }, []);

  /** Agrupar: `new Group(objects)` recalcula a caixa delimitadora a partir das
   * posições ABSOLUTAS atuais e reparenteia cada filho pro espaço local do
   * grupo - comportamento padrão e testado do Fabric (LayoutManager interno),
   * não código nosso. */
  const groupSelected = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects().filter(isManaged);
    if (active.length < 2) return;
    canvas.discardActiveObject();
    for (const obj of active) canvas.remove(obj);
    const group = new Group(active) as unknown as FabricObject & { canvaId: string; canvaType: 'group' };
    group.canvaId = newId();
    group.canvaType = 'group';
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    commitHistory();
  }, [commitHistory]);

  /** Desagrupar: `group.removeAll()` já restaura a posição/escala/rotação
   * ABSOLUTA de cada filho (Group._onObjectRemoved -> exitGroup, verificado
   * no código-fonte do Fabric) - não precisa de nenhuma matemática de matriz
   * nossa aqui, só confiar no que o próprio Fabric já resolve ao remover. */
  const ungroupSelected = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active || !isManaged(active) || active.canvaType !== 'group') return;
    const group = active as unknown as Group;
    const children = group.removeAll();
    canvas.remove(group);
    for (const child of children) canvas.add(child);
    if (children.length > 0) canvas.setActiveObject(new ActiveSelection(children, { canvas }));
    canvas.requestRenderAll();
    commitHistory();
  }, [commitHistory]);

  const undo = useCallback(() => {
    const { stack, index } = historyRef.current;
    if (index <= 0) return;
    const nextIndex = index - 1;
    historyRef.current = { stack, index: nextIndex };
    pagesRef.current = deepClonePages(stack[nextIndex]!);
    setHistoryTick((tick) => tick + 1);
    setPagesVersion((v) => v + 1);
    const page = pagesRef.current.find((p) => p.id === activePageIdRef.current) ?? pagesRef.current[0];
    if (page) {
      activePageIdRef.current = page.id;
      setActivePageIdState(page.id);
      void loadPageIntoCanvas(page);
    }
    notifyChange();
  }, [loadPageIntoCanvas, notifyChange]);

  const redo = useCallback(() => {
    const { stack, index } = historyRef.current;
    if (index >= stack.length - 1) return;
    const nextIndex = index + 1;
    historyRef.current = { stack, index: nextIndex };
    pagesRef.current = deepClonePages(stack[nextIndex]!);
    setHistoryTick((tick) => tick + 1);
    setPagesVersion((v) => v + 1);
    const page = pagesRef.current.find((p) => p.id === activePageIdRef.current) ?? pagesRef.current[0];
    if (page) {
      activePageIdRef.current = page.id;
      setActivePageIdState(page.id);
      void loadPageIntoCanvas(page);
    }
    notifyChange();
  }, [loadPageIntoCanvas, notifyChange]);

  const canUndo = historyRef.current.index > 0;
  const canRedo = historyRef.current.index < historyRef.current.stack.length - 1;

  const addPage = useCallback(() => {
    flushActivePageFromCanvas();
    const page: CanvaPage = {
      id: newId(),
      order: pagesRef.current.length,
      background: { type: 'color', value: '#ffffff' },
      objects: [],
    };
    pagesRef.current = [...pagesRef.current, page];
    setPagesVersion((v) => v + 1);
    setActivePageId(page.id);
    commitHistory();
  }, [flushActivePageFromCanvas, setActivePageId, commitHistory]);

  const duplicatePage = useCallback(
    (pageId: string) => {
      flushActivePageFromCanvas();
      const source = pagesRef.current.find((p) => p.id === pageId);
      if (!source) return;
      const sourceIndex = pagesRef.current.findIndex((p) => p.id === pageId);
      const copy: CanvaPage = {
        ...deepClonePages([source])[0]!,
        id: newId(),
        order: sourceIndex + 1,
      };
      const next = [...pagesRef.current];
      next.splice(sourceIndex + 1, 0, copy);
      pagesRef.current = next.map((p, index) => ({ ...p, order: index }));
      setPagesVersion((v) => v + 1);
      setActivePageId(copy.id);
      commitHistory();
    },
    [flushActivePageFromCanvas, setActivePageId, commitHistory],
  );

  const deletePage = useCallback(
    (pageId: string) => {
      if (pagesRef.current.length <= 1) return;
      const index = pagesRef.current.findIndex((p) => p.id === pageId);
      if (index === -1) return;
      const next = pagesRef.current.filter((p) => p.id !== pageId).map((p, i) => ({ ...p, order: i }));
      pagesRef.current = next;
      setPagesVersion((v) => v + 1);
      if (activePageIdRef.current === pageId) {
        const fallback = next[Math.min(index, next.length - 1)]!;
        activePageIdRef.current = fallback.id;
        setActivePageIdState(fallback.id);
        void loadPageIntoCanvas(fallback);
      }
      commitHistory();
    },
    [loadPageIntoCanvas, commitHistory],
  );

  const movePage = useCallback(
    (pageId: string, direction: -1 | 1) => {
      const index = pagesRef.current.findIndex((p) => p.id === pageId);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= pagesRef.current.length) return;
      const next = [...pagesRef.current];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved!);
      pagesRef.current = next.map((p, i) => ({ ...p, order: i }));
      setPagesVersion((v) => v + 1);
      commitHistory();
    },
    [commitHistory],
  );

  const renamePage = useCallback(
    (pageId: string, name: string) => {
      pagesRef.current = pagesRef.current.map((p) => (p.id === pageId ? { ...p, name } : p));
      setPagesVersion((v) => v + 1);
      commitHistory();
    },
    [commitHistory],
  );

  const setPageBackground = useCallback(
    (background: CanvaPageBackground) => {
      pagesRef.current = pagesRef.current.map((p) => (p.id === activePageIdRef.current ? { ...p, background } : p));
      const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
      if (page) void loadPageIntoCanvas(page);
      setPagesVersion((v) => v + 1);
      commitHistory();
    },
    [loadPageIntoCanvas, commitHistory],
  );

  const setZoom = useCallback((value: number) => {
    setZoomState(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)));
  }, []);

  const zoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const padding = 64;
    const scale = Math.min(
      (container.clientWidth - padding) / documentWidth,
      (container.clientHeight - padding) / documentHeight,
      1,
    );
    setZoomState(Math.max(MIN_ZOOM, scale));
  }, [documentWidth, documentHeight]);

  /**
   * Achado real (2026-09-10, "espaço saindo cortado, quero que saia maior"):
   * quem chama `zoomToFit` faz isso uma vez só, logo no mount (useEffect com
   * deps vazias em canva-workspace.tsx). Se o container ainda tiver
   * clientWidth/clientHeight zerados nesse exato tick (layout flexbox/painéis
   * laterais ainda não resolvidos - comum ao abrir um documento vindo de
   * outra tela), a conta dá zoom negativo, cai no MIN_ZOOM (10%) e nunca mais
   * se corrige sozinha. Este observer espera o PRIMEIRO tamanho real
   * (>0x>0) do container e só então ajusta - depois disso se desliga, pra
   * não sobrescrever um zoom que o usuário tenha escolhido manualmente.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let didFit = false;
    const observer = new ResizeObserver((entries) => {
      if (didFit) return;
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        didFit = true;
        zoomToFit();
        observer.disconnect();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [zoomToFit]);

  /** JPEG não tem canal alfa - exportar uma página com fundo "transparente"
   * nesse formato sem isto pintaria as áreas vazias de PRETO (comportamento
   * padrão do <canvas> ao achatar pixels sem alpha), não do branco/quadriculado
   * que o usuário vê como "sem fundo" no editor. Só entra em ação pra JPEG;
   * PNG/WEBP preservam transparência normalmente e não são tocados.
   * Duas variantes (sync/async) pra não forçar toDataURL - hoje síncrono -
   * a virar Promise; a versão async é a única segura pra usar com toBlob()
   * (precisa esperar a codificação terminar ANTES de restaurar o fundo). */
  function withJpegSafeBackgroundSync(canvas: Canvas, format: 'png' | 'jpeg' | 'webp', render: () => string): string {
    if (format !== 'jpeg' || (canvas.backgroundColor && canvas.backgroundColor !== 'transparent')) {
      return render();
    }
    const previous = canvas.backgroundColor;
    canvas.backgroundColor = '#ffffff';
    canvas.requestRenderAll();
    try {
      return render();
    } finally {
      canvas.backgroundColor = previous;
      canvas.requestRenderAll();
    }
  }

  async function withJpegSafeBackgroundAsync(
    canvas: Canvas,
    format: 'png' | 'jpeg' | 'webp',
    render: () => Promise<Blob | null>,
  ): Promise<Blob | null> {
    if (format !== 'jpeg' || (canvas.backgroundColor && canvas.backgroundColor !== 'transparent')) {
      return render();
    }
    const previous = canvas.backgroundColor;
    canvas.backgroundColor = '#ffffff';
    canvas.requestRenderAll();
    try {
      return await render();
    } finally {
      canvas.backgroundColor = previous;
      canvas.requestRenderAll();
    }
  }

  const exportActivePageDataUrl = useCallback(
    (format: 'png' | 'jpeg' | 'webp', multiplier: number): string => {
      flushActivePageFromCanvas();
      const canvas = fabricCanvasRef.current;
      if (!canvas) return '';
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return withJpegSafeBackgroundSync(canvas, format, () => canvas.toDataURL({ format, multiplier, quality: 0.92 }));
    },
    [flushActivePageFromCanvas],
  );

  /** Exporta TODAS as páginas: troca a página ativa temporariamente (sem
   * disparar re-render do resto da UI), renderiza cada uma e devolve os blobs. */
  const exportAllPages = useCallback(
    async (format: 'png' | 'jpeg' | 'webp', multiplier: number): Promise<{ filename: string; blob: Blob }[]> => {
      flushActivePageFromCanvas();
      const canvas = fabricCanvasRef.current;
      if (!canvas) return [];
      const originalActiveId = activePageIdRef.current;
      const results: { filename: string; blob: Blob }[] = [];

      const sortedPages = [...pagesRef.current].sort((a, b) => a.order - b.order);
      for (let i = 0; i < sortedPages.length; i += 1) {
        const page = sortedPages[i]!;
        await loadPageIntoCanvas(page);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        const blob = await withJpegSafeBackgroundAsync(canvas, format, () => canvas.toBlob({ format, multiplier, quality: 0.92 }));
        if (blob) results.push({ filename: `slide-${String(i + 1).padStart(2, '0')}.${format}`, blob });
      }

      const restore = pagesRef.current.find((p) => p.id === originalActiveId);
      if (restore) await loadPageIntoCanvas(restore);
      return results;
    },
    [flushActivePageFromCanvas, loadPageIntoCanvas],
  );

  // Atalhos de teclado - ignora quando o foco está num input/textarea comum
  // ou quando um texto do PRÓPRIO canvas está em edição (Textbox.isEditing).
  useEffect(() => {
    function isTypingElsewhere(): boolean {
      const active = document.activeElement;
      if (!active) return false;
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true') return true;
      const canvasActive = fabricCanvasRef.current?.getActiveObject() as { isEditing?: boolean } | undefined;
      return canvasActive?.isEditing === true;
    }

    function onKeyDown(event: KeyboardEvent) {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !containerRef.current) return;
      const container = containerRef.current;
      const focusedInsideEditor = container.contains(document.activeElement) || document.activeElement === document.body;
      if (!focusedInsideEditor) return;
      if (isTypingElsewhere()) return;

      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        void duplicateSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }
      if (meta && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        copySelected();
        deleteSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === 'v') {
        // Ctrl/Cmd+V é tratado inteiramente pelo listener nativo 'paste' logo
        // abaixo (imagem externa E duplicar objeto interno via pasteInternal) -
        // o evento 'paste' do navegador carrega o clipboard de verdade, que o
        // 'keydown' sozinho não tem acesso.
        return;
      }
      if (meta && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const active = canvas.getActiveObject();
        if (!active) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        active.set({ left: (active.left ?? 0) + dx, top: (active.top ?? 0) + dy });
        canvas.requestRenderAll();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key.startsWith('Arrow') && !isTypingElsewhere()) {
        commitHistory();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, duplicateSelected, copySelected, deleteSelected, selectAll, commitHistory]);

  // Paste de imagem externa (Cmd/Ctrl+V vindo de fora do editor) - a função
  // CRÍTICA pedida: sem modal, sem clique em "importar", cai direto no centro
  // do artboard, já selecionada.
  useEffect(() => {
    async function onPaste(event: ClipboardEvent) {
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.getAttribute('contenteditable') === 'true') return;
      const canvasActive = fabricCanvasRef.current?.getActiveObject() as { isEditing?: boolean } | undefined;
      if (canvasActive?.isEditing) return;
      if (!containerRef.current) return;
      // Só intercepta paste quando o editor está de fato em foco/visível na tela -
      // evita roubar Cmd+V de outra aba/rota se o hook ficar montado escondido.
      if (document.activeElement !== document.body && !containerRef.current.contains(document.activeElement)) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            await addImageFromFile(file);
            return;
          }
        }
      }

      const html = event.clipboardData?.getData('text/html');
      if (html) {
        const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
        if (match?.[1]) {
          event.preventDefault();
          await addImageFromSrc(match[1]);
          return;
        }
      }

      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (text && /^https?:\/\/\S+\.(png|jpe?g|webp|gif|avif)(\?\S*)?$/i.test(text)) {
        event.preventDefault();
        await addImageFromSrc(text);
        return;
      }

      // Nada de imagem externa no clipboard - se havia um objeto do PRÓPRIO
      // canvas copiado (Ctrl/Cmd+C num elemento selecionado), este é o Ctrl+V
      // que de fato duplica ele. Achado real (2026-09-11): pasteInternal()
      // existia mas nunca era chamado de lugar nenhum - Ctrl+V pra duplicar
      // objeto do canvas simplesmente não fazia nada.
      if (clipboardRef.current && clipboardRef.current.length > 0) {
        event.preventDefault();
        await pasteInternal();
      }
    }

    const handlePaste = (event: ClipboardEvent) => void onPaste(event);
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addImageFromFile, addImageFromSrc, pasteInternal]);

  return {
    containerRef,
    canvasElRef,
    pages,
    activePageId,
    activePage,
    setActivePageId,
    zoom,
    setZoom,
    zoomToFit,
    selection,
    isReady,
    guides,
    addText,
    addShape,
    addImageFromSrc,
    addImageFromFile,
    isDrawingMode,
    brushColor,
    brushWidth,
    setDrawingMode,
    setBrushColor,
    setBrushWidth,
    deleteSelected,
    duplicateSelected,
    copySelected,
    pasteInternal,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    setSelectedOpacity,
    setSelectedBlendMode,
    toggleSelectedLock,
    flipSelected,
    replaceSelectedImageSrc,
    updateSelectedImageFilters,
    updateSelectedImageBorder,
    setSelectedImageClipShape,
    getActiveImageFrame,
    applyCrop,
    updateSelectedText,
    updateSelectedShape,
    updateSelectedPath,
    setSelectedSize,
    setSelectedPosition,
    setSelectedRotation,
    selectObjectById,
    setObjectVisible,
    setObjectLocked,
    selectAll,
    deselectAll,
    groupSelected,
    ungroupSelected,
    undo,
    redo,
    canUndo,
    canRedo,
    addPage,
    duplicatePage,
    deletePage,
    movePage,
    renamePage,
    setPageBackground,
    exportActivePageDataUrl,
    exportAllPages,
  } as const;
}

export type UseCanvaEditorResult = ReturnType<typeof useCanvaEditor>;
