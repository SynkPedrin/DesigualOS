'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveSelection, Canvas, Group, Path, PencilBrush, Point, Shadow, util, type FabricObject, type Textbox, type TPointerEvent, type TSimplePathData } from 'fabric';
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
import { alinhar, distribuir, moverNaPilha, reordenar, type Alinhamento, type Caixa, type MovimentoDePilha } from '@/lib/canva/arrange';
import { melhorEncaixe, snapTolerance } from '@/lib/canva/snap';
import {
  buildStrokeOutline,
  decimateWithPressure,
  outlineToPathData,
  resolveBrushStyle,
  type BrushPoint,
  type CanvaBrushType,
} from '@/lib/canva/brush';
import {
  circleIntersectsRect,
  classifyEraseTarget,
  eraserRadii,
  interpolateErasePoints,
  localToBitmapPoint,
} from '@/lib/canva/erase';
import { normalizeColor, rgbaToHex } from '@/lib/canva/color';
import { registrarCorRecente } from '@/components/studio/canva/color/color-picker';
import {
  blendModeToComposite,
  buildClipShape,
  buildCssFilterString,
  clipShapeKindOf,
  buildFallbackExisting,
  cloneCanvaObject,
  compositeToBlendMode,
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

/** Ferramentas do tool rail do editor. 'select' é o comportamento Fabric de
 * sempre; as demais interpretam o pointer por conta própria (ver efeito de
 * tool + handlers de mouse mais abaixo). */
export type CanvaTool = 'select' | 'hand' | 'text' | 'brush' | 'eraser' | 'eyedropper';

/** Mouse/touch sem pressão real: valor neutro que devolve exatamente a
 * largura base (ver pressureToWidth em lib/canva/brush.ts). */
function pressaoDoEvento(e: TPointerEvent): number {
  const p = e as PointerEvent;
  return p.pointerType === 'pen' && p.pressure > 0 ? p.pressure : 0.5;
}

/** Atalhos de uma letra pra cada tool (sem modificador, fora de edição de
 * texto) - padrão Figma/Photoshop. */
const TOOL_KEYBOARD_MAP: Record<string, CanvaTool> = {
  v: 'select',
  h: 'hand',
  t: 'text',
  b: 'brush',
  e: 'eraser',
  i: 'eyedropper',
};

/**
 * PencilBrush com PRESSÃO DE CANETINHA de verdade.
 *
 * Decisão de implementação (por que não é só "mudar this.width a cada
 * move"): um fabric.Path tem UM strokeWidth único - modular this.width
 * durante o arraste mudaria só o preview, e o traço final sairia com a
 * última largura (efeito fake). Aqui o traço é convertido em SILHUETA
 * preenchida (polígono cujo raio em cada ponto vem da pressão lida do
 * PointerEvent), a mesma técnica do perfect-freehand. O resultado continua
 * vetorial e persiste como CanvaPathObject (com fill em vez de stroke).
 *
 * Com `pressureEnabled` false (ou dispositivo sem pressão), cai no
 * comportamento clássico do PencilBrush (stroke uniforme).
 */
class PressurePencilBrush extends PencilBrush {
  pressureEnabled = true;
  /** Opacidade do traço (preview no contextTop + Path final). */
  opacityValue = 1;
  /** Composite do Path final (marca-texto usa 'multiply'). */
  composite: GlobalCompositeOperation = 'source-over';
  private pressures: number[] = [];

  override onMouseDown(pointer: Point, ev: { e: TPointerEvent }): void {
    this.pressures = [];
    super.onMouseDown(pointer, ev);
    this.pressures.push(pressaoDoEvento(ev.e));
  }

  override onMouseMove(pointer: Point, ev: { e: TPointerEvent }): void {
    const antes = this._points.length;
    super.onMouseMove(pointer, ev);
    // Mantém pressures alinhado a _points mesmo quando o PencilBrush
    // rejeita ponto duplicado (ou remove um no modo linha-reta).
    const depois = this._points.length;
    if (depois > antes) this.pressures.push(pressaoDoEvento(ev.e));
    else if (depois < antes) this.pressures.splice(depois);
  }

  override onMouseUp(ev: { e: TPointerEvent }): boolean {
    const resultado = super.onMouseUp(ev);
    // O preview usa globalAlpha/composite no contextTop - sem restaurar aqui,
    // o próprio Fabric herdaria o estado sujo (ex: marquee de seleção
    // desenhado em multiply) no próximo uso do canvas superior.
    const ctx = this.canvas.contextTop;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return resultado;
  }

  override _setBrushStyles(ctx: CanvasRenderingContext2D): void {
    super._setBrushStyles(ctx);
    ctx.globalAlpha = this.opacityValue;
    ctx.globalCompositeOperation = this.composite;
  }

  override createPath(pathData: TSimplePathData): InstanceType<typeof Path> {
    const path = super.createPath(pathData);
    path.opacity = this.opacityValue;
    path.globalCompositeOperation = this.composite;
    return path;
  }

  override _finalizeAndAddPath(): void {
    // Linha reta (Shift) usa a máquina de estados do PencilBrush original -
    // a silhueta por pressão não cobre esse modo.
    if (!this.pressureEnabled || this.drawStraightLine) {
      super._finalizeAndAddPath();
      return;
    }
    const ctx = this.canvas.contextTop;
    ctx.closePath();
    let pontos: BrushPoint[] = this._points.map((p, i) => ({ x: p.x, y: p.y, pressure: this.pressures[i] ?? 0.5 }));
    if (this.decimate) pontos = decimateWithPressure(pontos, this.decimate);
    const d = outlineToPathData(buildStrokeOutline(pontos, this.width));
    if (!d) {
      this.canvas.requestRenderAll();
      return;
    }
    const path = new Path(d, {
      fill: this.color,
      stroke: null,
      strokeWidth: 0,
      opacity: this.opacityValue,
      globalCompositeOperation: this.composite,
    });
    this.canvas.clearContext(ctx);
    this.canvas.fire('before:path:created', { path });
    this.canvas.add(path);
    this.canvas.requestRenderAll();
    path.setCoords();
    this._resetShadow();
    this.canvas.fire('path:created', { path });
  }
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
  /**
   * Oversample REAL aplicado ao backstore deste canvas.
   *
   * Existe por causa de um bug medido no navegador (17/09/2026): num
   * documento 1080x1350, "Exportar 1x" gerava **2160x2700**, 2x gerava
   * 4320x5400 e 4x gerava 8640x10800 - sempre o dobro do pedido. O
   * comentário que existia aqui afirmava que `toDataURL` ignorava o zoom do
   * viewport e por isso a exportação não era afetada; o PNG baixado prova
   * que não: o Fabric dimensiona a saída pelo BACKSTORE (documento x
   * oversample) vezes o multiplicador, então o fator de nitidez da tela
   * vazava para o arquivo entregue ao cliente.
   *
   * Guardar o fator aqui permite descontá-lo na exportação
   * (`exportMultiplier`), mantendo as três resoluções independentes:
   * documento (lógico) != backstore (nitidez de tela) != export (arquivo).
   */
  const renderOversampleRef = useRef(1);
  /** true depois que o usuário escolheu um zoom - trava o reenquadre automático. */
  const userChoseZoomRef = useRef(false);
  const historyRef = useRef<{ stack: CanvaPage[][]; index: number }>({ stack: [deepClonePages(pagesRef.current)], index: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loadTokenRef = useRef(0);
  /**
   * true enquanto `loadPageIntoCanvas` está reconstruindo o canvas.
   *
   * O carregamento começa com `canvas.clear()` SÍNCRONO e só repõe os
   * objetos depois de um await. Qualquer leitura do canvas nessa janela vê
   * zero objetos e grava uma página VAZIA no documento. Foi assim que trocar
   * o fundo da página (e excluir uma página) apagava todos os elementos:
   * medido em 18/09/2026, quatro formas viravam zero no payload do autosave.
   *
   * Durante um carregamento a verdade é o MODELO, não o canvas - então a
   * leitura simplesmente não acontece.
   */
  const carregandoPaginaRef = useRef(false);

  const [pagesVersion, setPagesVersion] = useState(0);
  const [activePageId, setActivePageIdState] = useState(activePageIdRef.current);
  const [zoom, setZoomState] = useState(1);
  // O encaixe roda dentro de um handler do Fabric (fora do ciclo do React) e
  // precisa do zoom ATUAL para converter a tolerância de tela em documento.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [selection, setSelection] = useState<CanvaSelectionState>({ ids: [], type: null, object: null });
  const [isReady, setIsReady] = useState(false);
  const [guides, setGuides] = useState<CanvaGuides>({ vertical: [], horizontal: [] });
  // Ferramenta ativa (tool rail). `isDrawingMode` virou DERIVADO dela
  // (brush === modo de desenho do Fabric) - estado único evita os dois
  // divergirem (ex: atalho E ligar a borracha com o pincel ainda ativo).
  const [activeTool, setActiveToolState] = useState<CanvaTool>('select');
  const activeToolRef = useRef<CanvaTool>('select');
  const isDrawingMode = activeTool === 'brush';
  const [brushColor, setBrushColorState] = useState('#9333ea');
  const [brushWidth, setBrushWidthState] = useState(4);
  const [brushOpacity, setBrushOpacityState] = useState(100);
  const [brushSmoothing, setBrushSmoothingState] = useState(50);
  const [brushType, setBrushTypeState] = useState<CanvaBrushType>('lapis');
  const [brushPressure, setBrushPressureState] = useState(true);
  const [eraserWidth, setEraserWidthState] = useState(24);
  // Refs espelham o state pra os handlers de mouse do Fabric (registrados
  // uma vez só) lerem sempre o valor ATUAL sem re-registrar listener.
  const eraserWidthRef = useRef(eraserWidth);
  eraserWidthRef.current = eraserWidth;
  const [lastPickedColor, setLastPickedColor] = useState<string | null>(null);
  const uploadImageFileRef = useRef(uploadImageFile);
  uploadImageFileRef.current = uploadImageFile;
  // O valor em si não é lido; existe só pra forçar recomputar canUndo/canRedo
  // (derivados de historyRef.current, uma ref, a cada novo render).
  const [, setHistoryTick] = useState(0);

  const pages = useMemo(() => pagesRef.current, [pagesVersion]);
  const activePage = useMemo(() => pages.find((page) => page.id === activePageId), [pages, activePageId]);

  const notifyChange = useCallback(() => {
    onChangeRef.current(deepClonePages(pagesRef.current));
  }, []);

  /**
   * Roda `ler` com os objetos em coordenadas do CANVAS, não de uma seleção.
   *
   * Achado real (18/09/2026): enquanto existe seleção múltipla, o Fabric
   * guarda cada filho com `left`/`top` RELATIVOS ao centro da
   * `ActiveSelection`. Ler o canvas nesse estado gravava essas coordenadas
   * locais no documento como se fossem absolutas - selecionar tudo e fazer
   * QUALQUER coisa que commite (renomear, ocultar, bloquear, trocar cor,
   * agrupar) empilhava a peça inteira no canto negativo, e só aparecia no
   * F5. Medido com três formas em (100,100), (300,220) e (520,140): depois
   * de um Ctrl+A e um rename, o documento guardava (-319,-134), (-171,-14)
   * e (101,-194).
   *
   * Desfazer a seleção devolve cada objeto ao sistema de coordenadas do
   * canvas (é o próprio `exitGroup` do Fabric fazendo a conta, não
   * matemática de matriz nossa); a seleção é refeita no fim, então o usuário
   * não perde o que tinha selecionado. Mesmo remédio que `aplicarPosicoes`
   * já usava do lado da ESCRITA - faltava do lado da LEITURA.
   */
  const lerEmCoordenadasDoCanvas = useCallback(<T,>(ler: () => T): T => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return ler();
    const ativos = canvas.getActiveObjects().filter(isManaged);
    if (ativos.length < 2) return ler();

    const idsSelecionados = ativos.map((o) => o.canvaId);
    canvas.discardActiveObject();
    try {
      return ler();
    } finally {
      const restaurar = canvas.getObjects().filter(isManaged).filter((o) => idsSelecionados.includes(o.canvaId));
      if (restaurar.length === 1) canvas.setActiveObject(restaurar[0]!);
      else if (restaurar.length > 1) canvas.setActiveObject(new ActiveSelection(restaurar, { canvas }));
      canvas.requestRenderAll();
    }
  }, []);

  /** Lê o canvas de volta pro CanvaPage ativo em pagesRef (ordem real = zIndex real). */
  const flushActivePageFromCanvas = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    // Ver `carregandoPaginaRef`: durante um recarregamento o canvas está
    // vazio de propósito e ler dali apagaria a página.
    if (carregandoPaginaRef.current) return;
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
    const objects = lerEmCoordenadasDoCanvas(() =>
      canvas
        .getObjects()
        .filter(isManaged)
        .map((fabricObject, index) => {
          const existing = byId.get(fabricObject.canvaId) ?? buildFallbackExisting(fabricObject);
          return readCanvaObject(fabricObject, existing, index);
        }),
    );
    pagesRef.current = pagesRef.current.map((p, index) => (index === pageIndex ? { ...p, objects } : p));
  }, [lerEmCoordenadasDoCanvas]);

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

  /**
   * Grava o estado ATUAL do modelo no histórico, sem reler o canvas.
   *
   * Existe para as operações em que o canvas NÃO representa mais a página
   * ativa. Apagar a página aberta é o caso: a pilha do Fabric ainda tem os
   * objetos da página que acabou de sumir, e relê-la gravaria o conteúdo da
   * página morta por cima da página vizinha (medido em 18/09/2026: apagar a
   * página 2 deixava a página 1 com o objeto da página 2 e perdia os três
   * dela).
   */
  const commitSnapshotDoModelo = useCallback(() => {
    const snapshot = deepClonePages(pagesRef.current);
    const { stack, index } = historyRef.current;
    const truncated = stack.slice(0, index + 1);
    truncated.push(snapshot);
    const overflow = truncated.length - MAX_HISTORY;
    const trimmed = overflow > 0 ? truncated.slice(overflow) : truncated;
    historyRef.current = { stack: trimmed, index: trimmed.length - 1 };
    setHistoryTick((tick) => tick + 1);
    setPagesVersion((version) => version + 1);
    notifyChange();
  }, [notifyChange]);

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
    // `pages` é um useMemo preso a `pagesVersion`, e `flushActivePageFromCanvas`
    // acabou de REATRIBUIR `pagesRef.current`. Sem bumpar a versão aqui, quem
    // lê `pages` continua com o array antigo.
    //
    // Achado real (17/09/2026): só as operações de PÁGINA (adicionar,
    // duplicar, renomear...) bumpavam a versão. Toda operação de OBJETO
    // (inserir forma/texto/imagem, apagar, duplicar, agrupar, mover) mudava o
    // documento sem avisar o React - o painel Camadas mostrava "Esta página
    // ainda não tem nenhum elemento" com uma forma selecionada na artboard.
    // Camadas é derivado de `page.objects`, então o painel estava certo e o
    // dado é que não chegava.
    setPagesVersion((version) => version + 1);
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
      // Achado real (17/09/2026): um objeto RECÉM-CRIADO ainda não está em
      // `pagesRef` quando o Fabric dispara `selection:created` -
      // `addObject` faz `setActiveObject` ANTES de `seedObjectsIntoPage`.
      // Com `object: null`, todo consumidor de `selection.object` (o painel
      // de propriedades, por exemplo) ficava cego logo depois de inserir uma
      // forma, e só voltava a enxergar se o usuário clicasse de novo nela.
      // `buildFallbackExisting` é o mesmo remédio que
      // `flushActivePageFromCanvas` já usa para este caso: reconstrói um
      // registro honesto a partir do objeto Fabric vivo.
      const base = existing ?? buildFallbackExisting(active[0]!);
      object = readCanvaObject(active[0]!, base, existing?.zIndex ?? 0);
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

      // Tolerância em pixels de TELA convertida para documento: a 25% a
      // antiga (6px de documento) valia 1,5px na tela e o encaixe era
      // inalcançável; a 400% valia 24px e colava longe demais. Ver snap.ts.
      const tolerancia = snapTolerance(zoomRef.current);

      const encaixeV = melhorEncaixe(
        [
          { atual: centerX, posicaoSeEncaixar: (alvo) => alvo - movingWidth / 2 },
          { atual: left, posicaoSeEncaixar: (alvo) => alvo },
          { atual: left + movingWidth, posicaoSeEncaixar: (alvo) => alvo - movingWidth },
        ],
        vTargets,
        tolerancia,
      );
      if (encaixeV) {
        snappedLeft = encaixeV.posicao;
        guideLinesV.push(encaixeV.guia);
      }
      const encaixeH = melhorEncaixe(
        [
          { atual: centerY, posicaoSeEncaixar: (alvo) => alvo - movingHeight / 2 },
          { atual: top, posicaoSeEncaixar: (alvo) => alvo },
          { atual: top + movingHeight, posicaoSeEncaixar: (alvo) => alvo - movingHeight },
        ],
        hTargets,
        tolerancia,
      );
      if (encaixeH) {
        snappedTop = encaixeH.posicao;
        guideLinesH.push(encaixeH.guia);
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
    carregandoPaginaRef.current = true;

    try {

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
    } finally {
      // Só o carregamento MAIS RECENTE libera a trava: um carregamento
      // antigo que termine depois não pode liberar a janela do novo.
      if (token === loadTokenRef.current) carregandoPaginaRef.current = false;
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
    // fica nítido até esse nível de zoom antes de voltar a esticar.
    //
    // ATENÇÃO: isto AFETA a exportação, ao contrário do que este comentário
    // afirmava antes. Medido no navegador em 17/09/2026: com oversample 2,
    // "Exportar 1x" de um documento 1080x1350 baixava um PNG de 2160x2700.
    // O Fabric dimensiona `toDataURL`/`toBlob` pelo backstore vezes o
    // multiplicador. Por isso a exportação desconta este fator via
    // `exportMultiplier` (ver renderOversampleRef).
    const oversample = computeRenderOversample(documentWidth, documentHeight);
    // Guardado porque a EXPORTAÇÃO precisa descontá-lo (ver renderOversampleRef).
    renderOversampleRef.current = oversample;
    canvas.setDimensions(
      { width: documentWidth * oversample, height: documentHeight * oversample },
      { backstoreOnly: true },
    );
    canvas.setZoom(oversample);

    fabricCanvasRef.current = canvas;

    canvas.on('selection:created', () => setSelection(readSelectionState()));
    canvas.on('selection:updated', () => setSelection(readSelectionState()));
    canvas.on('selection:cleared', () => setSelection({ ids: [], type: null, object: null }));
    canvas.on('object:modified', () => {
      // Sincroniza Canvas -> Propriedades. Sem isto, `selection.object` fica
      // com os valores de ANTES do arraste/resize/rotação: o objeto se move
      // na tela e o painel continua mostrando X/Y/L/A antigos - medido em
      // 17/09/2026, com o painel preso em 351,486 depois de arrastar a peça.
      setSelection(readSelectionState());
      commitHistory();
    });
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
        // Traço por pressão (PressurePencilBrush) é uma silhueta PREENCHIDA
        // (stroke nulo) - a cor do modelo vem do fill nesse caso.
        stroke: typeof path.stroke === 'string' ? path.stroke : typeof path.fill === 'string' ? path.fill : '#9333ea',
        strokeWidth: typeof path.stroke === 'string' ? (path.strokeWidth ?? 4) : 0,
        fill: typeof path.fill === 'string' ? path.fill : null,
        blendMode: compositeToBlendMode(path.globalCompositeOperation),
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

  /**
   * A ÚNICA transação de empilhamento do editor.
   *
   * Recebe a nova ordem da pilha (fundo primeiro), reatribui `zIndex` a
   * partir dela, reempilha o Fabric e commita UMA entrada de histórico.
   * Arrastar no painel de camadas e os quatro comandos de menu passam todos
   * por aqui: dois caminhos que reempilham de jeitos diferentes é como a
   * ordem do array e o `zIndex` divergem.
   */
  const aplicarPilha = useCallback(
    (calcular: (fundoPrimeiro: CanvaObject[]) => CanvaObject[]) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      flushActivePageFromCanvas();
      const pageIndex = pagesRef.current.findIndex((page) => page.id === activePageIdRef.current);
      if (pageIndex === -1) return;
      const page = pagesRef.current[pageIndex]!;

      // `flushActivePageFromCanvas` acabou de gravar o array NA ORDEM DA
      // PILHA do Fabric, então ele já é "fundo primeiro" - não precisa (e
      // não deve) reordenar por zIndex aqui.
      const fundoPrimeiro = calcular(page.objects);
      const objects = fundoPrimeiro.map((obj, index) => ({ ...obj, zIndex: index }));
      pagesRef.current = pagesRef.current.map((p, index) => (index === pageIndex ? { ...p, objects } : p));

      // Reempilha trazendo cada objeto para a frente, do FUNDO para o TOPO:
      // ao final a pilha do Fabric é exatamente `fundoPrimeiro`.
      // `bringObjectToFront` não depende de índice, então não sofre com a
      // lista mudando durante a iteração.
      const porId = new Map(canvas.getObjects().filter(isManaged).map((o) => [o.canvaId, o]));
      for (const obj of objects) {
        const alvo = porId.get(obj.id);
        if (alvo) canvas.bringObjectToFront(alvo);
      }
      canvas.requestRenderAll();
      setPagesVersion((version) => version + 1);
      commitHistory();
    },
    [flushActivePageFromCanvas, commitHistory],
  );

  /**
   * Move uma camada na pilha por ARRASTO no painel. `de`/`para` são índices
   * da lista NA TELA, que é ordenada por zIndex decrescente (topo primeiro).
   */
  const reorderObject = useCallback(
    (de: number, para: number) => {
      aplicarPilha((fundoPrimeiro) => {
        const visual = [...fundoPrimeiro].reverse();
        return [...reordenar(visual, de, para)].reverse();
      });
    },
    [aplicarPilha],
  );

  /** Os quatro comandos de menu, pelo mesmo caminho do arrasto. */
  const moveSelectedInStack = useCallback(
    (movimento: MovimentoDePilha) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const ids = canvas.getActiveObjects().filter(isManaged).map((o) => o.canvaId);
      if (ids.length === 0) return;
      aplicarPilha((fundoPrimeiro) => moverNaPilha(fundoPrimeiro, ids, movimento));
    },
    [aplicarPilha],
  );

  const bringForward = useCallback(() => moveSelectedInStack('forward'), [moveSelectedInStack]);

  const sendBackward = useCallback(() => moveSelectedInStack('backward'), [moveSelectedInStack]);

  const bringToFront = useCallback(() => moveSelectedInStack('front'), [moveSelectedInStack]);

  const sendToBack = useCallback(() => moveSelectedInStack('back'), [moveSelectedInStack]);

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
   * Troca a ferramenta ativa. A aplicação no canvas Fabric (ligar/desligar
   * isDrawingMode, desligar hit-test pra tools que interpretam o pointer
   * sozinhas, encerrar edição de texto com segurança) acontece no efeito
   * logo abaixo - aqui só o estado muda.
   */
  const setActiveTool = useCallback((tool: CanvaTool) => {
    activeToolRef.current = tool;
    setActiveToolState(tool);
  }, []);

  /** Compat com a API anterior do pincel (toolbar flutuante): ligar o modo
   * de desenho = ativar a tool 'brush'. */
  const setDrawingMode = useCallback(
    (enabled: boolean) => setActiveTool(enabled ? 'brush' : 'select'),
    [setActiveTool],
  );

  /**
   * Aplica a tool ativa ao canvas Fabric.
   *
   * - brush: `isDrawingMode` + um PressurePencilBrush configurado pelos
   *   controles da faixa de opções (cor/tamanho/opacidade/suavização/tipo).
   * - hand/eraser/eyedropper/text: o Fabric NÃO pode disputar o gesto
   *   (arrastar objeto, marquee de seleção), então skipTargetFind e o
   *   marquee desligam; cada tool tem seu handler nos eventos de mouse.
   * - sair de qualquer tool encerra edição de texto ativa de forma segura.
   */
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const ativo = canvas.getActiveObject() as { isEditing?: boolean; exitEditing?: () => void } | undefined;
    if (ativo?.isEditing) ativo.exitEditing?.();

    canvas.isDrawingMode = activeTool === 'brush';
    if (canvas.isDrawingMode) {
      const estilo = resolveBrushStyle({ type: brushType, width: brushWidth, opacity: brushOpacity, smoothing: brushSmoothing });
      const brush = new PressurePencilBrush(canvas);
      brush.color = brushColor;
      brush.width = estilo.width;
      brush.decimate = estilo.decimate;
      brush.pressureEnabled = brushPressure;
      brush.opacityValue = estilo.opacity;
      brush.composite = estilo.composite;
      brush.shadow = estilo.shadowBlur > 0 ? new Shadow({ color: brushColor, blur: estilo.shadowBlur }) : null;
      canvas.freeDrawingBrush = brush;
    }

    const semAlvo = activeTool !== 'select';
    canvas.skipTargetFind = semAlvo;
    canvas.selection = !semAlvo;
    canvas.requestRenderAll();
  }, [activeTool, brushColor, brushWidth, brushOpacity, brushSmoothing, brushType, brushPressure]);

  const setBrushColor = useCallback((color: string) => setBrushColorState(color), []);

  const setBrushWidth = useCallback((width: number) => setBrushWidthState(Math.min(100, Math.max(1, Math.round(width)))), []);

  const setBrushOpacity = useCallback((opacity: number) => setBrushOpacityState(Math.min(100, Math.max(0, Math.round(opacity)))), []);

  const setBrushSmoothing = useCallback((smoothing: number) => setBrushSmoothingState(Math.min(100, Math.max(0, Math.round(smoothing)))), []);

  const setBrushType = useCallback((type: CanvaBrushType) => setBrushTypeState(type), []);

  const setBrushPressure = useCallback((enabled: boolean) => setBrushPressureState(enabled), []);

  const setEraserWidth = useCallback((width: number) => setEraserWidthState(Math.min(120, Math.max(4, Math.round(width)))), []);

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
  /**
   * `patch` é MESCLADO com os filtros atuais, não os substitui: o painel
   * manda um ajuste por vez (só brilho, só contraste), e trocar o objeto
   * inteiro zeraria os outros ajustes a cada movimento de slider.
   *
   * `options.preview` segue a mesma regra dos demais updaters: durante o
   * arrasto aplica sem fechar entrada de histórico.
   */
  const updateSelectedImageFilters = useCallback(
    async (patch: CanvaImageFilters, options?: { preview?: boolean }) => {
      const canvas = fabricCanvasRef.current;
      const active = canvas?.getActiveObject();
      if (!canvas || !active || !isManaged(active) || active.canvaType !== 'image') return;
      const image = active as unknown as { setElement: (el: HTMLImageElement | HTMLCanvasElement) => void; canvaId: string };
      const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
      const existing = page?.objects.find((o) => o.id === image.canvaId);
      if (existing?.type !== 'image') return;
      const filters: CanvaImageFilters = { ...(existing.filters ?? {}), ...patch };
      const element = await loadImageElement(existing.src, filters);
      image.setElement(element);
      existing.filters = filters;
      canvas.requestRenderAll();
      if (!options?.preview) commitHistory();
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
    (patch: Partial<CanvaTextObject>, options?: { preview?: boolean }) => {
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
      if (patch.shadow !== undefined) fabricPatch.shadow = patch.shadow ? new Shadow('rgba(0,0,0,0.35) 2px 4px 12px') : null;
      active.set(fabricPatch);

      // shadow (como fontId, mais abaixo) não é relido do objeto Fabric ao
      // vivo por readCanvaObject - grava direto no pagesRef, senão o
      // commitHistory seguinte perderia a mudança silenciosamente.
      if (patch.shadow !== undefined && isManaged(active)) {
        const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
        const existing = page?.objects.find((o) => o.id === active.canvaId);
        if (existing?.type === 'text') existing.shadow = patch.shadow;
      }

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
      if (!options?.preview) commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /**
   * `options.preview` = interação CONTÍNUA em andamento (arrastar um campo de
   * cor, um slider). Aplica no canvas e redesenha, mas NÃO fecha entrada de
   * histórico: sem isso, uma única arrastada de cor viraria centenas de
   * snapshots e o undo passaria a desfazer pixel a pixel em vez de desfazer
   * "a mudança de cor". O commit vem no fim da interação, sem preview.
   */
  const updateSelectedShape = useCallback(
    (patch: Partial<CanvaShapeObject>, options?: { preview?: boolean }) => {
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
      if (patch.shadow !== undefined) fabricPatch.shadow = patch.shadow ? new Shadow('rgba(0,0,0,0.35) 2px 4px 12px') : null;
      active.set(fabricPatch);

      // Mesmo motivo do shadow em updateSelectedText: readCanvaObject não
      // relê shadow do objeto Fabric ao vivo, precisa ir direto no pagesRef.
      if (patch.shadow !== undefined && isManaged(active)) {
        const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
        const existing = page?.objects.find((o) => o.id === active.canvaId);
        if (existing?.type === 'shape') existing.shadow = patch.shadow;
      }

      canvas.requestRenderAll();
      setSelection(readSelectionState());
      if (!options?.preview) commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  /** Editar um traço de pincel já desenhado (cor/espessura) - `pathData`
   * (a geometria em si) nunca é tocado aqui, só a aparência do traço. */
  const updateSelectedPath = useCallback(
    (patch: { stroke?: string; strokeWidth?: number }, options?: { preview?: boolean }) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      active.set(patch);
      canvas.requestRenderAll();
      setSelection(readSelectionState());
      if (!options?.preview) commitHistory();
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
  /**
   * Alinhar e distribuir operam sobre a caixa REAL de cada objeto no
   * documento (`getBoundingRect(true)` = coordenadas absolutas, já com
   * escala e rotação aplicadas). Usar left/top crus erraria em qualquer
   * objeto girado ou escalado, e usar coordenada de tela faria o resultado
   * mudar conforme o zoom - que é exatamente o que não pode acontecer.
   */
  const caixasSelecionadas = useCallback((): Caixa[] => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return [];
    // `getBoundingRect()` já devolve a caixa em coordenadas absolutas do
    // canvas mesmo dentro de uma ActiveSelection (o Fabric compõe a matriz
    // do pai) - é a LEITURA que fica certa; quem erra é a ESCRITA direta em
    // left/top, tratada em aplicarPosicoes.
    return canvas
      .getActiveObjects()
      .filter(isManaged)
      .map((obj) => {
        const r = obj.getBoundingRect();
        return { id: obj.canvaId, left: r.left, top: r.top, width: r.width, height: r.height };
      });
  }, []);

  /** Aplica um mapa id -> nova posição, respeitando a caixa (não o left/top cru). */
  const aplicarPosicoes = useCallback(
    (destinos: Record<string, { left?: number; top?: number }>) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || Object.keys(destinos).length === 0) return;

      /**
       * Enquanto existe uma seleção múltipla, o Fabric guarda os filhos com
       * coordenadas RELATIVAS ao centro da `ActiveSelection` - escrever
       * `left`/`top` absolutos ali produz posição errada (medido: alinhar
       * três objetos à esquerda deixou X em 0, 150 e 49). Desfazer a seleção
       * devolve cada objeto ao sistema de coordenadas do canvas; a seleção é
       * refeita no fim para o usuário não perceber.
       */
      const idsSelecionados = canvas.getActiveObjects().filter(isManaged).map((o) => o.canvaId);
      canvas.discardActiveObject();

      for (const obj of canvas.getObjects().filter(isManaged)) {
        const alvo = destinos[obj.canvaId];
        if (!alvo) continue;
        // O deslocamento vai no left/top do objeto, mas é CALCULADO a partir
        // da caixa: assim um objeto girado acaba com a caixa no lugar pedido.
        const r = obj.getBoundingRect();
        if (alvo.left !== undefined) obj.set({ left: (obj.left ?? 0) + (alvo.left - r.left) });
        if (alvo.top !== undefined) obj.set({ top: (obj.top ?? 0) + (alvo.top - r.top) });
        obj.setCoords();
      }

      // Restaura a seleção que o usuário tinha.
      const restaurar = canvas.getObjects().filter(isManaged).filter((o) => idsSelecionados.includes(o.canvaId));
      if (restaurar.length === 1) canvas.setActiveObject(restaurar[0]!);
      else if (restaurar.length > 1) canvas.setActiveObject(new ActiveSelection(restaurar, { canvas }));

      canvas.requestRenderAll();
      setSelection(readSelectionState());
      commitHistory();
    },
    [commitHistory, readSelectionState],
  );

  const alignSelected = useCallback(
    (como: Alinhamento) => {
      const caixas = caixasSelecionadas();
      if (caixas.length === 0) return;
      aplicarPosicoes(alinhar(caixas, como, { width: documentWidth, height: documentHeight }));
    },
    [caixasSelecionadas, aplicarPosicoes, documentWidth, documentHeight],
  );

  const distributeSelected = useCallback(
    (eixo: 'horizontal' | 'vertical') => {
      const caixas = caixasSelecionadas();
      if (caixas.length < 3) return;
      aplicarPosicoes(distribuir(caixas, eixo));
    },
    [caixasSelecionadas, aplicarPosicoes],
  );

  /**
   * Renomeia uma camada. O nome vive no CanvaObject (persistido), não só na
   * UI - senão sumiria no F5. Nome vazio volta ao rótulo derivado do
   * conteúdo em vez de gravar string vazia.
   */
  const renameObject = useCallback(
    (id: string, nome: string) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      flushActivePageFromCanvas();
      const limpo = nome.trim();
      const pageIndex = pagesRef.current.findIndex((page) => page.id === activePageIdRef.current);
      if (pageIndex === -1) return;
      const page = pagesRef.current[pageIndex]!;
      const objects = page.objects.map((obj) => (obj.id === id ? { ...obj, name: limpo.length > 0 ? limpo : undefined } : obj));
      pagesRef.current = pagesRef.current.map((p, index) => (index === pageIndex ? { ...p, objects } : p));
      setPagesVersion((version) => version + 1);
      // Commit direto (sem passar por flush de novo): o nome não existe no
      // objeto Fabric, então reler o canvas apagaria a alteração.
      const snapshot = deepClonePages(pagesRef.current);
      const { stack, index } = historyRef.current;
      const truncated = stack.slice(0, index + 1);
      truncated.push(snapshot);
      historyRef.current = { stack: truncated, index: truncated.length - 1 };
      setHistoryTick((tick) => tick + 1);
      notifyChange();
    },
    [flushActivePageFromCanvas, notifyChange],
  );

  /**
   * Move uma camada na pilha. `de`/`para` são índices da lista NA TELA, que é
   * ordenada por zIndex decrescente (o topo visual aparece em primeiro).
   *
   * Política única de empilhamento: a ORDEM DO ARRAY manda e o `zIndex` é
   * reatribuído a partir dela. Guardar os dois como verdades independentes é
   * o caminho garantido para divergirem — aqui o zIndex é sempre derivado.
   */
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
      const fallback = activePageIdRef.current === pageId ? next[Math.min(index, next.length - 1)]! : null;
      if (!fallback) {
        // Apagou uma página que não estava aberta: o canvas continua sendo a
        // página ativa, então relê-lo é o certo.
        commitHistory();
        return;
      }
      activePageIdRef.current = fallback.id;
      setActivePageIdState(fallback.id);
      // A página aberta deixou de existir. O canvas ainda tem os objetos DELA,
      // então gravar a partir do modelo é a única leitura correta aqui.
      commitSnapshotDoModelo();
      void loadPageIntoCanvas(fallback);
    },
    [loadPageIntoCanvas, commitHistory, commitSnapshotDoModelo],
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
      setPagesVersion((v) => v + 1);
      // Commita com o canvas ainda íntegro; só depois recarrega (o fundo de
      // IMAGEM só entra no canvas por esse caminho).
      commitHistory();
      const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
      if (page) void loadPageIntoCanvas(page);
    },
    [loadPageIntoCanvas, commitHistory],
  );

  /**
   * Reavisa o Fabric de onde o canvas está na tela.
   *
   * O Fabric guarda o offset do elemento (`_offset`) e só o recalcula em
   * init/resize de janela. O viewport do editor move a artboard por
   * `transform: translate(...)`, o que NÃO dispara nenhum dos dois - e com o
   * offset velho todo ponteiro chega deslocado: medido em 17/09/2026 que,
   * depois de passar o pan para transform, clicar em cima de uma forma
   * selecionava zero objetos, porque o Fabric procurava o clique em outro
   * lugar do canvas.
   */
  const recalcPointerOffset = useCallback(() => {
    fabricCanvasRef.current?.calcOffset();
  }, []);

  const setZoom = useCallback((value: number) => {
    // Zoom escolhido por gesto/UI do usuário: a partir daqui o editor para de
    // reenquadrar sozinho quando o container muda de tamanho.
    userChoseZoomRef.current = true;
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
    // Pedir "encaixar" devolve o controle ao automático: o editor volta a
    // acompanhar mudanças de tamanho do container até o usuário dar zoom.
    userChoseZoomRef.current = false;
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
   * (>0x>0) do container e só então ajusta.
   *
   * Achado real (17/09/2026): ele desligava depois desse primeiro encaixe
   * (`observer.disconnect()`), o que era certo enquanto o container tinha
   * tamanho fixo. Com o editor assumindo a tela ao abrir um documento, o
   * container CRESCE logo depois do primeiro encaixe (o hero do Studio sai
   * de cena) - e, como o observer já havia se desligado, o zoom continuava
   * calculado para a caixa pequena: medido um artboard de 1016x1270
   * começando em y=-255, ou seja, cortado acima da área visível.
   *
   * Agora ele continua observando e reenquadra a cada mudança de tamanho,
   * mas só enquanto o usuário não tiver escolhido um zoom - que era a razão
   * original de desligar. Clicar em "encaixar" devolve o controle ao
   * automático.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      if (userChoseZoomRef.current) return;
      // rAF: um resize de layout dispara várias entradas seguidas; reenquadrar
      // em cada uma faria o artboard tremer durante a animação do painel.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => zoomToFit());
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
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

  /** Multiplicador pedido pelo usuário (1x/2x/4x) -> multiplicador real do
   * Fabric, descontando o oversample do backstore. */
  const exportMultiplier = useCallback((requested: number): number => {
    const oversample = renderOversampleRef.current > 0 ? renderOversampleRef.current : 1;
    return requested / oversample;
  }, []);

  const exportActivePageDataUrl = useCallback(
    (format: 'png' | 'jpeg' | 'webp', multiplier: number): string => {
      flushActivePageFromCanvas();
      const canvas = fabricCanvasRef.current;
      if (!canvas) return '';
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      const efetivo = exportMultiplier(multiplier);
      return withJpegSafeBackgroundSync(canvas, format, () => canvas.toDataURL({ format, multiplier: efetivo, quality: 0.92 }));
    },
    [flushActivePageFromCanvas, exportMultiplier],
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
        const blob = await withJpegSafeBackgroundAsync(canvas, format, () => canvas.toBlob({ format, multiplier: exportMultiplier(multiplier), quality: 0.92 }));
        if (blob) results.push({ filename: `slide-${String(i + 1).padStart(2, '0')}.${format}`, blob });
      }

      const restore = pagesRef.current.find((p) => p.id === originalActiveId);
      if (restore) await loadPageIntoCanvas(restore);
      return results;
    },
    [flushActivePageFromCanvas, loadPageIntoCanvas, exportMultiplier],
  );

  // ------------------------------------------------------------------
  // Borracha, conta-gotas e inserção de texto no ponto do clique
  // (handlers das tools não-seleção; registrados no efeito mais abaixo).
  // ------------------------------------------------------------------

  /** Sessão de apagado raster em andamento (mouse:down -> mouse:up sobre
   * uma imagem): bitmap de trabalho (janela de crop copiada do ORIGINAL,
   * sem filtros assados - eles continuam vivos no modelo) + canvas de
   * preview (work + filtro CSS, é o que aparece na tela durante o arrasto). */
  const eraseSessionRef = useRef<{
    target: FabricObjectWithMeta;
    work: HTMLCanvasElement;
    preview: HTMLCanvasElement;
    cssFilter: string;
    cropX: number;
    cropY: number;
    last: { x: number; y: number } | null;
  } | null>(null);

  /** O objeto apagável (path/imagem) mais ao topo sob o círculo da borracha.
   * Texto/forma/grupo são "transparentes" pra borracha - o scan continua
   * pra baixo na pilha até achar um apagável. */
  const eraseTargetAt = useCallback((pointer: { x: number; y: number }): FabricObjectWithMeta | null => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return null;
    const circulo = { x: pointer.x, y: pointer.y, radius: eraserWidthRef.current / 2 };
    const objects = canvas.getObjects();
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const obj = objects[i]!;
      if (!isManaged(obj) || obj.visible === false || obj.selectable === false) continue;
      if (classifyEraseTarget(obj.canvaType) === null) continue;
      if (circleIntersectsRect(circulo, obj.getBoundingRect())) return obj;
    }
    return null;
  }, []);

  /** Borracha em path: apaga o traço INTEIRO (objeto vetorial, não dá pra
   * furar parcialmente sem geometria booleana). Cada remoção é uma entrada
   * de histórico - o undo restaura um traço por vez. */
  const erasePathAt = useCallback(
    (pointer: { x: number; y: number }): boolean => {
      const canvas = fabricCanvasRef.current;
      const target = eraseTargetAt(pointer);
      if (!canvas || !target || target.canvaType !== 'path') return false;
      canvas.discardActiveObject();
      canvas.remove(target);
      canvas.requestRenderAll();
      commitHistory();
      return true;
    },
    [eraseTargetAt, commitHistory],
  );

  const beginRasterErase = useCallback(async (target: FabricObjectWithMeta) => {
    const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
    const existing = page?.objects.find((o) => o.id === target.canvaId);
    const src = existing?.type === 'image' ? existing.src : (target as unknown as { getSrc?: () => string }).getSrc?.();
    if (!src) return;
    const filters = existing?.type === 'image' ? existing.filters : undefined;
    const cropX = (target as unknown as { cropX?: number }).cropX ?? 0;
    const cropY = (target as unknown as { cropY?: number }).cropY ?? 0;
    // width/height de Fabric.Image JÁ SÃO a janela-fonte em pixels do arquivo
    // (mesma convenção do crop) - o bitmap de trabalho tem exatamente esse
    // tamanho, e o resultado vira o asset novo sem crop residual.
    const w = Math.max(1, Math.round(target.width ?? 0));
    const h = Math.max(1, Math.round(target.height ?? 0));
    try {
      const element = await loadImageElement(src, undefined);
      const work = document.createElement('canvas');
      work.width = w;
      work.height = h;
      const ctx = work.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(element, cropX, cropY, w, h, 0, 0, w, h);
      const preview = document.createElement('canvas');
      preview.width = w;
      preview.height = h;
      // O elemento ao vivo passa a ser a janela (crop zerado) - visualmente
      // idêntico, e evita crop residual duplo quando o src novo entrar.
      target.set({ cropX: 0, cropY: 0 });
      eraseSessionRef.current = { target, work, preview, cssFilter: buildCssFilterString(filters), cropX, cropY, last: null };
    } catch {
      toast('Não foi possível preparar a imagem para apagar.', 'error');
    }
  }, []);

  const applyRasterErase = useCallback((pointer: { x: number; y: number }) => {
    const session = eraseSessionRef.current;
    const canvas = fabricCanvasRef.current;
    if (!session || !canvas) return;
    const { target, work, preview, cssFilter } = session;
    // documento -> espaço local do objeto (origem no centro, via inversa da
    // matriz de transform - cobre rotação/escala/flip) -> pixel do bitmap.
    const inv = util.invertTransform(target.calcTransformMatrix());
    const local = util.transformPoint(new Point(pointer.x, pointer.y), inv);
    const bitmap = localToBitmapPoint(local, { width: work.width, height: work.height });
    const { rx, ry } = eraserRadii(eraserWidthRef.current, target.scaleX ?? 1, target.scaleY ?? 1);
    const ctx = work.getContext('2d');
    if (!ctx) return;
    const pontos = session.last ? interpolateErasePoints(session.last, bitmap, rx, ry) : [bitmap];
    session.last = bitmap;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';
    for (const p of pontos) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Preview ao vivo: o bitmap apagado com o filtro CSS da imagem por cima
    // (é como ela aparece em tela e como volta do F5 - o modelo mantém os
    // filtros vivos sobre o src novo).
    const pctx = preview.getContext('2d');
    if (!pctx) return;
    pctx.clearRect(0, 0, work.width, work.height);
    pctx.filter = cssFilter || 'none';
    pctx.drawImage(work, 0, 0);
    (target as unknown as { setElement: (el: HTMLCanvasElement) => void }).setElement(preview);
    canvas.requestRenderAll();
  }, []);

  const finishRasterErase = useCallback(async () => {
    const session = eraseSessionRef.current;
    eraseSessionRef.current = null;
    const canvas = fabricCanvasRef.current;
    if (!session || !canvas) return;
    const { target, work, cropX, cropY } = session;
    const page = pagesRef.current.find((p) => p.id === activePageIdRef.current);
    const existing = page?.objects.find((o) => o.id === target.canvaId);
    const filters = existing?.type === 'image' ? existing.filters : undefined;
    const srcAntes = existing?.type === 'image' ? existing.src : undefined;
    const restoreElement = async () => {
      if (!srcAntes) return;
      try {
        const el = await loadImageElement(srcAntes, filters);
        (target as unknown as { setElement: (el: HTMLImageElement | HTMLCanvasElement) => void }).setElement(el);
        // setElement redefine width/height pro tamanho natural; volta pra
        // janela de crop original + crop pra tela não pular.
        target.set({ width: work.width, height: work.height, cropX, cropY });
        target.setCoords();
        canvas.requestRenderAll();
      } catch {
        /* melhor esforço - o modelo nunca mudou, um F5 restaura tudo */
      }
    };
    try {
      const blob = await new Promise<Blob | null>((resolve) => work.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('toBlob retornou null');
      const file = new File([blob], 'apagado.png', { type: 'image/png' });
      // Asset NOVO no Storage, original preservado - undo restaura o src
      // anterior via histórico normal (replaceSelectedImageSrc já commita).
      const url = await uploadImageFileRef.current(file);
      canvas.setActiveObject(target);
      await replaceSelectedImageSrc(url);
      // replaceSelectedImageSrc carrega o src CRU no elemento; re-assa os
      // filtros ao vivo pra tela não "perder" o ajuste até o próximo F5.
      if (filters && Object.values(filters).some((v) => v !== undefined && v !== false && v !== 0 && v !== 1)) {
        await updateSelectedImageFilters({ ...filters }, { preview: true });
      }
    } catch {
      toast('Não foi possível concluir a borrachada na imagem.', 'error');
      await restoreElement();
    }
  }, [replaceSelectedImageSrc, updateSelectedImageFilters]);

  /** Aplica a cor capturada: fill de forma/texto, stroke de path; sem
   * seleção (ou seleção não colorível), copia o HEX pro clipboard. Sempre
   * registra nos Recentes e fecha a tool (padrão de editores). */
  const applyPickedColor = useCallback(
    (hex: string) => {
      const canvas = fabricCanvasRef.current;
      registrarCorRecente(hex);
      setLastPickedColor(hex);
      const active = canvas?.getActiveObject();
      let aplicada = false;
      if (active && isManaged(active)) {
        if (active.canvaType === 'shape') {
          updateSelectedShape({ fill: hex });
          aplicada = true;
        } else if (active.canvaType === 'text') {
          updateSelectedText({ fill: hex });
          aplicada = true;
        } else if (active.canvaType === 'path') {
          updateSelectedPath({ stroke: hex });
          aplicada = true;
        }
      }
      if (aplicada) {
        toast(`Cor ${hex} aplicada.`, 'success');
      } else {
        void navigator.clipboard?.writeText(hex).catch(() => {});
        toast(`Cor ${hex} copiada`, 'success');
      }
      setActiveTool('select');
    },
    [updateSelectedShape, updateSelectedText, updateSelectedPath, setActiveTool],
  );

  const handleEyedropperClick = useCallback(
    async (pointer: { x: number; y: number }) => {
      const Ctor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      if (Ctor) {
        try {
          const { sRGBHex } = await new Ctor().open();
          const hex = normalizeColor(sRGBHex);
          if (hex) applyPickedColor(hex);
        } catch {
          // Esc/cancelamento do seletor nativo: continua na tool.
        }
        return;
      }
      // Fallback (Firefox/Safari não têm EyeDropper): lê o pixel direto do
      // canvas renderizado. `lowerCanvasEl` já contém fundo + objetos na
      // resolução do backstore, então basta escalar o ponto do documento
      // pelo fator real do backstore (cobre oversample E retina de uma vez).
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      try {
        const lower = canvas.lowerCanvasEl;
        const fator = lower.width / documentWidth;
        const ctx = lower.getContext('2d');
        if (!ctx) throw new Error('contexto 2d indisponível');
        const d = ctx.getImageData(Math.round(pointer.x * fator), Math.round(pointer.y * fator), 1, 1).data;
        if ((d[3] ?? 0) === 0) {
          toast('Nenhuma cor sob o cursor neste ponto.', 'error');
          return;
        }
        applyPickedColor(rgbaToHex(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 255) / 255));
      } catch {
        // Canvas "contaminado" por imagem sem CORS bloqueia getImageData.
        toast('Não foi possível ler a cor da tela neste ponto.', 'error');
        setActiveTool('select');
      }
    },
    [applyPickedColor, documentWidth, setActiveTool],
  );

  /** Tool de texto: clique cria um Textbox NAQUELE ponto já em edição e
   * volta pra seleção (padrão Canva/Figma - reativar a tool insere outro). */
  const handleTextToolClick = useCallback(
    async (pointer: { x: number; y: number }) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      const obj = defaultTextObject('body', documentWidth, documentHeight);
      obj.x = pointer.x;
      obj.y = pointer.y;
      await addObject(obj);
      const ativo = canvas.getActiveObject() as InstanceType<typeof Textbox> | undefined;
      ativo?.enterEditing?.();
      ativo?.selectAll?.();
      setActiveTool('select');
    },
    [addObject, documentWidth, documentHeight, setActiveTool],
  );

  /** Registra os handlers das tools nos eventos de mouse do Fabric. Espera
   * `isReady` (canvas criado no efeito de setup acima) e depende só de
   * callbacks estáveis - roda uma vez por montagem. */
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !isReady) return;
    const onDown = (info: { pointer?: { x: number; y: number }; e?: Event }) => {
      const pointer = info.pointer;
      if (!pointer) return;
      // Só o botão esquerdo aciona tools (botão do meio é pan, direito é menu).
      if (((info.e as MouseEvent | undefined)?.button ?? 0) !== 0) return;
      const tool = activeToolRef.current;
      if (tool === 'eraser') {
        const target = eraseTargetAt(pointer);
        if (!target) return;
        if (target.canvaType === 'path') erasePathAt(pointer);
        else void beginRasterErase(target).then(() => applyRasterErase(pointer));
      } else if (tool === 'eyedropper') {
        void handleEyedropperClick(pointer);
      } else if (tool === 'text') {
        void handleTextToolClick(pointer);
      }
    };
    const onMove = (info: { pointer?: { x: number; y: number }; e?: Event }) => {
      if (activeToolRef.current !== 'eraser' || !info.pointer) return;
      // Só apaga com o botão esquerdo segurado (buttons bitmask).
      if (((info.e as PointerEvent | undefined)?.buttons ?? 0) !== 1) return;
      if (eraseSessionRef.current) applyRasterErase(info.pointer);
      else erasePathAt(info.pointer);
    };
    const onUp = () => {
      if (eraseSessionRef.current) void finishRasterErase();
    };
    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);
    return () => {
      canvas.off('mouse:down', onDown);
      canvas.off('mouse:move', onMove);
      canvas.off('mouse:up', onUp);
    };
  }, [isReady, eraseTargetAt, erasePathAt, beginRasterErase, applyRasterErase, finishRasterErase, handleEyedropperClick, handleTextToolClick]);

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
      if (meta && event.key.toLowerCase() === 'g' && event.shiftKey) {
        event.preventDefault();
        ungroupSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        groupSelected();
        return;
      }
      if (meta && event.key === '0') {
        event.preventDefault();
        zoomToFit();
        return;
      }
      if (meta && event.key === '1') {
        event.preventDefault();
        setZoom(1);
        return;
      }
      // Zoom por teclado: '+'/'=' e '-' com ou sem modificador (o isTyping
      // acima já protege inputs e edição de texto no canvas).
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom(zoomRef.current + 0.1);
        return;
      }
      if (event.key === '-') {
        event.preventDefault();
        setZoom(zoomRef.current - 0.1);
        return;
      }
      // Teclas de tool (sem modificador), padrão Figma/PS.
      if (!meta) {
        const tool = TOOL_KEYBOARD_MAP[event.key.toLowerCase()];
        if (tool) {
          event.preventDefault();
          setActiveTool(tool);
          return;
        }
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
  }, [undo, redo, duplicateSelected, copySelected, deleteSelected, selectAll, commitHistory, groupSelected, ungroupSelected, zoomToFit, setZoom, setActiveTool]);

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
    recalcPointerOffset,
    selection,
    isReady,
    guides,
    addText,
    addShape,
    addImageFromSrc,
    addImageFromFile,
    isDrawingMode,
    activeTool,
    setActiveTool,
    brushColor,
    brushWidth,
    brushOpacity,
    brushSmoothing,
    brushType,
    brushPressure,
    eraserWidth,
    lastPickedColor,
    setDrawingMode,
    setBrushColor,
    setBrushWidth,
    setBrushOpacity,
    setBrushSmoothing,
    setBrushType,
    setBrushPressure,
    setEraserWidth,
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
    alignSelected,
    distributeSelected,
    renameObject,
    reorderObject,
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
