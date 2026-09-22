/**
 * Parâmetros e geometria do pincel de desenho livre, isolados do Fabric e da
 * UI pra serem testáveis sem navegador.
 *
 * A parte não-óbvia aqui é a PRESSÃO: um `fabric.Path` tem UM `strokeWidth`
 * só, então "largura variável por pressão" não é representável como traço
 * com borda. A saída real (é como o perfect-freehand e os brushes de
 * verdade funcionam) é converter o traço num POLÍGONO preenchido - a
 * silhueta do traço - onde cada ponto contribui um raio proporcional à
 * pressão lida do PointerEvent. O resultado continua sendo um Path vetorial
 * (persiste como CanvaPathObject com fill), só que preenchido em vez de
 * contornado.
 */

export type CanvaBrushType = 'lapis' | 'caneta' | 'marca-texto';

export interface BrushStyleInput {
  type: CanvaBrushType;
  /** 1-100, em px de documento. */
  width: number;
  /** 0-100 (%). */
  opacity: number;
  /** 0-100 (%). */
  smoothing: number;
}

export interface ResolvedBrushStyle {
  /** Largura efetiva já com o fator do tipo (marca-texto engrossa). */
  width: number;
  /** 0-1, pronto pra `opacity` do objeto / globalAlpha do preview. */
  opacity: number;
  /** Valor pro `decimate` do PencilBrush (px mínimos entre pontos). */
  decimate: number;
  composite: GlobalCompositeOperation;
  /** 0 = sem sombra. Só a caneta usa (borda mais suave). */
  shadowBlur: number;
}

/**
 * Suavização (0-100) -> `decimate` do PencilBrush (0.4 = cru, ~12 = bem
 * liso). Escala quadrática: o começo do slider faz pouca diferença (é onde
 * está o uso comum) e o fim alisa de verdade.
 */
export function smoothingToDecimate(smoothing: number): number {
  const s = Math.min(100, Math.max(0, smoothing)) / 100;
  return 0.4 + s * s * 11.6;
}

/** Pressão (0-1) -> largura efetiva. 0.5 (mouse, sem pressão) = largura
 * base exata; o piso de 35% evita que o traço suma em toque leve. */
export function pressureToWidth(baseWidth: number, pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  return baseWidth * (0.35 + 1.3 * p);
}

/** Estilo efetivo de cada tipo de pincel a partir dos controles da UI. */
export function resolveBrushStyle(input: BrushStyleInput): ResolvedBrushStyle {
  const baseOpacity = Math.min(100, Math.max(0, input.opacity)) / 100;
  const width = Math.max(1, input.width);
  const decimate = smoothingToDecimate(input.smoothing);
  if (input.type === 'caneta') {
    // Caneta: traço levemente translúcido com sombra curta - a borda fica
    // menos "dura" que a do lápis sem precisar de outra geometria.
    return { width, opacity: baseOpacity * 0.85, decimate, composite: 'source-over', shadowBlur: width * 0.3 };
  }
  if (input.type === 'marca-texto') {
    // Marca-texto: largo, bem transparente e em multiply pra sobrepor texto
    // sem encobrir (multiply sobre fundo branco preserva o que está embaixo).
    return { width: width * 2.5, opacity: baseOpacity * 0.4, decimate, composite: 'multiply', shadowBlur: 0 };
  }
  return { width, opacity: baseOpacity, decimate, composite: 'source-over', shadowBlur: 0 };
}

export interface BrushPoint {
  x: number;
  y: number;
  /** 0-1; 0.5 = dispositivo sem pressão (mouse). */
  pressure: number;
}

/**
 * Decimação que preserva o alinhamento ponto<->pressão. O `decimatePoints`
 * nativo do PencilBrush devolve um array novo de pontos e perderia a
 * pressão associada a cada um - aqui os dois viajam juntos no mesmo objeto.
 * O último ponto nunca é descartado (senão o traço termina antes do cursor).
 */
export function decimateWithPressure(points: BrushPoint[], distance: number): BrushPoint[] {
  if (points.length <= 2 || distance <= 0) return points;
  const resultado: BrushPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const anterior = resultado[resultado.length - 1]!;
    const atual = points[i]!;
    if (Math.hypot(atual.x - anterior.x, atual.y - anterior.y) >= distance) resultado.push(atual);
  }
  resultado.push(points[points.length - 1]!);
  return resultado;
}

/**
 * Converte a linha central do traço + pressões na silhueta preenchida.
 *
 * Para cada ponto, a normal do segmento (perpendicular à direção média de
 * chegada/saída) define onde ficam as duas bordas, afastadas de `raio`
 * (metade da largura por pressão). O polígono final é borda esquerda na
 * ida + borda direita na volta, fechado.
 *
 * Com pressão constante (mouse = 0.5) o resultado é um traço de largura
 * uniforme - o mesmo caso de sempre, só que pela mesma geometria.
 */
export function buildStrokeOutline(points: BrushPoint[], baseWidth: number): { x: number; y: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    // Clique sem arrastar: um "ponto" - octógono do raio da pressão.
    const p = points[0]!;
    const r = pressureToWidth(baseWidth, p.pressure) / 2;
    const octagono: { x: number; y: number }[] = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = (i / 8) * Math.PI * 2;
      octagono.push({ x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r });
    }
    return octagono;
  }

  const esquerda: { x: number; y: number }[] = [];
  const direita: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const anterior = points[Math.max(0, i - 1)]!;
    const proximo = points[Math.min(points.length - 1, i + 1)]!;
    const dx = proximo.x - anterior.x;
    const dy = proximo.y - anterior.y;
    const comprimento = Math.hypot(dx, dy) || 1;
    const nx = -dy / comprimento;
    const ny = dx / comprimento;
    const r = pressureToWidth(baseWidth, points[i]!.pressure) / 2;
    esquerda.push({ x: points[i]!.x + nx * r, y: points[i]!.y + ny * r });
    direita.push({ x: points[i]!.x - nx * r, y: points[i]!.y - ny * r });
  }
  return [...esquerda, ...direita.reverse()];
}

/** Polígono da silhueta -> string SVG "d" absoluta (M/L/Z), mesmo formato
 * que o path:created do editor já persiste em CanvaPathObject.pathData. */
export function outlineToPathData(outline: { x: number; y: number }[]): string {
  if (outline.length === 0) return '';
  const arredonda = (n: number) => Math.round(n * 100) / 100;
  const [primeiro, ...resto] = outline;
  return `M ${arredonda(primeiro!.x)} ${arredonda(primeiro!.y)} ${resto.map((p) => `L ${arredonda(p.x)} ${arredonda(p.y)}`).join(' ')} Z`;
}
