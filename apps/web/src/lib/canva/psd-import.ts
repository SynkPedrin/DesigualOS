import { initializeCanvas, readPsd, type Layer } from 'ag-psd';

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

export interface PsdLayerImport {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  canvas: HTMLCanvasElement;
}

export interface PsdImportResult {
  width: number;
  height: number;
  /** Ordem de baixo pra cima (mesma ordem de pilha do PSD) - vira zIndex direto. */
  layers: PsdLayerImport[];
}

/** Percorre a árvore de camadas (grupos incluídos) e coleta só as folhas com
 * pixel de verdade - uma pasta de grupo em si não tem `canvas` próprio, só
 * os filhos dela têm. Camadas ocultas no PSD não entram (`hidden: true`). */
function collectLayers(nodes: Layer[] | undefined, out: PsdLayerImport[]): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.hidden) continue;
    if (node.children && node.children.length > 0) {
      collectLayers(node.children, out);
      continue;
    }
    if (!node.canvas) continue;
    const left = node.left ?? 0;
    const top = node.top ?? 0;
    const right = node.right ?? left + node.canvas.width;
    const bottom = node.bottom ?? top + node.canvas.height;
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) continue;
    out.push({
      name: node.name ?? 'Camada',
      left,
      top,
      width,
      height,
      opacity: node.opacity ?? 1,
      canvas: node.canvas,
    });
  }
}

/**
 * Lê um arquivo .psd e devolve suas camadas já renderizadas (ag-psd compõe
 * os pixels de cada camada num <canvas> próprio - não precisamos decodificar
 * nada manualmente). Cada camada vira depois um objeto `image` comum no
 * documento (ver canva-workspace.tsx: importPsdAsNewDocument) - texto/efeitos
 * do Photoshop não são reconstruídos como texto editável, a camada inteira é
 * importada como imagem, preservando a aparência exata.
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
  collectLayers(psd.children, layers);
  return { width: psd.width, height: psd.height, layers };
}
