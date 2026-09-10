import { Ellipse, FabricImage, Group, Line, Polygon, Rect, Shadow, Textbox, Triangle, type FabricObject } from 'fabric';
import type { CanvaObject, CanvaObjectBase, CanvaShapeKind } from '@desigual-os/types';
import { loadFontVariant } from './font-manager';

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

function baseFabricProps(obj: CanvaObjectBase) {
  return {
    left: obj.x,
    top: obj.y,
    scaleX: obj.scaleX,
    scaleY: obj.scaleY,
    angle: obj.rotation,
    opacity: obj.opacity,
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
    });
  } else if (obj.type === 'shape') {
    fabricObject = createShapeFabricObject(obj);
  } else {
    // group: reconstruído via Group.fromObject nativo do Fabric (round-trip
    // testado, preserva o layout aninhado exato) - ver CanvaGroupObject.
    fabricObject = await Group.fromObject(obj.fabricData);
    fabricObject.set(baseFabricProps(obj));
  }

  const withMeta = fabricObject as FabricObjectWithMeta;
  withMeta.canvaId = obj.id;
  withMeta.canvaType = obj.type;
  return withMeta;
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
    metadata: existing.metadata,
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
