import { initializeCanvas, readPsd, type BlendMode, type Layer, type LayerMaskData } from 'ag-psd';
import type { CanvaBlendMode } from '@desigual-os/types';

/** ag-psd é isomórfico (roda em Node também, via o pacote `canvas`) - em
 * browser precisa ser instruído explicitamente a usar o <canvas> nativo, uma
 * vez só por sessão. */
let canvasInitialized = false;
function ensureCanvasInitialized(): void {
  if (canvasInitialized) return;
  initializeCanvas((width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
  canvasInitialized = true;
}

/**
 * Modos de mesclagem do Photoshop -> os nossos (que por baixo são os
 * `globalCompositeOperation` do Canvas2D, ver CANVA_BLEND_MODES /
 * blendModeToComposite em fabric-sync.ts).
 *
 * O Photoshop tem ~30 modos, o Canvas2D tem 16. Os que não existem no
 * navegador viram a aproximação mais próxima (ex: "linear burn" -> multiply,
 * "vivid light" -> hard light) e são CONTADOS, pra pessoa saber onde a arte
 * pode divergir do Photoshop em vez de divergir em silêncio.
 */
const PSD_BLEND_MODE_TO_CANVA: Record<BlendMode, CanvaBlendMode> = {
  // "pass through" é modo de PASTA, não de camada: significa "não isole o
  // grupo, deixe cada filho mesclar com o que está embaixo" - que é
  // exatamente o que acontece aqui, já que achatamos os grupos.
  'pass through': 'normal',
  normal: 'normal',
  dissolve: 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  'linear burn': 'multiply',
  'darker color': 'darken',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  'linear dodge': 'screen',
  'lighter color': 'lighten',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'vivid light': 'hard-light',
  'linear light': 'hard-light',
  'pin light': 'hard-light',
  'hard mix': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'difference',
  subtraction: 'difference',
  divide: 'color-dodge',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  // Modos de mapa de altura (3D/Materiais), sem equivalente de composição.
  'linear height': 'normal',
  height: 'normal',
};

const APPROXIMATED_PSD_BLEND_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>([
  'dissolve',
  'linear burn',
  'darker color',
  'linear dodge',
  'lighter color',
  'vivid light',
  'linear light',
  'pin light',
  'hard mix',
  'subtract',
  'subtraction',
  'divide',
  'linear height',
  'height',
]);

export function psdBlendModeToCanva(mode: BlendMode | undefined): CanvaBlendMode {
  return PSD_BLEND_MODE_TO_CANVA[mode ?? 'normal'] ?? 'normal';
}

export function isApproximatedPsdBlendMode(mode: BlendMode | undefined): boolean {
  return mode !== undefined && APPROXIMATED_PSD_BLEND_MODES.has(mode);
}

export interface PsdLayerImport {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  blendMode: CanvaBlendMode;
  canvas: HTMLCanvasElement;
}

/** O que NÃO foi reproduzido fielmente, pra ser dito em voz alta ao fim da
 * importação em vez de a arte sair diferente sem explicação. */
export interface PsdImportApproximations {
  /** Nomes (do Photoshop) dos modos de mesclagem sem equivalente exato. */
  blendModes: string[];
  /** Camadas com estilo de camada (sombra, brilho, contorno, sobreposição). */
  layerEffects: number;
  /** Camadas recortadas sobre uma PASTA (ver applyClipping). */
  clippingToGroup: number;
}

export interface PsdImportResult {
  width: number;
  height: number;
  /** Ordem de baixo pra cima (mesma ordem de pilha do PSD) - vira zIndex direto. */
  layers: PsdLayerImport[];
  approximations: PsdImportApproximations;
}

/** Frase única e concreta sobre o que a importação NÃO conseguiu reproduzir
 * fielmente (estilos de camada, modos de mesclagem sem equivalente no
 * Canvas2D, recorte sobre pasta). `null` quando saiu tudo fiel. */
export function describePsdApproximations(approximations: PsdImportApproximations): string | null {
  const parts: string[] = [];
  if (approximations.layerEffects > 0) {
    parts.push(
      approximations.layerEffects === 1
        ? '1 camada usa estilo de camada (sombra, brilho ou contorno), que não é reproduzido'
        : `${approximations.layerEffects} camadas usam estilo de camada (sombra, brilho ou contorno), que não é reproduzido`,
    );
  }
  if (approximations.blendModes.length > 0) {
    parts.push(`modo(s) de mesclagem sem equivalente no navegador, aproximados: ${approximations.blendModes.join(', ')}`);
  }
  if (approximations.clippingToGroup > 0) {
    parts.push(
      `${approximations.clippingToGroup} recorte(s) sobre pasta não puderam ser aplicados (a camada entra inteira)`,
    );
  }
  if (parts.length === 0) return null;
  return `Fidelidade: ${parts.join('; ')}.`;
}

/** Retângulo em coordenadas do DOCUMENTO (é assim que o PSD guarda tudo). */
export interface DocRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/**
 * Uma máscara do Photoshop é uma imagem em TONS DE CINZA (branco = aparece,
 * preto = some), não um canal alfa - desenhá-la direto com `destination-in`
 * não recortaria nada, porque ela é 100% opaca em todo lugar. Esta função
 * converte luminância em alfa: o resultado é um canvas preto cujo ALFA é a
 * máscara, pronto pra `destination-in`.
 */
export function luminanceToAlpha(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    // Máscara é cinza (r=g=b); o canal vermelho já é a luminância.
    pixels[i + 3] = pixels[i]!;
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
  }
}

function maskToAlphaCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const out = createCanvas(maskCanvas.width, maskCanvas.height);
  const source = maskCanvas.getContext('2d');
  const target = out.getContext('2d');
  if (!source || !target) return null;
  const image = source.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  luminanceToAlpha(image.data);
  target.putImageData(image, 0, 0);
  return out;
}

/**
 * Onde o retângulo de uma máscara (ou de uma camada-base de recorte) cai
 * DENTRO da camada que ela afeta. Tudo no PSD é guardado em coordenadas do
 * documento; o canvas da camada começa em (0,0) no canto dela, então a conta
 * é sempre "posição da máscara menos posição da camada". Separado do desenho
 * em si porque é exatamente aqui que um erro de deslocamento passaria
 * despercebido - a arte sairia com a máscara torta, sem nenhum erro.
 */
export function maskPlacement(layer: DocRect, mask: DocRect): { offsetX: number; offsetY: number; width: number; height: number } {
  return { offsetX: mask.left - layer.left, offsetY: mask.top - layer.top, width: mask.width, height: mask.height };
}

/** Alfa (0..1) da área FORA do retângulo da máscara. `defaultColor` do PSD é
 * 0 (escondido) ou 255 (visível); na ausência do campo assumimos visível -
 * errar pra "aparece" é menos destrutivo do que fazer uma camada inteira
 * sumir sem explicação. */
export function maskOutsideAlpha(defaultColor: number | undefined): number {
  return (defaultColor ?? 255) / 255;
}

function readMask(node: Layer): (LayerMaskData & DocRect) | null {
  const mask = node.mask;
  if (!mask || mask.disabled || !mask.canvas) return null;
  const left = mask.left ?? 0;
  const top = mask.top ?? 0;
  const width = (mask.right ?? left + mask.canvas.width) - left;
  const height = (mask.bottom ?? top + mask.canvas.height) - top;
  if (width <= 0 || height <= 0) return null;
  return { ...mask, left, top, width, height };
}

/**
 * "Assa" a máscara de camada no alfa da própria camada - é o que o Photoshop
 * mostra na tela. Sem isto, uma camada mascarada entra inteira: o retrato que
 * deveria aparecer dentro de um círculo entra como o retângulo completo,
 * tapando o que está embaixo (motivo nº 1 de um PSD importado "sair errado").
 *
 * A máscara tem retângulo PRÓPRIO, que pode ser menor ou maior que a camada;
 * fora dele vale `defaultColor` (0 = escondido, 255 = visível). Por isso o
 * alfa é montado do tamanho da camada antes de ser aplicado.
 */
function applyMask(layerCanvas: HTMLCanvasElement, layer: DocRect, mask: LayerMaskData & DocRect): void {
  const ctx = layerCanvas.getContext('2d');
  const maskAlpha = mask.canvas ? maskToAlphaCanvas(mask.canvas) : null;
  if (!ctx || !maskAlpha) return;

  const alphaForLayer = createCanvas(layerCanvas.width, layerCanvas.height);
  const alphaCtx = alphaForLayer.getContext('2d');
  if (!alphaCtx) return;

  const outsideAlpha = maskOutsideAlpha(mask.defaultColor);
  if (outsideAlpha > 0) {
    alphaCtx.fillStyle = `rgba(0,0,0,${outsideAlpha})`;
    alphaCtx.fillRect(0, 0, alphaForLayer.width, alphaForLayer.height);
  }
  const { offsetX, offsetY, width, height } = maskPlacement(layer, mask);
  // Substitui (não compõe) a região da máscara: o alfa dela é o valor final
  // ali, não algo pra somar com o preenchimento de fora.
  alphaCtx.clearRect(offsetX, offsetY, width, height);
  alphaCtx.drawImage(maskAlpha, offsetX, offsetY, width, height);

  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alphaForLayer, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Máscara de recorte (a camada com a setinha ▼ no Photoshop): a camada só
 * aparece onde a camada-base logo abaixo tem pixel. Sem isto, uma textura ou
 * um degradê recortado sobre um texto/forma entra como um retângulo cheio
 * cobrindo a arte inteira - o segundo motivo mais comum de PSD importado
 * "saindo errado".
 *
 * `destination-in` usa o ALFA da origem, que é exatamente o recorte desejado,
 * então aqui não precisa converter nada: a base entra como está.
 */
function applyClipping(layerCanvas: HTMLCanvasElement, layer: DocRect, base: { canvas: HTMLCanvasElement } & DocRect): void {
  const ctx = layerCanvas.getContext('2d');
  if (!ctx) return;
  const { offsetX, offsetY, width, height } = maskPlacement(layer, base);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(base.canvas, offsetX, offsetY, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

function hasEnabledEffects(node: Layer): boolean {
  const effects = node.effects;
  if (!effects || effects.disabled) return false;
  const groups = [
    effects.dropShadow,
    effects.innerShadow,
    effects.solidFill,
    effects.stroke,
    effects.gradientOverlay,
  ];
  if (groups.some((list) => list?.some((item) => item.enabled !== false))) return true;
  return [effects.outerGlow, effects.innerGlow, effects.bevel, effects.satin, effects.patternOverlay].some(
    (item) => item !== undefined && item.enabled !== false,
  );
}

function rectOf(node: Layer): DocRect | null {
  if (!node.canvas) return null;
  const left = node.left ?? 0;
  const top = node.top ?? 0;
  const width = (node.right ?? left + node.canvas.width) - left;
  const height = (node.bottom ?? top + node.canvas.height) - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

interface CollectContext {
  /** Opacidade das PASTAS acima desta camada, já multiplicada. */
  inheritedOpacity: number;
  /** Máscaras das pastas acima, em coordenadas do documento. */
  inheritedMasks: (LayerMaskData & DocRect)[];
  /** Base de recorte herdada: existe quando a PASTA que contém estas camadas
   * é ela mesma uma máscara de recorte (`clipping` numa pasta recorta todo o
   * conteúdo dela sobre a camada-base de fora). */
  inheritedClip: (({ canvas: HTMLCanvasElement } & DocRect) | null);
  approximations: PsdImportApproximations;
  approximatedModes: Set<BlendMode>;
}

/**
 * Percorre a árvore de camadas e devolve as folhas com pixel de verdade, cada
 * uma já com máscara/recorte assados no alfa e com opacidade e modo de
 * mesclagem do Photoshop preservados. Pastas não viram objeto: a opacidade e
 * a máscara delas descem pros filhos (é o que o Photoshop desenha), e o
 * conteúdo é achatado num único nível.
 *
 * Camadas ocultas no PSD não entram (`hidden: true`).
 */
function collectLayers(nodes: Layer[] | undefined, out: PsdLayerImport[], context: CollectContext): void {
  if (!nodes) return;

  // Base do recorte: no Photoshop uma camada recortada (`clipping: true`)
  // recorta sobre a primeira camada NÃO recortada abaixo dela, dentro da
  // mesma pasta - `children` já vem de baixo pra cima.
  let clipBase: ({ canvas: HTMLCanvasElement } & DocRect) | null = null;
  let clipBaseIsGroup = false;

  for (const node of nodes) {
    if (node.hidden) continue;

    if (hasEnabledEffects(node)) {
      context.approximations.layerEffects += 1;
    }

    const isGroup = Boolean(node.children && node.children.length > 0);
    if (isGroup) {
      const groupMask = readMask(node);
      if (node.clipping && !clipBase && clipBaseIsGroup) {
        context.approximations.clippingToGroup += 1;
      }
      collectLayers(node.children, out, {
        ...context,
        inheritedOpacity: context.inheritedOpacity * (node.opacity ?? 1),
        inheritedMasks: groupMask ? [...context.inheritedMasks, groupMask] : context.inheritedMasks,
        inheritedClip: node.clipping ? clipBase : context.inheritedClip,
      });
      if (!node.clipping) {
        clipBase = null;
        clipBaseIsGroup = true;
      }
      continue;
    }

    const rect = rectOf(node);
    if (!rect || !node.canvas) continue;

    // Copia antes de modificar: `node.canvas` é o buffer do próprio ag-psd e
    // ainda pode servir de base de recorte pra camada seguinte.
    const canvas = createCanvas(rect.width, rect.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(node.canvas, 0, 0);

    const nextBase = { canvas, ...rect };

    if (node.clipping) {
      if (clipBase) {
        applyClipping(canvas, rect, clipBase);
      } else if (clipBaseIsGroup) {
        // Recorte sobre uma PASTA exigiria compor o alfa de todos os filhos
        // dela primeiro; achatamos as pastas, então essa base não existe mais
        // como uma imagem só. Entra sem recorte (visível demais) e é contado.
        context.approximations.clippingToGroup += 1;
      }
    } else {
      clipBase = nextBase;
      clipBaseIsGroup = false;
    }
    if (context.inheritedClip) applyClipping(canvas, rect, context.inheritedClip);

    const ownMask = readMask(node);
    if (ownMask) applyMask(canvas, rect, ownMask);
    for (const inherited of context.inheritedMasks) applyMask(canvas, rect, inherited);

    const psdBlendMode = node.blendMode ?? 'normal';
    if (isApproximatedPsdBlendMode(psdBlendMode)) {
      context.approximatedModes.add(psdBlendMode);
    }

    out.push({
      name: node.name ?? 'Camada',
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      opacity: (node.opacity ?? 1) * context.inheritedOpacity,
      blendMode: psdBlendModeToCanva(psdBlendMode),
      canvas,
    });
  }
}

/**
 * Lê um arquivo .psd e devolve suas camadas já renderizadas (ag-psd compõe
 * os pixels de cada camada num <canvas> próprio - não precisamos decodificar
 * nada manualmente). Cada camada vira depois um objeto `image` comum no
 * documento (ver canva-document-grid.tsx: usePsdImport) - texto e estilos de
 * camada do Photoshop não são reconstruídos como texto editável nem como
 * efeito vivo; o que é preservado é a APARÊNCIA: pixels, posição, opacidade,
 * modo de mesclagem, máscara de camada e máscara de recorte.
 *
 * O que fica de fora está em `approximations` e é dito à pessoa ao fim da
 * importação.
 */
export async function parsePsdFile(file: File): Promise<PsdImportResult> {
  ensureCanvasInitialized();
  const buffer = await file.arrayBuffer();
  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
  });
  const layers: PsdLayerImport[] = [];
  const approximations: PsdImportApproximations = { blendModes: [], layerEffects: 0, clippingToGroup: 0 };
  const approximatedModes = new Set<BlendMode>();
  collectLayers(psd.children, layers, {
    inheritedOpacity: 1,
    inheritedMasks: [],
    inheritedClip: null,
    approximations,
    approximatedModes,
  });
  approximations.blendModes = [...approximatedModes];
  return { width: psd.width, height: psd.height, layers, approximations };
}
