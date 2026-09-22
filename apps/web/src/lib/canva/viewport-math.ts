/**
 * Matemática do viewport do editor (zoom e pan), isolada da UI.
 *
 * Existe separada por dois motivos concretos:
 *
 * 1. `useCanvaEditor` já tem ~1700 linhas; zoom ancorado no cursor e pan são
 *    responsabilidades autocontidas e puramente numéricas.
 * 2. Estas contas são testáveis sem navegador, e são exatamente o tipo de
 *    coisa que quebra em silêncio (o zoom "quase" ancora, o pan "quase"
 *    acompanha) e só aparece como incômodo de uso.
 *
 * MODELO DE VIEWPORT (uma representação só): `{ zoom, panX, panY }`, com a
 * artboard desenhada como `translate(panX, panY) scale(zoom)` a partir do
 * canto superior esquerdo do container.
 *
 * Antes o pan era o scroll de um container `overflow-auto` com a artboard
 * centralizada por flex. Medido no navegador em 17/09/2026 que esse modelo
 * NÃO consegue ancorar o zoom no cursor: enquanto a artboard cabe inteira,
 * `scrollWidth === clientWidth`, não existe scroll para corrigir e o ponto
 * sob o cursor escorrega (58px de erro medidos num zoom de 317->454px). Com
 * `panX/panY` explícito a âncora é exata em qualquer nível de zoom, e o
 * viewport deixa de ser derivado de dois mecanismos diferentes (flex + scroll).
 *
 * Este estado é de VISUALIZAÇÃO: não entra no documento, no histórico nem no
 * autosave.
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** Sensibilidade do wheel/pinch. Multiplica o deltaY bruto do evento. */
export const ZOOM_WHEEL_SENSITIVITY = 0.0015;

/** Níveis oferecidos no seletor de zoom da topbar. */
export const ZOOM_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;

export function clampZoom(zoom: number): number {
  // NaN é ausência de informação (uma conta quebrou antes): volta pro neutro.
  // Infinito tem direção, então é só um valor fora do limite - clampa normal.
  if (Number.isNaN(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Próximo zoom a partir de um evento de roda/pinch.
 *
 * Multiplicativo, não aditivo: com passo fixo, sair de 10% custa o mesmo
 * "giro" que sair de 300%, e a sensação é de que o zoom trava embaixo e
 * dispara em cima. Em escala proporcional cada passo muda a mesma fração.
 */
export function zoomFromWheel(currentZoom: number, deltaY: number): number {
  return clampZoom(currentZoom * Math.exp(-deltaY * ZOOM_WHEEL_SENSITIVITY));
}

export interface Ponto {
  x: number;
  y: number;
}

/**
 * Converte um ponto da TELA para coordenadas do DOCUMENTO.
 *
 * `artboardRect` é o retângulo do wrapper da artboard já renderizado (ou
 * seja, já inclui zoom, centralização e scroll). Usar o rect real em vez de
 * recalcular a centralização à mão evita o erro clássico de esquecer que o
 * flex centraliza a artboard enquanto ela é menor que o container.
 */
export function screenToDocument(point: Ponto, artboardRect: { left: number; top: number }, zoom: number): Ponto {
  const z = zoom > 0 ? zoom : 1;
  return { x: (point.x - artboardRect.left) / z, y: (point.y - artboardRect.top) / z };
}

/** Inverso de `screenToDocument`. */
export function documentToScreen(point: Ponto, artboardRect: { left: number; top: number }, zoom: number): Ponto {
  return { x: artboardRect.left + point.x * zoom, y: artboardRect.top + point.y * zoom };
}

/**
 * Scroll necessário para que um ponto do documento volte a ficar embaixo do
 * cursor depois que o zoom mudou.
 *
 * Aplicado DEPOIS do novo layout: `artboardRectAfter` é medido já com o zoom
 * novo e com o scroll ainda antigo. Aumentar o scroll em S move o conteúdo S
 * pixels para a esquerda/cima, então:
 *
 *     cursor = rectAfter.left - S + docPoint.x * zoomAfter
 *  => S = rectAfter.left + docPoint.x * zoomAfter - cursor
 *
 * Prever a posição em vez de medir daria errado justamente quando a artboard
 * cruza o tamanho do container e a centralização do flex entra ou sai.
 */
export function scrollToAnchorPoint(params: {
  docPoint: Ponto;
  pointer: Ponto;
  artboardRectAfter: { left: number; top: number };
  zoomAfter: number;
  scrollLeft: number;
  scrollTop: number;
  maxScrollLeft: number;
  maxScrollTop: number;
}): { scrollLeft: number; scrollTop: number } {
  const deslocX = params.artboardRectAfter.left + params.docPoint.x * params.zoomAfter - params.pointer.x;
  const deslocY = params.artboardRectAfter.top + params.docPoint.y * params.zoomAfter - params.pointer.y;
  return {
    scrollLeft: Math.max(0, Math.min(params.maxScrollLeft, params.scrollLeft + deslocX)),
    scrollTop: Math.max(0, Math.min(params.maxScrollTop, params.scrollTop + deslocY)),
  };
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

/** Quanto da artboard precisa continuar visível, para nunca sumir da tela. */
const MARGEM_VISIVEL = 96;

/**
 * Mantém a artboard alcançável sem prendê-la ao centro: prender impediria a
 * âncora do zoom justamente quando ela cabe inteira no container.
 */
export function clampPan(viewport: Viewport, container: { width: number; height: number }, doc: { width: number; height: number }): Viewport {
  const larguraRender = doc.width * viewport.zoom;
  const alturaRender = doc.height * viewport.zoom;
  return {
    zoom: viewport.zoom,
    panX: Math.max(MARGEM_VISIVEL - larguraRender, Math.min(container.width - MARGEM_VISIVEL, viewport.panX)),
    panY: Math.max(MARGEM_VISIVEL - alturaRender, Math.min(container.height - MARGEM_VISIVEL, viewport.panY)),
  };
}

/** Centraliza a artboard no container (usado no encaixe inicial). */
export function centerViewport(zoom: number, container: { width: number; height: number }, doc: { width: number; height: number }): Viewport {
  return {
    zoom,
    panX: (container.width - doc.width * zoom) / 2,
    panY: (container.height - doc.height * zoom) / 2,
  };
}

/** Arrasto de pan: a artboard acompanha o ponteiro 1:1. */
export function panBy(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
  return { zoom: viewport.zoom, panX: viewport.panX + deltaX, panY: viewport.panY + deltaY };
}

/**
 * Zoom ancorado: o ponto do documento sob o cursor continua sob o cursor.
 *
 *   pontoTela = pan + pontoDoc * zoom
 *   queremos  cursor = panNovo + pontoDoc * zoomNovo
 *   logo      panNovo = cursor - pontoDoc * zoomNovo
 *
 * `pointer` é relativo ao canto superior esquerdo do container, o mesmo
 * referencial de `panX/panY`.
 */
export function zoomAtPointer(viewport: Viewport, nextZoom: number, pointer: Ponto): Viewport {
  const zoom = clampZoom(nextZoom);
  const docX = (pointer.x - viewport.panX) / viewport.zoom;
  const docY = (pointer.y - viewport.panY) / viewport.zoom;
  return { zoom, panX: pointer.x - docX * zoom, panY: pointer.y - docY * zoom };
}

/**
 * Retângulo normalizado de um marquee a partir dos dois cantos, em
 * coordenadas de documento. Arrastar para cima/esquerda produz largura ou
 * altura negativa; normalizar aqui evita que cada consumidor trate isso.
 */
export function marqueeRect(inicio: Ponto, fim: Ponto): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(inicio.x, fim.x),
    top: Math.min(inicio.y, fim.y),
    width: Math.abs(fim.x - inicio.x),
    height: Math.abs(fim.y - inicio.y),
  };
}

/** Interseção (não contenção) entre o marquee e a caixa de um objeto. */
export function intersects(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}
