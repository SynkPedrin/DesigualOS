import { Ellipse, FabricImage, Group, Line, Path, Polygon, Rect, Shadow, Textbox, Triangle, util, type FabricObject } from 'fabric';
import type { CanvaBlendMode, CanvaObject, CanvaObjectBase, CanvaShapeKind } from '@desigual-os/types';
import { loadFontVariant } from './font-manager';

/**
 * Nomes do Photoshop (nosso modelo, ver CANVA_BLEND_MODES) <-> valores reais
 * de `globalCompositeOperation` do Canvas2D, que é o que `FabricObject`
 * aceita de verdade (confirmado no .d.ts do fabric@6.9.1: a prop existe e é
 * tipada como `GlobalCompositeOperation`, o mesmo tipo do lib.dom). Só
 * 'normal' não bate 1:1 - o nome do Canvas2D pra "sem mesclagem nenhuma" é
 * 'source-over', não 'normal'.
 */
const BLEND_MODE_TO_COMPOSITE: Record<CanvaBlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

const COMPOSITE_TO_BLEND_MODE: Partial<Record<string, CanvaBlendMode>> = Object.fromEntries(
  Object.entries(BLEND_MODE_TO_COMPOSITE).map(([blendMode, composite]) => [composite, blendMode as CanvaBlendMode]),
);

export function blendModeToComposite(blendMode: CanvaBlendMode | undefined): GlobalCompositeOperation {
  return BLEND_MODE_TO_COMPOSITE[blendMode ?? 'normal'];
}

export function compositeToBlendMode(composite: string | undefined): CanvaBlendMode {
  return COMPOSITE_TO_BLEND_MODE[composite ?? 'source-over'] ?? 'normal';
}

/**
 * Ponte entre o modelo de dados portável (CanvaObject, o que é salvo/serializado)
 * e as instâncias vivas do Fabric (o que é desenhado/manipulado na tela). De
 * propósito NÃO usamos canvas.toJSON()/loadFromJSON() do próprio Fabric como
 * formato de persistência: o formato interno dele pode mudar entre versões,
 * e o pedido é explícito - preservar ESTRUTURA EDITÁVEL num modelo nosso, não
 * amarrar o banco ao formato interno de uma lib de terceiros.
 */

/** Todo objeto Fabric criado por nós carrega esses dois campos extras. */
export interface FabricMeta {
  canvaId: string;
  canvaType: CanvaObject['type'];
}

export type FabricObjectWithMeta = FabricObject & FabricMeta;

export function isManaged(object: FabricObject): object is FabricObjectWithMeta {
  return typeof (object as Partial<FabricMeta>).canvaId === 'string';
}

/**
 * As propriedades NOSSAS que precisam sobreviver dentro de um grupo
 * serializado.
 *
 * `toObject()` do Fabric só grava as propriedades que ele conhece; tudo que é
 * nosso some, inclusive nos FILHOS do grupo (Group.toObject repassa esta lista
 * a cada filho via `__serializeObjects`, fabric 6.9.1).
 *
 * Sem esta lista, o defeito medido no Gate 2.2 (18/09/2026): agrupar, salvar,
 * F5 e desagrupar devolvia ZERO camadas. Os filhos voltavam do
 * `Group.fromObject` sem `canvaId`, `isManaged` os rejeitava, e
 * `flushActivePageFromCanvas` os descartava do documento — eles continuavam
 * VISÍVEIS na artboard e sumiam do `page.objects`, então o autosave seguinte
 * apagava três objetos que a pessoa estava vendo na tela. O contraste que
 * isolou a causa está em tests/e2e/canva-group.spec.ts: desagrupar na mesma
 * sessão sempre funcionou; só quebrava depois do recarregamento.
 *
 * O `as` é necessário e honesto: o Fabric tipa este parâmetro como a união das
 * chaves que ELE conhece, e estas três são estranhas a ele por construção —
 * em tempo de execução ele copia verbatim qualquer chave listada.
 */
const PROPS_NOSSAS_NO_GRUPO = ['canvaId', 'canvaType', 'canvaShapeKind'] as unknown as Parameters<
  Group['toObject']
>[0];

function baseFabricProps(obj: CanvaObjectBase) {
  return {
    left: obj.x,
    top: obj.y,
    scaleX: obj.scaleX,
    scaleY: obj.scaleY,
    angle: obj.rotation,
    opacity: obj.opacity,
    globalCompositeOperation: blendModeToComposite(obj.blendMode),
    visible: obj.visible,
    selectable: !obj.locked,
    evented: !obj.locked,
    lockMovementX: obj.locked,
    lockMovementY: obj.locked,
    lockRotation: obj.locked,
    lockScalingX: obj.locked,
    lockScalingY: obj.locked,
    hasControls: !obj.locked,
    // Handles discretos (pedido explícito: "profissionais e discretos").
    cornerStyle: 'circle' as const,
    cornerColor: '#9333ea',
    cornerStrokeColor: '#fafaf7',
    borderColor: '#9333ea',
    cornerSize: 9,
    transparentCorners: false,
    borderScaleFactor: 1.5,
  };
}

/** Pontos de uma estrela de 5 pontas dentro de uma caixa width x height. */
export function starPoints(width: number, height: number): { x: number; y: number }[] {
  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(width, height) / 2;
  const innerR = outerR * 0.382;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

function createShapeFabricObject(obj: Extract<CanvaObject, { type: 'shape' }>): FabricObject {
  // Fabric usa `null` (não `undefined`) pra "sem valor" em fill/stroke/shadow -
  // exactOptionalPropertyTypes exige isso explicitamente, não é estilo.
  const common = {
    ...baseFabricProps(obj),
    fill: obj.fill,
    stroke: obj.strokeWidth > 0 ? obj.stroke : null,
    strokeWidth: obj.strokeWidth,
    shadow: obj.shadow ? new Shadow('rgba(0,0,0,0.35) 2px 4px 12px') : null,
  };

  switch (obj.shape) {
    case 'rect':
      return new Rect({ ...common, width: obj.width, height: obj.height, rx: obj.cornerRadius ?? 0, ry: obj.cornerRadius ?? 0 });
    case 'ellipse':
      return new Ellipse({ ...common, rx: obj.width / 2, ry: obj.height / 2 });
    case 'triangle':
      return new Triangle({ ...common, width: obj.width, height: obj.height });
    case 'line':
      return new Line([0, 0, obj.width, obj.height], {
        ...common,
        fill: null,
        stroke: obj.stroke || obj.fill,
        strokeWidth: obj.strokeWidth || 2,
      });
    case 'star':
      return new Polygon(starPoints(obj.width, obj.height), { ...common });
    default:
      return new Rect({ ...common, width: obj.width, height: obj.height });
  }
}

/**
 * Máscara de recorte (pedido explícito: "máscaras de camada") - recorta a
 * imagem na silhueta da forma escolhida, em cima do recorte retangular já
 * existente. `clipPath` do Fabric por padrão (`absolutePositioned: false`) é
 * posicionado relativo ao CENTRO do objeto que ele recorta, não ao canto
 * superior esquerdo - por isso a forma é construída centrada em (0,0), não
 * em (width/2, height/2). `null` (não criar clipPath nenhum) pra 'rect'
 * (retângulo = o recorte padrão já cobre isso, não precisa de silhueta
 * extra) e 'line' (área zero, não faz sentido como máscara).
 */
/** Direção inversa de `buildClipShape`: de qual forma um `clipPath` AO VIVO
 * foi construído - detectado pela classe Fabric da instância, não por
 * lookup em `pagesRef` (que exigiria a máscara já ter sido commitada antes -
 * mais robusto detectar direto do objeto, sem depender de ordem de eventos).
 * Usado quando recortar (crop) uma imagem que já tem máscara: a máscara
 * precisa ser reconstruída no novo tamanho, ver applyCrop em
 * use-canva-editor.ts. */
export function clipShapeKindOf(clipPath: FabricObject | null | undefined): Exclude<CanvaShapeKind, 'line'> | undefined {
  if (!clipPath) return undefined;
  if (clipPath instanceof Ellipse) return 'ellipse';
  if (clipPath instanceof Triangle) return 'triangle';
  if (clipPath instanceof Polygon) return 'star';
  return undefined;
}

export function buildClipShape(shape: CanvaShapeKind | undefined, width: number, height: number): FabricObject | null {
  switch (shape) {
    case 'ellipse':
      return new Ellipse({ rx: width / 2, ry: height / 2, originX: 'center', originY: 'center' });
    case 'triangle':
      return new Triangle({ width, height, originX: 'center', originY: 'center' });
    case 'star':
      return new Polygon(
        starPoints(width, height).map((p) => ({ x: p.x - width / 2, y: p.y - height / 2 })),
        { originX: 'center', originY: 'center' },
      );
    default:
      return null;
  }
}

/**
 * fabric@6.9.1 não expõe as classes de filtro (Brightness/Contrast/...) no
 * ponto de entrada público do pacote (confirmado: ausentes de `dist/index.d.ts`
 * e do bundle `dist/index.min.mjs`, e não há subpath `fabric/filters` no
 * `exports` do package.json - só `.`, `./es`, `./node`, `./extensions`).
 * Alternativa igualmente correta e não-destrutiva: aplicar os ajustes via
 * Canvas 2D `ctx.filter` (mesma sintaxe CSS) sobre uma cópia offscreen da
 * imagem ORIGINAL antes de entregá-la ao Fabric - `obj.src` nunca é
 * modificado, o bake é refeito do zero toda vez que os filtros mudam.
 */
export function buildCssFilterString(filters: Extract<CanvaObject, { type: 'image' }>['filters']): string {
  if (!filters) return '';
  const parts: string[] = [];
  if (filters.brightness !== undefined && filters.brightness !== 1) parts.push(`brightness(${filters.brightness})`);
  if (filters.contrast !== undefined && filters.contrast !== 1) parts.push(`contrast(${filters.contrast})`);
  if (filters.saturation !== undefined && filters.saturation !== 1) parts.push(`saturate(${filters.saturation})`);
  if (filters.blur) parts.push(`blur(${filters.blur}px)`);
  if (filters.grayscale) parts.push('grayscale(1)');
  if (filters.sepia) parts.push('sepia(1)');
  if (filters.hueRotate) parts.push(`hue-rotate(${filters.hueRotate}deg)`);
  if (filters.invert) parts.push('invert(1)');
  return parts.join(' ');
}

/**
 * Nitidez (unsharp mask) - não existe filtro CSS equivalente (só blur, o
 * oposto), então é uma convolução própria em vez de ctx.filter. Kernel de
 * 4 vizinhos: quanto maior `amount`, mais o pixel se afasta da média dos
 * vizinhos (realça bordas). `amount=0` é a imagem original inalterada -
 * matemática pura, isolada em função própria pra dar pra testar sem precisar
 * de canvas/DOM de verdade (só arrays).
 */
export function sharpenPixels(data: Uint8ClampedArray, width: number, height: number, amount: number): Uint8ClampedArray {
  if (amount <= 0 || width < 3 || height < 3) return data;
  const out = new Uint8ClampedArray(data.length);
  const center = 1 + 4 * amount;
  const edge = -amount;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const topI = (Math.max(y - 1, 0) * width + x) * 4;
      const bottomI = (Math.min(y + 1, height - 1) * width + x) * 4;
      const leftI = (y * width + Math.max(x - 1, 0)) * 4;
      const rightI = (y * width + Math.min(x + 1, width - 1)) * 4;
      for (let c = 0; c < 3; c += 1) {
        const value = center * data[i + c]! + edge * (data[topI + c]! + data[bottomI + c]! + data[leftI + c]! + data[rightI + c]!);
        out[i + c] = value;
      }
      out[i + 3] = data[i + 3]!;
    }
  }
  return out;
}

function loadHtmlImageWithCors(src: string, crossOrigin: 'anonymous' | null): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Não consegui carregar a imagem para exibição: ${src}`));
    img.src = src;
  });
}

/** `crossOrigin="anonymous"` é necessário pro canvas poder ser exportado
 * depois (toDataURL/toBlob) sem "tainted canvas" - mas se o servidor da
 * imagem não devolver os headers CORS certos, o carregamento com
 * crossOrigin falha e a imagem NUNCA aparecia (achado real, 2026-09-11: PSD
 * importado ficava com o artboard em branco). Preferível mostrar a imagem
 * mesmo sem poder exportá-la depois do que não mostrar nada - por isso o
 * fallback tenta de novo sem crossOrigin antes de desistir de verdade. */
async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  try {
    return await loadHtmlImageWithCors(src, 'anonymous');
  } catch {
    return loadHtmlImageWithCors(src, null);
  }
}

/** Carrega a imagem original e, se houver filtro pedido, devolve uma versão
 * "assada" num canvas offscreen - `src` no CanvaObject continua intocado. */
export async function loadImageElement(
  src: string,
  filters: Extract<CanvaObject, { type: 'image' }>['filters'],
): Promise<HTMLImageElement | HTMLCanvasElement> {
  const img = await loadHtmlImage(src);
  const cssFilter = buildCssFilterString(filters);
  const sharpenAmount = filters?.sharpen ?? 0;
  if (!cssFilter && sharpenAmount <= 0) return img;

  const offscreen = document.createElement('canvas');
  offscreen.width = img.naturalWidth;
  offscreen.height = img.naturalHeight;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return img;
  ctx.filter = cssFilter || 'none';
  ctx.drawImage(img, 0, 0);

  if (sharpenAmount > 0) {
    const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const sharpened = sharpenPixels(imageData.data, offscreen.width, offscreen.height, sharpenAmount);
    // `new Uint8ClampedArray(length)` sempre aloca um ArrayBuffer normal em
    // runtime (nunca SharedArrayBuffer) - o cast só contorna uma imprecisão
    // do tipo genérico da lib DOM, não esconde um problema real.
    ctx.putImageData(new ImageData(sharpened as Uint8ClampedArray<ArrayBuffer>, offscreen.width, offscreen.height), 0, 0);
  }

  return offscreen;
}

/**
 * Onde uma imagem recém-inserida entra no artboard: centralizada e cabendo em
 * ~90% dele, sem nunca ampliar além do tamanho original.
 *
 * O detalhe que importa (achado real, 2026-09-11, "o upload não funciona"):
 * `width`/`height` de um CanvaObject imagem é a CAIXA DE ORIGEM - quantos
 * pixels do arquivo original entram no quadro -, exatamente como
 * `fabric.Image` trata width/height; quem reduz pro tamanho exibido é
 * scaleX/scaleY. Devolver aqui o tamanho já reduzido como width/height (com
 * escala 1) não encolhe a imagem: RECORTA o canto superior esquerdo dela. Uma
 * foto de 3000x2000 num artboard 1080x1350 aparecia como um pedaço de
 * 972x648 do canto dela - em foto de canto claro ou transparente, parecia que
 * o upload não tinha feito nada.
 */
export function computeImagePlacement(
  naturalWidth: number,
  naturalHeight: number,
  documentWidth: number,
  documentHeight: number,
): { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number } {
  const width = naturalWidth > 0 ? naturalWidth : documentWidth * 0.5;
  const height = naturalHeight > 0 ? naturalHeight : documentHeight * 0.5;
  const scale = Math.min(1, (documentWidth * 0.9) / width, (documentHeight * 0.9) / height);
  return {
    x: (documentWidth - width * scale) / 2,
    y: (documentHeight - height * scale) / 2,
    width,
    height,
    scaleX: scale,
    scaleY: scale,
  };
}

/** Cria a instância Fabric correspondente a um CanvaObject e já marca id/tipo. */
export async function instantiateFabricObject(obj: CanvaObject): Promise<FabricObjectWithMeta> {
  let fabricObject: FabricObject;

  if (obj.type === 'image') {
    const element = await loadImageElement(obj.src, obj.filters);
    fabricObject = new FabricImage(element, {
      ...baseFabricProps(obj),
      width: obj.width,
      height: obj.height,
      flipX: obj.flipX ?? false,
      flipY: obj.flipY ?? false,
      stroke: (obj.strokeWidth ?? 0) > 0 ? (obj.stroke ?? '#ffffff') : null,
      strokeWidth: obj.strokeWidth ?? 0,
      ...(obj.cropX !== undefined ? { cropX: obj.cropX } : {}),
      ...(obj.cropY !== undefined ? { cropY: obj.cropY } : {}),
      ...(() => {
        const clip = buildClipShape(obj.clipShape, obj.width, obj.height);
        return clip ? { clipPath: clip } : {};
      })(),
    });
  } else if (obj.type === 'text') {
    // Reabrir um documento salvo não lembra fontes carregadas em sessões
    // anteriores (document.fonts começa vazio) - sem isto, um texto com fonte
    // do Fontsource renderizaria com a fonte de fallback do navegador até
    // alguém trocar a fonte de novo. Falha aqui não impede abrir o documento,
    // só mantém o fallback (mensagem humana, não travar a página inteira).
    if (obj.fontId) {
      try {
        await loadFontVariant(obj.fontId, obj.fontFamily, obj.fontWeight, obj.fontStyle);
      } catch (error) {
        console.error('font_load_failed', error);
      }
    }
    fabricObject = new Textbox(obj.uppercase ? obj.text.toUpperCase() : obj.text, {
      ...baseFabricProps(obj),
      width: obj.width,
      fontFamily: obj.fontFamily,
      fontSize: obj.fontSize,
      fontWeight: obj.fontWeight,
      fontStyle: obj.fontStyle,
      fill: obj.fill,
      textAlign: obj.textAlign,
      charSpacing: obj.letterSpacing,
      lineHeight: obj.lineHeight,
      underline: obj.underline,
      shadow: obj.shadow ? new Shadow('rgba(0,0,0,0.35) 2px 4px 12px') : null,
    });
  } else if (obj.type === 'shape') {
    fabricObject = createShapeFabricObject(obj);
  } else if (obj.type === 'path') {
    // Traço de pincel livre - `pathData` (string SVG "d") foi gerada uma
    // única vez na criação (ver use-canva-editor.ts: handlePathCreated),
    // `new Path(string, ...)` faz o parse de volta sozinho (fabric.parsePath
    // internamente), não precisamos chamar isso na mão.
    fabricObject = new Path(obj.pathData, {
      ...baseFabricProps(obj),
      fill: obj.fill,
      stroke: obj.stroke,
      strokeWidth: obj.strokeWidth,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });
  } else {
    // group: reconstruído via Group.fromObject nativo do Fabric (round-trip
    // testado, preserva o layout aninhado exato) - ver CanvaGroupObject.
    fabricObject = await Group.fromObject(obj.fabricData);
    fabricObject.set(baseFabricProps(obj));
  }

  const withMeta = fabricObject as FabricObjectWithMeta;
  withMeta.canvaId = obj.id;
  withMeta.canvaType = obj.type;
  // `shape` (rect/ellipse/triangle/line/star) não é uma prop nativa do
  // Fabric - sem guardar isto também, um objeto sem entrada prévia em
  // pagesRef (ver buildFallbackExisting) não teria como saber que TIPO de
  // forma reconstruir na volta, só que "é uma forma".
  if (obj.type === 'shape') (withMeta as FabricObjectWithMeta & { canvaShapeKind?: CanvaShapeKind }).canvaShapeKind = obj.shape;
  return withMeta;
}

/**
 * Achado real (2026-09-10, "objeto novo desaparece depois do primeiro
 * commit"): `flushActivePageFromCanvas` (use-canva-editor.ts) só sabia
 * RELER um objeto que já tinha uma entrada correspondente em `pagesRef`
 * (merge via `readCanvaObject`) - não sabia INSERIR um objeto novo, e
 * simplesmente descartava (retornava `null`) qualquer objeto do canvas sem
 * entrada prévia. Isso afetava TODO fluxo que cria um objeto e chama
 * `commitHistory()` logo em seguida - adicionar forma/texto/imagem, colar,
 * duplicar, agrupar: o objeto aparecia na tela normalmente (o Fabric já
 * tinha adicionado), mas sumia silenciosamente do documento salvo no
 * autosave seguinte (e portanto ao reabrir), porque nunca existia uma
 * entrada em `pagesRef` pra ele ser mesclado. Esta função monta um
 * "existing" honesto direto do objeto Fabric AO VIVO, usado só quando não
 * existe registro prévio - preenche o que dá pra ler do próprio Fabric (a
 * maioria dos campos) e usa um default neutro só pro que genuinamente não
 * tem como recuperar sem esse registro (ex: a URL original de uma imagem já
 * "assada" com filtro num canvas offscreen - `getSrc()` devolve o data: URL
 * ATUAL, que funciona pra exibir mas não é a URL limpa original).
 */
export function buildFallbackExisting(object: FabricObjectWithMeta): CanvaObject {
  const base = {
    id: object.canvaId,
    x: object.left ?? 0,
    y: object.top ?? 0,
    width: object.width ?? 0,
    height: object.height ?? 0,
    scaleX: object.scaleX ?? 1,
    scaleY: object.scaleY ?? 1,
    rotation: object.angle ?? 0,
    opacity: object.opacity ?? 1,
    locked: object.selectable === false,
    visible: object.visible ?? true,
    zIndex: 0,
  };

  if (object.canvaType === 'image') {
    const image = object as FabricImage & FabricMeta;
    return { ...base, type: 'image', src: typeof image.getSrc === 'function' ? image.getSrc() : '' };
  }

  if (object.canvaType === 'text') {
    const text = object as InstanceType<typeof Textbox> & FabricMeta;
    return {
      ...base,
      type: 'text',
      text: text.text ?? '',
      fontFamily: (text.fontFamily as string) ?? 'Work Sans',
      fontSize: (text.fontSize as number) ?? 24,
      fontWeight: Number(text.fontWeight ?? 400),
      fontStyle: (text.fontStyle as 'normal' | 'italic') ?? 'normal',
      fill: (text.fill as string) ?? '#0f0f0f',
      textAlign: (text.textAlign as 'left' | 'center' | 'right') ?? 'left',
      letterSpacing: (text.charSpacing as number) ?? 0,
      lineHeight: (text.lineHeight as number) ?? 1.16,
      underline: Boolean(text.underline),
      uppercase: false,
    };
  }

  if (object.canvaType === 'shape') {
    const shape = object as FabricObject & { rx?: number; canvaShapeKind?: CanvaShapeKind };
    return {
      ...base,
      type: 'shape',
      shape: shape.canvaShapeKind ?? 'rect',
      fill: typeof object.fill === 'string' ? object.fill : '#9333ea',
      stroke: typeof object.stroke === 'string' ? object.stroke : '#fafaf7',
      strokeWidth: object.strokeWidth ?? 0,
      cornerRadius: shape.rx,
    };
  }

  if (object.canvaType === 'path') {
    const path = object as unknown as InstanceType<typeof Path>;
    return {
      ...base,
      type: 'path',
      pathData: util.joinPath(path.path),
      stroke: typeof object.stroke === 'string' ? object.stroke : '#9333ea',
      strokeWidth: object.strokeWidth ?? 4,
      fill: typeof object.fill === 'string' ? object.fill : null,
    };
  }

  // group: `toObject()` nativo do Fabric é uma reconstrução MELHOR do que
  // qualquer `fabricData` velho poderia ser (reflete o estado ao vivo).
  const group = object as unknown as Group;
  return {
    ...base,
    type: 'group',
    fabricData: group.toObject(PROPS_NOSSAS_NO_GRUPO) as unknown as Record<string, unknown>,
  };
}

/** Direção inversa: lê o estado atual de uma instância Fabric de volta pro formato portável.
 * `zIndex` não é lido daqui - quem chama preenche a partir da ordem real no canvas.objects(). */
export function readCanvaObject(object: FabricObjectWithMeta, existing: CanvaObject, zIndex: number): CanvaObject {
  const base: CanvaObjectBase = {
    id: object.canvaId,
    x: object.left ?? existing.x,
    y: object.top ?? existing.y,
    width: object.width ?? existing.width,
    height: object.height ?? existing.height,
    scaleX: object.scaleX ?? existing.scaleX,
    scaleY: object.scaleY ?? existing.scaleY,
    rotation: object.angle ?? existing.rotation,
    opacity: object.opacity ?? existing.opacity,
    // Achado real (2026-09-11): isto lia sempre `existing.locked` (nunca o
    // objeto Fabric ao vivo) - bloquear/desbloquear (toggleSelectedLock ou o
    // painel de camadas) mudava `selectable` na tela mas o próximo
    // commitHistory() revertia silenciosamente pro valor antigo em pagesRef,
    // perdendo o estado de bloqueio no autosave/reload.
    locked: object.selectable === false,
    visible: object.visible ?? existing.visible,
    zIndex,
    blendMode: compositeToBlendMode(object.globalCompositeOperation),
    metadata: existing.metadata,
    // `name` (nome da camada dado pelo usuário) só existe no NOSSO modelo -
    // não há propriedade equivalente no objeto Fabric. Por isso vem de
    // `existing`, igual a `metadata`. Sem esta linha, qualquer commit
    // posterior à renomeação relia o canvas e apagava o nome: medido em
    // 17/09/2026 que renomear para "CTA Background" voltava a "Forma - rect"
    // depois do F5.
    name: existing.name,
  };

  if (existing.type === 'image') {
    const image = object as FabricImage & FabricMeta;
    return {
      ...existing,
      ...base,
      flipX: image.flipX ?? existing.flipX,
      flipY: image.flipY ?? existing.flipY,
      cropX: image.cropX ?? existing.cropX,
      cropY: image.cropY ?? existing.cropY,
      stroke: typeof image.stroke === 'string' ? image.stroke : existing.stroke,
      strokeWidth: image.strokeWidth ?? existing.strokeWidth,
      // `clipShape` não é relido do clipPath ao vivo de propósito - mesmo
      // raciocínio do `pathData` do traço de pincel: só muda através do
      // setter dedicado (setSelectedImageClipShape), nunca por transformação
      // livre do objeto.
      clipShape: existing.clipShape,
    };
  }

  if (existing.type === 'text') {
    const text = object as InstanceType<typeof Textbox> & FabricMeta;
    return {
      ...existing,
      ...base,
      text: existing.uppercase ? existing.text : (text.text ?? existing.text),
      fontFamily: (text.fontFamily as string) ?? existing.fontFamily,
      fontSize: (text.fontSize as number) ?? existing.fontSize,
      fontWeight: Number(text.fontWeight ?? existing.fontWeight),
      fontStyle: (text.fontStyle as 'normal' | 'italic') ?? existing.fontStyle,
      fill: (text.fill as string) ?? existing.fill,
      textAlign: (text.textAlign as 'left' | 'center' | 'right') ?? existing.textAlign,
      letterSpacing: (text.charSpacing as number) ?? existing.letterSpacing,
      lineHeight: (text.lineHeight as number) ?? existing.lineHeight,
      underline: (text.underline as boolean) ?? existing.underline,
    };
  }

  if (existing.type === 'shape') {
    // Achado real (2026-09-11): esta função devolvia `{...existing, ...base}`
    // sem reler fill/stroke/strokeWidth/cornerRadius do objeto Fabric AO VIVO -
    // updateSelectedShape mudava a cor visualmente mas o próximo commitHistory()
    // (chamado pela própria updateSelectedShape) sobrescrevia pagesRef com a cor
    // ANTIGA de `existing`, perdendo a mudança no autosave/reload silenciosamente.
    const shape = object as FabricObject & { rx?: number; ry?: number };
    return {
      ...existing,
      ...base,
      fill: typeof object.fill === 'string' ? object.fill : existing.fill,
      stroke: typeof object.stroke === 'string' ? object.stroke : existing.stroke,
      strokeWidth: object.strokeWidth ?? existing.strokeWidth,
      cornerRadius: shape.rx ?? existing.cornerRadius,
    };
  }

  if (existing.type === 'path') {
    // `pathData` não é relido aqui de propósito - a geometria do traço não
    // muda depois de criado, só a matriz de transform (já coberta por
    // `base`); recalcular via util.joinPath a cada commit seria trabalho
    // repetido pra um valor que já não muda. fill/stroke/strokeWidth SIM
    // são relidos ao vivo, mesmo motivo do bug de shape corrigido acima.
    return {
      ...existing,
      ...base,
      fill: typeof object.fill === 'string' ? object.fill : existing.fill,
      stroke: typeof object.stroke === 'string' ? object.stroke : existing.stroke,
      strokeWidth: object.strokeWidth ?? existing.strokeWidth,
    };
  }

  // group: fabricData (o aninhamento interno) não precisa ser relido aqui -
  // groups têm subTargetCheck:false (default do Fabric), então não dá pra
  // editar um filho individualmente enquanto agrupado; só o transform do
  // GRUPO como um todo muda, e isso já vem de `base` acima.
  return { ...existing, ...base };
}

/** Cria uma cópia rasa com novo id e posição levemente deslocada (pedido: "+20px X/Y",
 * pra deixar visualmente claro que é uma cópia). Usado por Ctrl/Cmd+D e Ctrl/Cmd+V interno. */
export function cloneCanvaObject(obj: CanvaObject, newId: string): CanvaObject {
  return { ...obj, id: newId, x: obj.x + 20, y: obj.y + 20 };
}

export function defaultShapeStroke(shape: CanvaShapeKind): { fill: string; stroke: string; strokeWidth: number } {
  if (shape === 'line') return { fill: 'transparent', stroke: '#fafaf7', strokeWidth: 4 };
  return { fill: '#9333ea', stroke: '#fafaf7', strokeWidth: 0 };
}
